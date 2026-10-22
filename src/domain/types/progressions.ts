import type { ChordSuggestion } from './chords'
import type { RiffTiming } from './features'

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

/** One chord of a riff harmonization, aligned to a bar (or half-bar) */
export interface HarmonizedChord {
  chord: ChordSuggestion
  /** 1-based bar number */
  bar: number
  /** 0 = the whole bar; 1 / 2 = first / second half of the bar */
  half: 0 | 1 | 2
  startSec: number
  endSec: number
  /** Share (0-1) of the segment's weighted notes that are chord tones */
  fit: number
  /** Short explanation, e.g. "Bar 2 leans on F and A" */
  reason: string
  /** True when the segment had no notes (the chord just carries on) */
  empty: boolean
  /** Whether the chord is a colour chord (non-diatonic or a colour variant) */
  isColor: boolean
}

/** A bar-by-bar chord progression that follows the riff */
export interface RiffHarmonization {
  chords: HarmonizedChord[]
  /** Mean chord-tone fit over the non-empty segments (0-1) */
  fit: number
  /** Number of colour chords (non-diatonic or colour variants) */
  colorCount: number
  /** Path score from the harmonizer (higher is better), for ordering */
  score: number
}

export interface HarmonizationResult {
  timing: RiffTiming
  /** Best harmonization first, then up to three diverse alternatives */
  options: RiffHarmonization[]
}
