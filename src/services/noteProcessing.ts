// ─────────────────────────────────────────────────────────────────────────────
// Note Processing: Pure functions for merging, filtering, and cleaning notes
// ─────────────────────────────────────────────────────────────────────────────

import type { TranscribedNote } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants (can be overridden via function parameters)
// ─────────────────────────────────────────────────────────────────────────────

// Guitar polyphony limit (6 strings max - filters hallucinated harmonics/artifacts)
export const DEFAULT_MAX_POLYPHONY = 6

// Pitch bend threshold for detecting intentional bends vs artifacts
export const SIGNIFICANT_BEND_THRESHOLD = 0.3 // semitones

// Post-processing merge settings
export const DEFAULT_MERGE_TIME_THRESHOLD = 0.15 // Max gap (seconds) to consider notes as "connected"
export const DEFAULT_WOBBLE_SEMITONES = 1 // Pitch deviation to consider as wobble (half-step)

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Concatenate pitch bend arrays from merged notes.
 * Returns undefined if no bends exist.
 */
export function concatenatePitchBends(...notes: TranscribedNote[]): number[] | undefined {
  const allBends: number[] = []
  for (const note of notes) {
    if (note.pitchBend && note.pitchBend.length > 0) {
      allBends.push(...note.pitchBend)
    }
  }
  return allBends.length > 0 ? allBends : undefined
}

/**
 * Check if a note has significant pitch bend (likely intentional vibrato/slide).
 */
export function hasSignificantPitchBend(
  note: TranscribedNote,
  threshold: number = SIGNIFICANT_BEND_THRESHOLD
): boolean {
  if (!note.pitchBend || note.pitchBend.length === 0) return false
  return note.pitchBend.some(bend => Math.abs(bend) > threshold)
}

// ─────────────────────────────────────────────────────────────────────────────
// Polyphony Limiting
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Limit polyphony to maxPolyphony simultaneous notes (guitar has 6 strings).
 * When more notes overlap, keep the ones with highest amplitude.
 * This filters out hallucinated notes from harmonics/artifacts.
 */
export function limitPolyphony(
  notes: TranscribedNote[],
  maxPolyphony: number = DEFAULT_MAX_POLYPHONY
): TranscribedNote[] {
  if (notes.length <= maxPolyphony) return notes

  // Sort by start time
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec)

  const result: TranscribedNote[] = []

  for (const note of sorted) {
    // Find notes that overlap with this one
    const overlapping = result.filter(n =>
      n.endSec > note.startSec && n.startSec < note.endSec
    )

    if (overlapping.length < maxPolyphony) {
      result.push(note)
    } else {
      // Check if this note has higher amplitude than any overlapping note
      const lowestAmp = overlapping.reduce((min, n) =>
        (n.velocity ?? 0) < (min.velocity ?? 0) ? n : min
      )
      if ((note.velocity ?? 0) > (lowestAmp.velocity ?? 0)) {
        // Remove lowest and add this one
        const idx = result.indexOf(lowestAmp)
        result.splice(idx, 1)
        result.push(note)
      }
      // Otherwise, drop this note (likely hallucination)
    }
  }

  return result.sort((a, b) => a.startSec - b.startSec)
}

// ─────────────────────────────────────────────────────────────────────────────
// Phrase Grouping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Group notes into phrases based on temporal proximity.
 * A new phrase starts when there's a gap > threshold with no notes.
 */
export function groupIntoPhrases(
  notes: TranscribedNote[],
  threshold: number = DEFAULT_MERGE_TIME_THRESHOLD
): TranscribedNote[][] {
  if (notes.length === 0) return []

  const phrases: TranscribedNote[][] = []
  let currentPhrase: TranscribedNote[] = [notes[0]]

  for (let i = 1; i < notes.length; i++) {
    const prev = notes[i - 1]
    const curr = notes[i]

    // Check if there's a significant gap
    const gap = curr.startSec - prev.endSec

    if (gap > threshold) {
      // Start a new phrase
      phrases.push(currentPhrase)
      currentPhrase = [curr]
    } else {
      // Continue current phrase
      currentPhrase.push(curr)
    }
  }

  // Don't forget the last phrase
  phrases.push(currentPhrase)

  return phrases
}

// ─────────────────────────────────────────────────────────────────────────────
// Wobble Note Absorption
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Absorb short "wobble" notes that are ±wobbleSemitones from surrounding notes.
 * Pattern: A -> B -> A where B is ±wobbleSemitones from A and B is short
 * Result: Extend the first A to cover B and merge with second A
 * 
 * BUT: If the middle note has significant pitch bend, it's likely intentional
 * vibrato or a slide, so we preserve it instead of absorbing.
 */
export function absorbWobbleNotes(
  notes: TranscribedNote[],
  wobbleSemitones: number = DEFAULT_WOBBLE_SEMITONES,
  bendThreshold: number = SIGNIFICANT_BEND_THRESHOLD
): TranscribedNote[] {
  if (notes.length < 3) return notes

  const result: TranscribedNote[] = []
  let i = 0

  while (i < notes.length) {
    const current = notes[i]

    // Look ahead: is this a wobble pattern? (A -> wobble -> A)
    if (i + 2 < notes.length) {
      const middle = notes[i + 1]
      const after = notes[i + 2]

      // Check if middle note has significant pitch bend (likely intentional)
      const middleHasIntentionalBend = hasSignificantPitchBend(middle, bendThreshold)

      const isWobble =
        current.midi === after.midi && // Same pitch before and after
        Math.abs(middle.midi - current.midi) <= wobbleSemitones && // Middle is close
        (middle.endSec - middle.startSec) < 0.2 && // Middle note is short (<200ms)
        !middleHasIntentionalBend // NOT an intentional bend/vibrato

      if (isWobble) {
        // Merge all three into one note with the dominant pitch
        // Preserve pitch bends from all three notes
        const vel1 = current.velocity ?? 0.5
        const vel2 = after.velocity ?? 0.5
        result.push({
          startSec: current.startSec,
          endSec: after.endSec,
          midi: current.midi, // Use the dominant pitch
          velocity: (vel1 + vel2) / 2,
          pitchBend: concatenatePitchBends(current, middle, after),
        })
        i += 3 // Skip all three notes
        continue
      }
    }

    // Not a wobble pattern, keep the note with its pitch bend
    result.push({ ...current })
    i++
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Consecutive Note Merging
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge consecutive notes with the same pitch into longer notes.
 * Preserves pitch bends by concatenating them when merging.
 */
export function mergeConsecutiveSamePitch(
  notes: TranscribedNote[],
  threshold: number = DEFAULT_MERGE_TIME_THRESHOLD
): TranscribedNote[] {
  if (notes.length === 0) return []

  const result: TranscribedNote[] = []
  let current = { ...notes[0] }

  for (let i = 1; i < notes.length; i++) {
    const next = notes[i]
    const gap = next.startSec - current.endSec

    // Merge if same pitch and close together (or overlapping)
    if (next.midi === current.midi && gap <= threshold) {
      // Extend current note
      current.endSec = Math.max(current.endSec, next.endSec)
      // Average velocities
      if (current.velocity !== undefined && next.velocity !== undefined) {
        current.velocity = (current.velocity + next.velocity) / 2
      }
      // Concatenate pitch bends when merging
      current.pitchBend = concatenatePitchBends(current, next)
    } else {
      // Different pitch or gap too large - save and start new
      result.push(current)
      current = { ...next }
    }
  }

  // Don't forget the last note
  result.push(current)

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Phrase Cleaning
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Clean up a phrase by:
 * 1. Identifying dominant pitches
 * 2. Absorbing wobble notes (±1 semitone surrounded by same pitch)
 * 3. Merging consecutive same-pitch notes
 */
export function cleanPhrase(
  phrase: TranscribedNote[],
  wobbleSemitones: number = DEFAULT_WOBBLE_SEMITONES,
  mergeThreshold: number = DEFAULT_MERGE_TIME_THRESHOLD
): TranscribedNote[] {
  if (phrase.length === 0) return []
  if (phrase.length === 1) return phrase

  // Step 1: Absorb wobble notes into surrounding dominant pitch
  const deWobbled = absorbWobbleNotes(phrase, wobbleSemitones)

  // Step 2: Merge consecutive same-pitch notes
  const merged = mergeConsecutiveSamePitch(deWobbled, mergeThreshold)

  return merged
}

// ─────────────────────────────────────────────────────────────────────────────
// Smart Merge (Main Entry Point)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Smart merge algorithm:
 * 1. Group notes that are temporally connected (within threshold)
 * 2. Within each group, identify "anchor" notes and absorb wobble notes (±1 semitone)
 * 3. Merge consecutive same-pitch notes into longer sustained notes
 * 4. Preserve gaps between groups (intentional rests)
 */
export function smartMergeNotes(
  notes: TranscribedNote[],
  mergeThreshold: number = DEFAULT_MERGE_TIME_THRESHOLD,
  wobbleSemitones: number = DEFAULT_WOBBLE_SEMITONES
): TranscribedNote[] {
  if (notes.length === 0) return []

  // Step 1: Group notes into phrases (connected sequences)
  const phrases = groupIntoPhrases(notes, mergeThreshold)

  // Step 2: Clean up each phrase
  const cleanedPhrases = phrases.map(phrase => 
    cleanPhrase(phrase, wobbleSemitones, mergeThreshold)
  )

  // Step 3: Flatten back to single array
  return cleanedPhrases.flat()
}
