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
  /** Pitch class of the last note (for resolution hints) */
  lastNotePc?: number
  /** Pitch class of the lowest note (for bass-driven key inference) */
  bassPc?: number
}
