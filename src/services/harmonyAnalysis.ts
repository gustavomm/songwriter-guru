import { Scale, Note } from 'tonal'
import type { RiffFeatures, HarmonyAnalysisResult, HarmonicFieldCandidate } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Key profiles
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Albrecht & Shanahan (2013) key profiles, "The Use of Large Corpora to Train
 * a New Type of Key-Finding Algorithm", Music Perception 31(1). Values (C=0
 * ... B=11, relative to the tonic) as published in the justkeydding key-profile
 * table (Nápoles López et al., 2019, `albrecht_shanahan1`).
 */
const MAJOR_PROFILE = [
  0.238, 0.006, 0.111, 0.006, 0.137, 0.094, 0.016, 0.214, 0.009, 0.08, 0.008, 0.081,
]
const MINOR_PROFILE = [
  0.22, 0.006, 0.104, 0.123, 0.019, 0.103, 0.012, 0.214, 0.062, 0.022, 0.061, 0.052,
]

/**
 * Minor profile that also accepts the raised 6th and 7th (melodic/harmonic
 * minor): the natural 6th and leading tone get the same weight as b6 and b7.
 * A minor key scores the better of the natural and raised profiles, so G# in
 * A minor (or F# and G# together) is not penalized.
 */
const MINOR_RAISED_PROFILE = MINOR_PROFILE.map((w, i) =>
  i === 9 ? MINOR_PROFILE[8] : i === 11 ? MINOR_PROFILE[10] : w
)

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

// Only major and minor modes are supported
const MODES = [
  { name: 'major', displayName: 'Major' },
  { name: 'minor', displayName: 'Minor' },
] as const

type Mode = (typeof MODES)[number]

// Tonic-evidence bonuses, added to the profile correlation (range -1..1).
// They are deliberately small: they separate keys that share a scale
// (relative major/minor, pentatonic neighbours) without overriding the
// pitch-class distribution.
export const BASS_BONUS = 0.12 // × bass strength, when the bass/pedal note is the tonic
export const LAST_NOTE_BONUS = 0.04 // last note is the tonic
export const FIRST_NOTE_BONUS = 0.02 // first note is the tonic

/**
 * Bass strength below this share of the low register carries no evidence:
 * when several pitch classes share the lowest register (a melody played in
 * one position), the "bass" is just the most-played low note.
 */
const BASS_STRENGTH_FLOOR = 0.5

/** Softmax temperature turning scores into a confidence over the 24 keys */
export const CONFIDENCE_TEMPERATURE = 0.05

/**
 * Top two keys within this score margin are flagged as ambiguous. With the
 * temperature above, this is when the runner-up's confidence is at least
 * half the winner's (exp(-0.035 / 0.05) ≈ 0.5).
 */
export const AMBIGUITY_MARGIN = 0.035

/**
 * Wider margin used when no note in the riff tells the top two keys apart
 * (every pitch class played belongs to both scales, as with a pentatonic riff
 * and its relative or fifth-related key). The ranking then rests only on
 * emphasis (long, first, last and bass notes), so a moderate lead is still
 * reported as a close call.
 */
export const SHARED_SCALE_AMBIGUITY_MARGIN = 0.15

/** A pitch class needs this share of the weight to count as present */
const MIN_PITCH_CLASS_WEIGHT = 0.02

const OUT_OF_SCALE_THRESHOLD = 0.05 // Min weight to report as out-of-scale
const TOP_CANDIDATES_COUNT = 8 // Number of candidates to return

const MAX_SCORE = 1 + BASS_BONUS + LAST_NOTE_BONUS + FIRST_NOTE_BONUS

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
 * Rank the 24 major/minor keys for a riff.
 *
 * Score = Pearson correlation of the pitch-class histogram with the key's
 *         profile (Albrecht & Shanahan; minor also tried with raised 6/7)
 *       + BASS_BONUS × bass strength (bass/pedal note is the tonic)
 *       + LAST_NOTE_BONUS (last note is the tonic)
 *       + FIRST_NOTE_BONUS (first note is the tonic)
 *
 * Confidence is a softmax of the scores over all 24 keys. Returns no
 * candidates when the riff has fewer than two pitch classes; a two-pitch-class
 * riff (e.g. power chords) is always flagged ambiguous.
 */
export function analyzeHarmony(features: RiffFeatures): HarmonyAnalysisResult {
  const { pcWeights } = features

  const presentPCs = pcWeights.flatMap((w, pc) => (w >= MIN_PITCH_CLASS_WEIGHT ? [pc] : []))
  if (presentPCs.length < 2) {
    return { candidates: [], selectedCandidateId: '', ambiguous: false }
  }

  const scored: ScoredCandidate[] = []
  for (const mode of MODES) {
    for (const tonic of TONICS_BY_MODE[mode.name]) {
      scored.push(scoreCandidate(tonic, mode, features))
    }
  }
  scored.sort((a, b) => b.score - a.score)

  // Softmax over all 24 keys (shifted by the max for numerical stability)
  const top = scored[0].score
  const exps = scored.map((s) => Math.exp((s.score - top) / CONFIDENCE_TEMPERATURE))
  const sum = exps.reduce((a, b) => a + b, 0)

  const candidates = scored.slice(0, TOP_CANDIDATES_COUNT).map((s, i) => ({
    ...s.candidate,
    confidence: exps[i] / sum,
  }))

  const [best, runnerUp] = scored
  const margin = best.score - runnerUp.score
  const sharedScale = presentPCs.every(
    (pc) => best.acceptedPCs.has(pc) && runnerUp.acceptedPCs.has(pc)
  )
  const ambiguous =
    presentPCs.length === 2 ||
    margin < AMBIGUITY_MARGIN ||
    (sharedScale && margin < SHARED_SCALE_AMBIGUITY_MARGIN)

  return {
    candidates,
    selectedCandidateId: candidates[0].id,
    ambiguous,
    alternativeCandidateId: ambiguous ? candidates[1].id : undefined,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Logic
// ─────────────────────────────────────────────────────────────────────────────

interface ScoredCandidate {
  candidate: HarmonicFieldCandidate
  /** Unnormalized score used for ranking and confidence */
  score: number
  /** Pitch classes that fit the key (minor also accepts its raised 6th and 7th) */
  acceptedPCs: Set<number>
}

function scoreCandidate(tonic: string, mode: Mode, features: RiffFeatures): ScoredCandidate {
  const { pcWeights, lastNotePc, firstNotePc, bassPc, bassStrength } = features

  const scaleNotes = Scale.get(`${tonic} ${mode.name}`).notes
  const scalePCs = new Set(scaleNotes.map((note) => Note.chroma(note)))
  const tonicPC = Note.chroma(tonic) ?? 0

  // Histogram rotated so index 0 is this key's tonic
  const relative = pcWeights.map((_, i) => pcWeights[(tonicPC + i) % 12])
  const correlation =
    mode.name === 'major'
      ? pearson(relative, MAJOR_PROFILE)
      : Math.max(pearson(relative, MINOR_PROFILE), pearson(relative, MINOR_RAISED_PROFILE))

  // Tonic evidence
  const bassEvidence =
    bassPc === tonicPC
      ? Math.max(0, ((bassStrength ?? 1) - BASS_STRENGTH_FLOOR) / (1 - BASS_STRENGTH_FLOOR))
      : 0
  const score =
    correlation +
    BASS_BONUS * bassEvidence +
    (lastNotePc === tonicPC ? LAST_NOTE_BONUS : 0) +
    (firstNotePc === tonicPC ? FIRST_NOTE_BONUS : 0)

  // Out-of-scale notes (relative to the natural scale shown in the UI). The
  // harmonic-minor leading tone is common practice in minor, so it is not listed
  const leadingTonePC = mode.name === 'minor' ? (tonicPC + 11) % 12 : undefined
  const outOfScale: { note: string; weight: number }[] = []
  for (let pc = 0; pc < 12; pc++) {
    const weight = pcWeights[pc]
    if (!scalePCs.has(pc) && pc !== leadingTonePC && weight >= OUT_OF_SCALE_THRESHOLD) {
      outOfScale.push({ note: spellPitchClassInKey(pc, tonic, tonicPC), weight })
    }
  }
  outOfScale.sort((a, b) => b.weight - a.weight)

  return {
    candidate: {
      id: `${tonic}-${mode.name}`,
      tonic,
      mode: mode.displayName,
      scaleNotes,
      fitScore: Math.min(1, Math.max(0, score / MAX_SCORE)),
      outOfScale,
    },
    score,
    acceptedPCs:
      mode.name === 'minor'
        ? new Set([...scalePCs, (tonicPC + 9) % 12, (tonicPC + 11) % 12])
        : scalePCs,
  }
}

/** Pearson correlation coefficient (0 when either series is constant) */
function pearson(x: readonly number[], y: readonly number[]): number {
  const n = x.length
  const meanX = x.reduce((a, b) => a + b, 0) / n
  const meanY = y.reduce((a, b) => a + b, 0) / n
  let cov = 0
  let varX = 0
  let varY = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    cov += dx * dy
    varX += dx * dx
    varY += dy * dy
  }
  return varX > 0 && varY > 0 ? cov / Math.sqrt(varX * varY) : 0
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
