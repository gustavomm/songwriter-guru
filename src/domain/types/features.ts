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
}
