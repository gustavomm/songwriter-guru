export interface TranscribedNote {
  startSec: number
  endSec: number
  midi: number
  velocity?: number
  pitchBend?: number[]
}

/**
 * Transcription preset for different playing styles.
 * - 'lead': Best for single notes, legato, riffs (uses inferOnsets + melodiaTrick)
 * - 'chord': Best for strumming, chords (stricter detection, fewer ghost notes)
 */
export type TranscriptionPreset = 'lead' | 'chord'

export interface TranscriptionResult {
  notes: TranscribedNote[]
  noteCount: number
  range: {
    minMidi: number
    maxMidi: number
  }
}
