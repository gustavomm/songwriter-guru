export interface HarmonicFieldCandidate {
  id: string
  tonic: string
  mode: string
  scaleNotes: string[]
  fitScore: number
  outOfScale: { note: string; weight: number }[]
}

export interface HarmonyAnalysisResult {
  candidates: HarmonicFieldCandidate[]
  selectedCandidateId: string
}
