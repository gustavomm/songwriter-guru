import type { ChordSuggestion } from './chords'

/**
 * Represents a single slot in a chord progression.
 * Each slot has a chosen chord and potential alternatives.
 */
export interface ProgressionSlot {
  /** The functional role (e.g., "I", "V/vi", "bVI") */
  role: string
  /** The chosen chord for this slot */
  chosen: ChordSuggestion
  /** Alternative chords that could fill this slot (same function or resolution target) */
  alternatives: ChordSuggestion[]
}

export interface ProgressionSuggestion {
  /** Chord symbols (e.g., ["Am", "G", "F", "E7"]) */
  chords: string[]
  /** Roman numeral notation (e.g., ["i", "VII", "VI", "V/i"]) */
  romans: string[]
  /** Detailed slot information with alternatives */
  slots: ProgressionSlot[]
  /** Whether this progression contains any color chord (secondary or borrowed) */
  containsColorChord: boolean
  /** Whether this progression contains a secondary dominant (V/x) */
  containsSecondaryDominant: boolean
  /** Whether this progression contains a borrowed chord (from parallel mode) */
  containsBorrowedChord: boolean
  /** Overall score based on chord fit to the riff (0-1) */
  score: number
}
