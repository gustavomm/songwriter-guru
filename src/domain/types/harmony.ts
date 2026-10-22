export interface HarmonicFieldCandidate {
  id: string
  tonic: string
  mode: string
  scaleNotes: string[]
  /**
   * How well the riff matches this key (0-1): the key-profile correlation plus
   * tonic evidence, rescaled. Used for ranking; not a probability.
   */
  fitScore: number
  /**
   * Calibrated likelihood (0-1) that this is the riff's key, relative to the
   * other 23 major/minor keys. Shown in the UI as the confidence label.
   */
  confidence?: number
  outOfScale: { note: string; weight: number }[]
}

export interface HarmonyAnalysisResult {
  candidates: HarmonicFieldCandidate[]
  selectedCandidateId: string
  /**
   * True when the top two keys are too close to call (e.g. relative
   * major/minor or keys a fifth apart), or the riff has only two pitch classes.
   */
  ambiguous?: boolean
  /** Id of the close runner-up when `ambiguous` is set */
  alternativeCandidateId?: string
}
