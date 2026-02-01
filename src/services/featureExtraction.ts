import type { TranscribedNote, RiffFeatures, PitchClassWeights } from '../domain/types'

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

  // Calculate weighted duration per pitch class (duration × amplitude)
  const pcDurations: number[] = new Array(12).fill(0)
  let totalWeightedDuration = 0

  for (const note of notes) {
    const duration = note.endSec - note.startSec
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

  // Get last note's pitch class (for resolution/ending hints)
  const lastNote = notes[notes.length - 1]
  const lastNotePc = midiToPitchClass(lastNote.midi)

  // Get bass note's pitch class (lowest MIDI note)
  const lowestNote = notes.reduce((lowest, note) =>
    note.midi < lowest.midi ? note : lowest
  )
  const bassPc = midiToPitchClass(lowestNote.midi)

  return {
    pcWeights,
    topPitchClasses,
    lastNotePc,
    bassPc,
  }
}
