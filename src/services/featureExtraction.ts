import type { TranscribedNote, RiffFeatures, PitchClassWeights } from '../domain/types'
import { segmentRiff } from './riffSegmentation'

// ─────────────────────────────────────────────────────────────────────────────
// Feature Extraction: TranscribedNote[] → RiffFeatures
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert MIDI note number to pitch class (0-11)
 * C=0, C#=1, D=2, ..., B=11
 */
function midiToPitchClass(midi: number): number {
  return midi % 12
}

/**
 * Extract pitch class features from transcribed notes.
 * Weights notes by duration × amplitude to build a pitch class histogram.
 * This reduces the impact of weak/hallucinated notes.
 */
export function extractFeatures(notes: TranscribedNote[]): RiffFeatures {
  if (notes.length === 0) {
    return {
      pcWeights: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      topPitchClasses: [],
      lastNotePc: undefined,
      bassPc: undefined,
    }
  }

  // Calculate weighted duration per pitch class (duration × amplitude).
  // A single let-ring note (typically the last one) is capped at a few times
  // the typical note length so it can't dominate the whole histogram; long
  // low pedal notes are still picked up by the bass evidence below.
  const durationCap = longNoteCap(notes)
  const pcDurations: number[] = new Array(12).fill(0)
  let totalWeightedDuration = 0

  for (const note of notes) {
    const duration = Math.min(note.endSec - note.startSec, durationCap)
    const amplitude = note.velocity ?? 0.5 // velocity maps to amplitude, default 0.5 if missing
    const pc = midiToPitchClass(note.midi)
    const weightedDuration = duration * amplitude
    pcDurations[pc] += weightedDuration
    totalWeightedDuration += weightedDuration
  }

  // Normalize to weights (0-1, summing to 1)
  const pcWeights: PitchClassWeights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  if (totalWeightedDuration > 0) {
    for (let i = 0; i < 12; i++) {
      pcWeights[i] = pcDurations[i] / totalWeightedDuration
    }
  }

  // Find top pitch classes (sorted by weight, descending)
  const topPitchClasses = pcWeights
    .map((weight, pc) => ({ pc, weight }))
    .filter((entry) => entry.weight > 0.01) // Only include significant pitch classes
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 5) // Top 5
    .map((entry) => entry.pc)

  // First / last notes by onset time (not array order); for a chord, its lowest note
  const firstStart = Math.min(...notes.map((n) => n.startSec))
  const lastStart = Math.max(...notes.map((n) => n.startSec))
  const firstNotePc = midiToPitchClass(lowestMidiStartingNear(notes, firstStart))
  const lastNotePc = midiToPitchClass(lowestMidiStartingNear(notes, lastStart))

  const { bassPc, bassStrength } = findBassPitchClass(notes)

  return {
    pcWeights,
    topPitchClasses,
    lastNotePc,
    firstNotePc,
    bassPc,
    bassStrength,
    segmentation: segmentRiff(notes),
  }
}

/** A note counts for at most this many times the median note duration */
export const LONG_NOTE_CAP_FACTOR = 2

/** Duration cap for the histogram (no cap for fewer than 3 notes) */
function longNoteCap(notes: TranscribedNote[]): number {
  if (notes.length < 3) return Infinity
  const durations = notes.map((n) => n.endSec - n.startSec).sort((a, b) => a - b)
  const mid = Math.floor(durations.length / 2)
  const median =
    durations.length % 2 === 1 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2
  return median > 0 ? median * LONG_NOTE_CAP_FACTOR : Infinity
}

/** Notes starting within this window are treated as one chord/onset */
const SIMULTANEOUS_ONSET_SEC = 0.05

/** Notes within this many semitones of the lowest note count as the bass register */
export const BASS_REGISTER_SEMITONES = 5

function noteWeight(note: TranscribedNote): number {
  return Math.max(0, note.endSec - note.startSec) * (note.velocity ?? 0.5)
}

function lowestMidiStartingNear(notes: TranscribedNote[], time: number): number {
  return notes
    .filter((n) => Math.abs(n.startSec - time) <= SIMULTANEOUS_ONSET_SEC)
    .reduce((lowest, n) => Math.min(lowest, n.midi), Infinity)
}

/**
 * Duration-weighted bass / pedal note: among notes in the lowest register
 * (within BASS_REGISTER_SEMITONES of the lowest note), the pitch class with
 * the most duration × amplitude weight. Repeated or sustained low notes thus
 * win over one short low pickup note. `bassStrength` is that pitch class's
 * share of the low-register weight (1 = a single pedal pitch class).
 */
function findBassPitchClass(notes: TranscribedNote[]): {
  bassPc: number
  bassStrength: number
} {
  const lowestMidi = Math.min(...notes.map((n) => n.midi))
  const lowWeights: number[] = new Array(12).fill(0)
  for (const note of notes) {
    if (note.midi - lowestMidi <= BASS_REGISTER_SEMITONES) {
      lowWeights[midiToPitchClass(note.midi)] += noteWeight(note)
    }
  }
  const total = lowWeights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) {
    return { bassPc: midiToPitchClass(lowestMidi), bassStrength: 0 }
  }
  let bassPc = midiToPitchClass(lowestMidi)
  for (let pc = 0; pc < 12; pc++) {
    if (lowWeights[pc] > lowWeights[bassPc]) bassPc = pc
  }
  return { bassPc, bassStrength: lowWeights[bassPc] / total }
}
