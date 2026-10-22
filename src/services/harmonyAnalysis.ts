import { Scale, Note } from 'tonal'
import type { RiffFeatures, HarmonyAnalysisResult, HarmonicFieldCandidate } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conventional tonic spellings per mode (the spelling used in key signatures).
 * Flat keys are spelled with flats (Bb major, not A# major) so that scale notes
 * and chords downstream never end up with double sharps (B#, F##, ...).
 */
const TONICS_BY_MODE: Record<string, readonly string[]> = {
  major: ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'],
  minor: ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B'],
}

// Only major and minor modes are supported (using Tonal's Key module)
const MODES = [
  { name: 'major', displayName: 'Major' },
  { name: 'minor', displayName: 'Minor' },
]

// Scoring parameters
const OUT_OF_SCALE_PENALTY = 0.5 // Multiply out-of-scale weight by this
const TONIC_WEIGHT_FACTOR = 0.15 // Reward riffs that dwell on the tonic pitch class
const TONIC_TRIAD_WEIGHT_FACTOR = 0.15 // Reward riffs that outline the tonic triad (1-3-5)
const ENDING_BONUS = 0.05 // Bonus if last note is tonic
const BASS_BONUS = 0.03 // Bonus if bass note is tonic
const OUT_OF_SCALE_THRESHOLD = 0.05 // Min weight to report as out-of-scale
const TOP_CANDIDATES_COUNT = 8 // Number of candidates to return
const MIN_PC_WEIGHT = 0.01 // Min weight for a pitch class to count as played
const MIN_DISTINCT_PCS = 2 // Fewer distinct pitch classes than this: no key can be inferred

// Minor-key chromatic degrees (semitones above the tonic) from harmonic/melodic minor
const MINOR_LEADING_TONE = 11 // Raised 7th (G# in A minor): counted as in-scale
const MINOR_RAISED_SIXTH = 9 // Raised 6th (F# in A minor): reported, but not penalized

/**
 * Highest achievable raw score: every note in scale, all weight on the tonic
 * (which is also the whole tonic triad weight), ending and bass on the tonic.
 * Used to normalize the raw score into a 0-1 display value without clamping.
 */
const MAX_RAW_SCORE =
  1 + TONIC_WEIGHT_FACTOR + TONIC_TRIAD_WEIGHT_FACTOR + ENDING_BONUS + BASS_BONUS

/**
 * Interval above the tonic used to spell each chromatic offset (0-11 semitones).
 * Out-of-scale notes are named relative to the key (b2, b3/3, #4, b6/6, b7/7),
 * so F major reports Eb rather than D#, C major reports F# and Bb, and A minor
 * reports its raised leading tone as G#.
 */
const CHROMATIC_INTERVALS = ['1P', '2m', '2M', '3m', '3M', '4P', '4A', '5P', '6m', '6M', '7m', '7M']

// ─────────────────────────────────────────────────────────────────────────────
// Main Analysis Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze pitch class features and rank harmonic field candidates.
 * Evaluates 24 candidates (12 tonics × 2 modes) and returns top matches.
 */
export function analyzeHarmony(features: RiffFeatures): HarmonyAnalysisResult {
  const { pcWeights, lastNotePc, bassPc } = features

  // Not enough material to infer a key (no notes, or a single repeated pitch
  // class): return no candidates rather than an arbitrary C major
  if (!hasEnoughPitchMaterial(pcWeights)) {
    return { candidates: [], selectedCandidateId: '' }
  }

  const scored: ScoredCandidate[] = []

  // Evaluate all 24 candidates
  for (const mode of MODES) {
    for (const tonic of TONICS_BY_MODE[mode.name]) {
      scored.push(scoreCandidate(tonic, mode, pcWeights, lastNotePc, bassPc))
    }
  }

  // Sort by raw (unclamped) score so ties in the display value can't hide
  // differences such as which of two relative keys the riff centers on
  scored.sort((a, b) => b.rawScore - a.rawScore)

  // Take top candidates
  const topCandidates = scored.slice(0, TOP_CANDIDATES_COUNT).map((s) => s.candidate)

  return {
    candidates: topCandidates,
    selectedCandidateId: topCandidates[0]?.id ?? '',
  }
}

/**
 * Whether the riff has enough distinct pitch classes to rank keys at all.
 */
export function hasEnoughPitchMaterial(pcWeights: readonly number[]): boolean {
  return pcWeights.filter((weight) => weight > MIN_PC_WEIGHT).length >= MIN_DISTINCT_PCS
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Logic
// ─────────────────────────────────────────────────────────────────────────────

interface ScoredCandidate {
  candidate: HarmonicFieldCandidate
  /** Unnormalized score used for ranking */
  rawScore: number
}

/**
 * Score a single tonic+mode candidate against the pitch class weights.
 *
 * Raw score = in-scale weight − penalty × out-of-scale weight
 *           + tonic weight × factor + tonic triad (1-3-5) weight × factor
 *           + ending bonus + bass bonus
 *
 * The tonic terms are what separate relative keys (C major vs A minor share
 * all seven notes): the candidate whose tonic and tonic triad the riff
 * emphasizes ranks higher. The display fitScore is the raw score divided by
 * the maximum achievable raw score, so it stays in 0-1 without clamping.
 *
 * Minor candidates follow common practice rather than strict natural minor:
 * the raised 7th (harmonic minor leading tone) counts as in-scale, and the
 * raised 6th (melodic minor) is neither rewarded nor penalized (it is still
 * reported in outOfScale).
 */
function scoreCandidate(
  tonic: string,
  mode: { name: string; displayName: string },
  pcWeights: readonly number[],
  lastNotePc: number | undefined,
  bassPc: number | undefined
): ScoredCandidate {
  // Get scale notes from Tonal
  const scaleName = `${tonic} ${mode.name}`
  const scale = Scale.get(scaleName)
  const scaleNotes = scale.notes

  // Convert scale notes to pitch classes
  const scalePCs = new Set(scaleNotes.map((note) => Note.chroma(note)))

  // Get tonic pitch class
  const tonicPC = Note.chroma(tonic) ?? 0

  // Calculate in-scale and out-of-scale weights
  let inScaleWeight = 0
  let outScaleWeight = 0
  const outOfScale: { note: string; weight: number }[] = []

  const isMinor = mode.name === 'minor'

  for (let pc = 0; pc < 12; pc++) {
    const weight = pcWeights[pc]
    if (weight === 0) continue

    const degree = (pc - tonicPC + 12) % 12
    if (scalePCs.has(pc) || (isMinor && degree === MINOR_LEADING_TONE)) {
      inScaleWeight += weight
    } else if (isMinor && degree === MINOR_RAISED_SIXTH) {
      if (weight >= OUT_OF_SCALE_THRESHOLD) {
        outOfScale.push({ note: spellPitchClassInKey(pc, tonic, tonicPC), weight })
      }
    } else {
      outScaleWeight += weight
      if (weight >= OUT_OF_SCALE_THRESHOLD) {
        outOfScale.push({ note: spellPitchClassInKey(pc, tonic, tonicPC), weight })
      }
    }
  }

  // Sort out-of-scale notes by weight (descending)
  outOfScale.sort((a, b) => b.weight - a.weight)

  // Tonal-center evidence: weight on the tonic and on the tonic triad (1-3-5)
  const thirdPC = (tonicPC + (isMinor ? 3 : 4)) % 12
  const fifthPC = (tonicPC + 7) % 12
  const tonicWeight = pcWeights[tonicPC]
  const triadWeight = tonicWeight + pcWeights[thirdPC] + pcWeights[fifthPC]

  // Calculate bonuses
  const endingBonus = lastNotePc !== undefined && lastNotePc === tonicPC ? ENDING_BONUS : 0
  const bassBonus = bassPc !== undefined && bassPc === tonicPC ? BASS_BONUS : 0

  const rawScore =
    inScaleWeight -
    OUT_OF_SCALE_PENALTY * outScaleWeight +
    TONIC_WEIGHT_FACTOR * tonicWeight +
    TONIC_TRIAD_WEIGHT_FACTOR * triadWeight +
    endingBonus +
    bassBonus

  return {
    candidate: {
      id: `${tonic}-${mode.name}`,
      tonic,
      mode: mode.displayName,
      scaleNotes,
      fitScore: Math.max(0, rawScore / MAX_RAW_SCORE),
      outOfScale,
    },
    rawScore,
  }
}

/**
 * Spell an out-of-scale pitch class relative to the key's tonic, so that
 * chromatic notes follow the key's accidentals (e.g. Eb in F major, G# in
 * A minor). Double accidentals from remote keys are simplified.
 */
function spellPitchClassInKey(pc: number, tonic: string, tonicPC: number): string {
  const interval = CHROMATIC_INTERVALS[(pc - tonicPC + 12) % 12]
  const note = Note.transpose(tonic, interval)
  return /##|bb/.test(note) ? Note.simplify(note) : note
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
