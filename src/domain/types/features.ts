/**
 * 12-element tuple representing weights for each pitch class (C=0, C#=1, ..., B=11)
 */
export type PitchClassWeights = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
]

export interface RiffFeatures {
  /** Weighted pitch class distribution */
  pcWeights: PitchClassWeights
  /** Most prominent pitch classes (indices 0-11) */
  topPitchClasses: number[]
  /** Pitch class of the last note to start (lowest note of a final chord) */
  lastNotePc?: number
  /** Pitch class of the first note to start (lowest note of an opening chord) */
  firstNotePc?: number
  /**
   * Bass / pedal pitch class: the pitch class carrying the most duration ×
   * amplitude weight among the lowest-register notes (within a few semitones
   * of the lowest note), so a sustained or repeated low note outweighs a
   * single short low pickup.
   */
  bassPc?: number
  /** Share (0-1) of the low-register weight carried by `bassPc` */
  bassStrength?: number
  /**
   * The riff cut into bars along its estimated beat grid, for harmonizing
   * the riff over time (absent for hand-built features)
   */
  segmentation?: RiffSegmentation
}

/**
 * Beat grid estimated from the riff's note onsets (4/4 assumed).
 */
export interface RiffTiming {
  /** Estimated tempo in beats per minute, or null when the tempo was unclear */
  bpm: number | null
  /** Seconds per beat (a quarter of the bar length in fallback mode) */
  beatSec: number
  /** Seconds per bar (4 beats) */
  barSec: number
  /** Time of the first downbeat (bar 1, beat 1) in seconds */
  downbeatSec: number
  /**
   * 'tempo': the onsets line up with a steady beat grid; 'fallback': the
   * tempo was unclear and the riff was cut into equal bars of about 2 s
   */
  source: 'tempo' | 'fallback'
  /** How well the onsets fit the beat grid (0-1) */
  confidence: number
}

/**
 * Pitch content of one stretch of the riff (a bar or half-bar), weighted by
 * duration × amplitude × metric strength.
 */
export interface RiffSegment {
  /** 1-based bar number */
  bar: number
  /** 0 = whole bar; 1 / 2 = first / second half of the bar */
  half: 0 | 1 | 2
  startSec: number
  endSec: number
  /** Metric-weighted pitch class distribution, summing to 1 (all 0 when empty) */
  pcWeights: PitchClassWeights
  /**
   * Weight (same scale as pcWeights) of notes on strong beats (1 and 3) or
   * sustained for at least a beat: the notes that make an avoid note (e.g.
   * F over C major) sound wrong
   */
  strongPcWeights: PitchClassWeights
  /** Bass pitch class of the segment (most weight in its lowest register) */
  bassPc?: number
  /** Share (0-1) of the segment's low-register weight carried by bassPc */
  bassStrength?: number
  /** Number of notes starting in this segment */
  noteCount: number
}

/** A bar of the riff, optionally with its two half-bars pre-analysed */
export interface RiffBar extends RiffSegment {
  half: 0
  /** First and second half of the bar, present when both halves contain notes */
  halves?: [RiffSegment, RiffSegment]
}

/** The riff cut into bars along its estimated beat grid */
export interface RiffSegmentation {
  timing: RiffTiming
  bars: RiffBar[]
  /** Total number of notes analysed */
  noteCount: number
}
