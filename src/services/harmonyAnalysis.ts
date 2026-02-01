import { Scale, Note } from 'tonal'
import type { RiffFeatures, HarmonyAnalysisResult, HarmonicFieldCandidate } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const TONICS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// Only major and minor modes are supported (using Tonal's Key module)
const MODES = [
  { name: 'major', displayName: 'Major' },
  { name: 'minor', displayName: 'Minor' },
]

// Scoring parameters
const OUT_OF_SCALE_PENALTY = 0.5 // Multiply out-of-scale weight by this
const ENDING_BONUS = 0.05 // Bonus if last note is tonic
const BASS_BONUS = 0.03 // Bonus if bass note is tonic
const OUT_OF_SCALE_THRESHOLD = 0.05 // Min weight to report as out-of-scale
const TOP_CANDIDATES_COUNT = 8 // Number of candidates to return

// Pitch class names for display
const PC_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// ─────────────────────────────────────────────────────────────────────────────
// Main Analysis Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze pitch class features and rank harmonic field candidates.
 * Evaluates 84 candidates (12 tonics × 7 modes) and returns top matches.
 */
export function analyzeHarmony(features: RiffFeatures): HarmonyAnalysisResult {
  const { pcWeights, lastNotePc, bassPc } = features

  const candidates: HarmonicFieldCandidate[] = []

  // Evaluate all 84 candidates
  for (const tonic of TONICS) {
    for (const mode of MODES) {
      const candidate = scoreCandidate(tonic, mode, pcWeights, lastNotePc, bassPc)
      candidates.push(candidate)
    }
  }

  // Sort by fit score (descending)
  candidates.sort((a, b) => b.fitScore - a.fitScore)

  // Take top candidates
  const topCandidates = candidates.slice(0, TOP_CANDIDATES_COUNT)

  return {
    candidates: topCandidates,
    selectedCandidateId: topCandidates[0]?.id ?? '',
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Logic
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Score a single tonic+mode candidate against the pitch class weights.
 */
function scoreCandidate(
  tonic: string,
  mode: { name: string; displayName: string },
  pcWeights: readonly number[],
  lastNotePc: number | undefined,
  bassPc: number | undefined
): HarmonicFieldCandidate {
  // Get scale notes from Tonal
  const scaleName = `${tonic} ${mode.name}`
  const scale = Scale.get(scaleName)
  const scaleNotes = scale.notes

  // Convert scale notes to pitch classes
  const scalePCs = new Set(scaleNotes.map((note) => Note.chroma(note)))

  // Get tonic pitch class
  const tonicPC = Note.chroma(tonic)

  // Calculate in-scale and out-of-scale weights
  let inScaleWeight = 0
  let outScaleWeight = 0
  const outOfScale: { note: string; weight: number }[] = []

  for (let pc = 0; pc < 12; pc++) {
    const weight = pcWeights[pc]
    if (weight === 0) continue

    if (scalePCs.has(pc)) {
      inScaleWeight += weight
    } else {
      outScaleWeight += weight
      if (weight >= OUT_OF_SCALE_THRESHOLD) {
        outOfScale.push({ note: PC_NAMES[pc], weight })
      }
    }
  }

  // Sort out-of-scale notes by weight (descending)
  outOfScale.sort((a, b) => b.weight - a.weight)

  // Calculate bonuses
  const endingBonus = lastNotePc !== undefined && lastNotePc === tonicPC ? ENDING_BONUS : 0
  const bassBonus = bassPc !== undefined && bassPc === tonicPC ? BASS_BONUS : 0

  // Calculate final fit score
  // Formula: inScaleWeight - (penalty * outScaleWeight) + bonuses
  const fitScore = Math.max(
    0,
    Math.min(1, inScaleWeight - OUT_OF_SCALE_PENALTY * outScaleWeight + endingBonus + bassBonus)
  )

  return {
    id: `${tonic}-${mode.name}`,
    tonic,
    mode: mode.displayName,
    scaleNotes,
    fitScore,
    outOfScale,
  }
}

/**
 * Get scale notes for a given tonic and mode.
 * Useful for chord generation later.
 */
export function getScaleNotes(tonic: string, modeName: string): string[] {
  // Map display name back to Tonal name
  const mode = MODES.find((m) => m.displayName === modeName || m.name === modeName)
  if (!mode) return []

  const scale = Scale.get(`${tonic} ${mode.name}`)
  return scale.notes
}

/**
 * Get the pitch classes in a scale.
 */
export function getScalePitchClasses(tonic: string, modeName: string): number[] {
  const notes = getScaleNotes(tonic, modeName)
  return notes.map((note) => Note.chroma(note)).filter((pc): pc is number => pc !== undefined)
}
