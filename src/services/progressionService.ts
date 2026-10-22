import { Note, Chord, RomanNumeral } from 'tonal'
import type {
  ProgressionSuggestion,
  ProgressionSlot,
  ChordSuggestionResult,
  ChordSuggestion,
  HarmonicFieldCandidate,
  RiffFeatures,
} from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Mode name mappings (display name -> Tonal name)
const MODE_NAME_MAP: Record<string, string> = {
  Major: 'major',
  Minor: 'minor',
}

// Default weirdness value (0 = conventional, 1 = color-forward)
const DEFAULT_WEIRDNESS = 0.5

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Components
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressionScoreComponents {
  fit: number // Mean supportScore (how well chords match riff)
  spice: number // Mean colorScore (how "interesting" the chords are)
  motion: number // Transition score (functional harmony flow)
  cadence: number // Ending strength (V→I, bII→V, tonic ending)
  hasColorChord: boolean // Whether progression contains borrowed/secondary chords
}

/**
 * Compute a weirdness-adjusted chord selection score.
 *
 * At low weirdness: prefer high supportScore (fitting chords)
 * At high weirdness: prefer high colorScore (colorful chords)
 *
 * @param supportScore - How well the chord fits the riff (0-1)
 * @param colorScore - How colorful/interesting the chord is (0-1)
 * @param weirdness - 0 = prefer fitting, 1 = prefer colorful
 */
function computeChordSelectionScore(
  supportScore: number,
  colorScore: number,
  weirdness: number
): number {
  // At weirdness=0: 100% supportScore, 0% colorScore
  // At weirdness=1: 20% supportScore, 80% colorScore
  // The supportScore floor ensures we don't pick completely clashing chords
  const supportWeight = 1 - weirdness * 0.8
  const colorWeight = weirdness * 0.8
  return supportScore * supportWeight + colorScore * colorWeight
}

/**
 * Compute final score from components using weirdness-adjusted weights.
 *
 * Weirdness dramatically shifts the scoring priorities:
 * - At 0 (Safe): Prioritize fit and proper voice leading, penalize color chords
 * - At 0.5 (Mild): Balanced approach
 * - At 1 (Spicy): Prioritize color/spice, require color chords, relax voice leading rules
 *
 * @param components - The score components
 * @param weirdness - 0 = conventional/safe, 1 = color-forward/spicy
 */
function computeFinalScore(components: ProgressionScoreComponents, weirdness: number): number {
  // Dramatic weight shifts based on weirdness
  // At weirdness=0: fit dominates, motion matters, spice minimal
  // At weirdness=1: spice dominates, fit minimal, motion relaxed

  const fitWeight = 0.4 * (1 - weirdness * 0.8) // 0.40 → 0.08
  const spiceWeight = 0.1 + weirdness * 0.45 // 0.10 → 0.55
  const motionWeight = 0.3 * (1 - weirdness * 0.5) // 0.30 → 0.15
  const cadenceWeight = 0.2 // Constant - endings still matter

  let score =
    components.fit * fitWeight +
    components.spice * spiceWeight +
    components.motion * motionWeight +
    components.cadence * cadenceWeight

  // Color chord bonus/penalty based on weirdness
  // At low weirdness: slight penalty for having color chords (prefer diatonic)
  // At high weirdness: strong bonus for having color chords (require them!)
  if (components.hasColorChord) {
    const colorBonus = -0.15 + weirdness * 0.4 // -0.15 at 0, +0.25 at 1
    score += colorBonus
  } else {
    // No color chord - penalty at high weirdness (we WANT color!)
    const noColorPenalty = weirdness * -0.2 // 0 at 0, -0.20 at 1
    score += noColorPenalty
  }

  return Math.max(0, Math.min(1, score))
}

// ─────────────────────────────────────────────────────────────────────────────
// Harmonic Function Types and Transitions
// ─────────────────────────────────────────────────────────────────────────────

type HarmonicFunction = 'T' | 'SD' | 'D'

/**
 * Transition scoring matrix for functional harmony flow.
 * Rewards proper voice leading (SD→D→T) and penalizes retrogressions.
 */
const TRANSITION_SCORES: Record<HarmonicFunction, Record<HarmonicFunction, number>> = {
  T: { T: 0.0, SD: 0.15, D: 0.05 }, // T→SD good, T→D acceptable
  SD: { T: -0.1, SD: 0.0, D: 0.2 }, // SD→D very good, SD→T retrogression
  D: { T: 0.25, SD: -0.15, D: 0.0 }, // D→T best, D→SD bad retrogression
}

// Resolution scoring constants (increased for more impact)
const APPLIED_CHORD_CORRECT_RESOLUTION = 0.25
const APPLIED_CHORD_WRONG_RESOLUTION = -0.3
const NEAPOLITAN_CORRECT_RESOLUTION = 0.15
const NEAPOLITAN_WRONG_RESOLUTION = -0.15
// Substitute dominant (subV) resolution constants
const SUBV_CORRECT_RESOLUTION = 0.2
const SUBV_WRONG_RESOLUTION = -0.15

/**
 * Harmonic function assignments for borrowed chords by degree.
 * Borrowed chords preserve the function of the degree they replace.
 */
const BORROWED_CHORD_FUNCTIONS: Record<string, HarmonicFunction> = {
  bII: 'SD', // Neapolitan - predominant function
  bIII: 'T', // Borrowed mediant - tonic substitute
  bVI: 'SD', // Borrowed submediant - predominant
  bVII: 'D', // Borrowed subtonic - dominant function
  iv: 'SD', // Minor iv in major - predominant
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolution Rules (applied chords, tritone subs, Neapolitan)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract the scale-degree part of a roman numeral (accidental + numeral),
 * dropping extensions and quality marks: "V7" → "V", "viiø7" → "vii",
 * "III+maj7" → "III", "i(maj7)" → "i", "bVImaj7" → "bVI".
 */
function getRomanDegree(roman: string): string {
  const match = roman.match(/^[b#]*[iv]+/i)
  return match ? match[0] : roman
}

/**
 * Normalize a roman numeral for degree comparison: keeps only the scale
 * degree and ignores case, so "V7" matches "V", "ii7" matches "ii" and
 * "III+" matches "III".
 */
function normalizeRoman(roman: string): string {
  return getRomanDegree(roman).toLowerCase()
}

/**
 * Whether a roman numeral is the Neapolitan (bII / bII7 / bIImaj7).
 */
function isNeapolitan(roman: string | undefined): boolean {
  return !!roman && getRomanDegree(roman) === 'bII'
}

/**
 * Score the resolution of applied chords (V/x, vii°/x).
 * Applied chords should resolve to their target (the chord after the slash).
 * @returns Bonus for correct resolution, penalty for incorrect
 */
function scoreAppliedChordResolution(roman: string, nextRoman: string | null): number {
  if (!roman.includes('/')) return 0
  if (!nextRoman) return APPLIED_CHORD_WRONG_RESOLUTION // No resolution

  const [, targetPart] = roman.split('/')
  if (!targetPart) return 0

  // Check if the next chord is the target (ignoring 7th/quality suffixes)
  if (normalizeRoman(nextRoman) === normalizeRoman(targetPart)) {
    return APPLIED_CHORD_CORRECT_RESOLUTION
  }

  return APPLIED_CHORD_WRONG_RESOLUTION
}

/**
 * Score the resolution of Neapolitan chord (bII).
 * The Neapolitan is a chromatic predominant that should resolve to V.
 * @returns Bonus for correct resolution (bII→V), penalty otherwise
 */
function scoreNeapolitanResolution(roman: string, nextRoman: string | null): number {
  if (!isNeapolitan(roman)) return 0
  if (!nextRoman) return NEAPOLITAN_WRONG_RESOLUTION

  // Neapolitan should resolve to V (or V7, etc.)
  if (normalizeRoman(nextRoman) === 'v') {
    return NEAPOLITAN_CORRECT_RESOLUTION
  }

  return NEAPOLITAN_WRONG_RESOLUTION
}

/**
 * Score the resolution of substitute dominant chords (subV, subV/x).
 * Substitute dominants should resolve down by half-step to their target.
 * - subV (alone) resolves to I
 * - subV/x resolves to x
 * @returns Bonus for correct resolution, penalty for incorrect
 */
function scoreSubstituteResolution(roman: string, nextRoman: string | null): number {
  if (!roman.startsWith('subV')) return 0
  if (!nextRoman) return SUBV_WRONG_RESOLUTION

  // subV (not subV/x) should resolve to tonic (I)
  if (!roman.includes('/')) {
    return normalizeRoman(nextRoman) === 'i' ? SUBV_CORRECT_RESOLUTION : SUBV_WRONG_RESOLUTION
  }

  // subV/x should resolve to x
  const slashIndex = roman.indexOf('/')
  if (slashIndex === -1) return 0

  const targetPart = roman.slice(slashIndex + 1)
  if (!targetPart) return 0

  return normalizeRoman(nextRoman) === normalizeRoman(targetPart)
    ? SUBV_CORRECT_RESOLUTION
    : SUBV_WRONG_RESOLUTION
}

/**
 * Combined resolution score for one transition (chord → next chord).
 * Dispatches to the substitute, applied or Neapolitan scorer so that a
 * "subV/x" chord is not counted twice.
 */
function scoreResolution(roman: string, nextRoman: string | null): number {
  if (roman.startsWith('subV')) return scoreSubstituteResolution(roman, nextRoman)
  if (roman.includes('/')) return scoreAppliedChordResolution(roman, nextRoman)
  return scoreNeapolitanResolution(roman, nextRoman)
}

/**
 * Get the roman numeral a chord must resolve to, or null for chords that
 * can move freely (diatonic and most borrowed chords).
 * - Secondary dominants / tritone subs: their `resolvesToRoman` target
 * - Bare subV: I
 * - Neapolitan (bII): V
 */
function getResolutionTarget(chord: ChordSuggestion): string | null {
  if (chord.resolvesToRoman) return chord.resolvesToRoman

  const roman = chord.roman ?? ''
  const slashIndex = roman.indexOf('/')
  if (slashIndex >= 0) return roman.slice(slashIndex + 1) || null
  if (roman.startsWith('subV')) return 'I'
  if (isNeapolitan(roman)) return 'V'
  return null
}

/**
 * Expected root motion (in semitones, upward mod 12) from a chord with a
 * resolution target to that target. Guards against roman numerals that only
 * differ in case/quality but have different roots (e.g. VI vs vi° in minor).
 */
function getResolutionInterval(chord: ChordSuggestion): number | null {
  const roman = chord.roman ?? ''
  if (roman.startsWith('subV')) return 11 // Down a half step
  if (roman.startsWith('vii')) return 1 // Leading tone up a half step
  if (isNeapolitan(roman)) return 6 // bII → V (tritone)
  if (roman.startsWith('V')) return 5 // Down a fifth
  return null
}

/**
 * Get the pitch class (0-11) of a chord's root, or null if unknown.
 */
function getRootChroma(chord: ChordSuggestion): number | null {
  const root = Chord.get(chord.id).tonic ?? Chord.get(chord.symbol).tonic ?? chord.chordTones[0]
  if (!root) return null
  const chroma = Note.chroma(root)
  return typeof chroma === 'number' && !Number.isNaN(chroma) ? chroma : null
}

/**
 * Whether two chords share the same root (e.g. C and Cmaj7, Am and Am7).
 */
function haveSameRoot(a: ChordSuggestion, b: ChordSuggestion): boolean {
  const rootA = getRootChroma(a)
  return rootA !== null && rootA === getRootChroma(b)
}

/**
 * Check whether `chord` may be immediately followed by `next`
 * (`next` = null means `chord` is the final chord of the progression).
 *
 * Rules:
 * - Applied chords (V/x, subV/x, vii°/x) and the Neapolitan must be followed
 *   by their target, so they can never end a progression.
 * - Adjacent chords must not share a root (no C → Cmaj7 "repeats").
 */
function isValidTransition(chord: ChordSuggestion, next: ChordSuggestion | null): boolean {
  const target = getResolutionTarget(chord)
  if (target) {
    if (!next?.roman) return false
    if (normalizeRoman(next.roman) !== normalizeRoman(target)) return false

    const interval = getResolutionInterval(chord)
    const root = getRootChroma(chord)
    const nextRoot = getRootChroma(next)
    if (interval !== null && root !== null && nextRoot !== null) {
      if ((nextRoot - root + 12) % 12 !== interval) return false
    }
  }

  return next === null || !haveSameRoot(chord, next)
}

/**
 * Score the harmonic motion of a chord sequence (0-1, 0.5 = neutral).
 * Combines function transitions (SD→D→T) with resolution bonuses for
 * applied chords, tritone subs and the Neapolitan.
 */
function scoreMotion(selectedChords: ChordSuggestion[]): number {
  if (selectedChords.length < 2) return 0.5

  let motionScore = 0
  for (let i = 0; i < selectedChords.length - 1; i++) {
    const current = selectedChords[i]
    const next = selectedChords[i + 1]
    if (current.function && next.function) {
      motionScore += TRANSITION_SCORES[current.function]?.[next.function] ?? 0
    }
    if (current.roman) {
      motionScore += scoreResolution(current.roman, next.roman ?? null)
    }
  }

  const normalizedMotion = motionScore / (selectedChords.length - 1)
  return Math.max(0, Math.min(1, 0.5 + normalizedMotion))
}

// ─────────────────────────────────────────────────────────────────────────────
// Function-Based Progression Templates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A function template defines a progression in terms of harmonic functions
 * rather than specific roman numerals. This allows chord selection to be
 * driven by the chord suggestion scores.
 *
 * Special markers:
 * - 'T' = Tonic function (I, iii, vi in major; i, III, VI in minor)
 * - 'SD' = Subdominant/Pre-dominant (ii, IV in major; ii°, iv in minor)
 * - 'D' = Dominant function (V, vii° in major; V, v, VII, vii° in minor)
 * - 'T1' = Tonic ROOT only (must be I or i) - for starts/endings
 * - 'D->T' = Dominant that resolves to next tonic (for cadences)
 */
interface FunctionTemplate {
  functions: string[]
  name: string
  // Cadence type: 'authentic' (D→T), 'plagal' (SD→T), 'half' (ends on D), 'open' (no constraint)
  cadence: 'authentic' | 'plagal' | 'half' | 'deceptive' | 'open'
}

/**
 * Function templates covering common progression patterns.
 * These work for both major and minor keys since they're function-based.
 */
const FUNCTION_TEMPLATES: FunctionTemplate[] = [
  // 4-chord patterns with authentic cadence (D→T)
  { functions: ['T1', 'SD', 'D', 'T1'], name: 'T-SD-D-T', cadence: 'authentic' },
  { functions: ['T1', 'T', 'SD', 'D'], name: 'T-T-SD-D', cadence: 'half' },
  { functions: ['T1', 'D', 'T', 'D'], name: 'T-D-T-D', cadence: 'half' },
  { functions: ['T', 'SD', 'T1', 'D'], name: 'T-SD-T-D', cadence: 'half' },

  // Tonic prolongation patterns
  { functions: ['T1', 'T', 'T', 'D', 'T1'], name: 'T-T-T-D-T', cadence: 'authentic' },
  { functions: ['T1', 'T', 'SD', 'D', 'T1'], name: 'T-T-SD-D-T', cadence: 'authentic' },

  // Subdominant emphasis
  { functions: ['T1', 'SD', 'SD', 'D', 'T1'], name: 'T-SD-SD-D-T', cadence: 'authentic' },
  { functions: ['SD', 'D', 'T1'], name: 'SD-D-T', cadence: 'authentic' },

  // Plagal patterns (SD→T cadence)
  { functions: ['T1', 'D', 'SD', 'T1'], name: 'T-D-SD-T', cadence: 'plagal' },
  { functions: ['T1', 'SD', 'T1'], name: 'T-SD-T', cadence: 'plagal' },

  // Deceptive patterns (D→non-root T)
  { functions: ['T1', 'SD', 'D', 'T'], name: 'T-SD-D-T(dec)', cadence: 'deceptive' },

  // Open/modal patterns (no strong cadence)
  { functions: ['T1', 'D', 'SD', 'D'], name: 'T-D-SD-D', cadence: 'open' },
  { functions: ['T', 'T', 'SD', 'SD'], name: 'T-T-SD-SD', cadence: 'open' },
  { functions: ['T1', 'T', 'D', 'T'], name: 'T-T-D-T', cadence: 'authentic' },

  // Longer patterns
  { functions: ['T1', 'T', 'SD', 'D', 'T', 'SD', 'D', 'T1'], name: '8-bar', cadence: 'authentic' },

  // Dominant slots followed by a non-tonic target: room for applied chords
  // to resolve properly (e.g. I–IV–V/V–V–I, I–V/ii–ii–V–I, I–V/vi–vi–IV–V–I)
  { functions: ['T1', 'SD', 'D', 'D', 'T1'], name: 'T-SD-D-D-T', cadence: 'authentic' },
  { functions: ['T1', 'D', 'SD', 'D', 'T1'], name: 'T-D-SD-D-T', cadence: 'authentic' },
  { functions: ['T1', 'D', 'T', 'SD', 'D', 'T1'], name: 'T-D-T-SD-D-T', cadence: 'authentic' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Function-Based Chord Selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get all candidate chords for a harmonic function slot, sorted by
 * weirdness-adjusted score (best first).
 *
 * @param targetFunction - The function to fill ('T', 'SD', 'D', 'T1')
 * @param chords - The chord suggestion catalog
 * @param tonic - The tonic note (for T1 / deceptive constraints)
 * @param weirdness - 0 = prefer fitting, 1 = prefer colorful
 * @param isDeceptiveCadence - If true, exclude tonic root for T slots
 * @param diatonicOnly - If true, only consider diatonic chords
 */
function getRankedCandidates(
  targetFunction: string,
  chords: ChordSuggestionResult,
  tonic: string,
  weirdness: number,
  isDeceptiveCadence: boolean = false,
  diatonicOnly: boolean = false
): ChordSuggestion[] {
  // Map function marker to actual harmonic function
  const actualFunction: HarmonicFunction =
    targetFunction === 'T1' || targetFunction === 'T' ? 'T' : targetFunction === 'SD' ? 'SD' : 'D'

  let filtered = chords.byFunction.get(actualFunction) || []
  const tonicChroma = Note.chroma(tonic)

  // Diatonic-only filter: exclude secondary dominants and borrowed chords
  if (diatonicOnly) {
    filtered = filtered.filter((c) => c.source === 'diatonic')
  }

  // T1 constraint: must be the tonic root (I or i)
  if (targetFunction === 'T1') {
    filtered = filtered.filter((c) => getRootChroma(c) === tonicChroma)
  }

  // Deceptive cadence: exclude tonic root chords for T slots
  if (isDeceptiveCadence && targetFunction === 'T') {
    filtered = filtered.filter((c) => getRootChroma(c) !== tonicChroma)
  }

  // Sort by weirdness-adjusted score (descending)
  return [...filtered].sort((a, b) => {
    const scoreA = computeChordSelectionScore(a.supportScore, a.colorScore, weirdness)
    const scoreB = computeChordSelectionScore(b.supportScore, b.colorScore, weirdness)
    return scoreB - scoreA
  })
}

/**
 * Get alternative chords for a filled slot, sorted by weirdness-adjusted score.
 * Alternatives obey the same voice-leading rules as the chosen chord: an
 * applied chord is only offered if it resolves to the next chord, nothing that
 * would leave the previous chord unresolved is offered, and no alternative
 * shares a root with its neighbours.
 *
 * @param targetFunction - The function marker of the slot
 * @param chords - The chord suggestion catalog
 * @param tonic - The tonic note
 * @param weirdness - 0 = prefer fitting, 1 = prefer colorful
 * @param chosen - The chord currently in the slot (excluded from results)
 * @param prev - The chord before the slot (null for the first slot)
 * @param next - The chord after the slot (null for the last slot)
 * @param limit - Maximum number of alternatives
 */
function getChordsForFunction(
  targetFunction: string,
  chords: ChordSuggestionResult,
  tonic: string,
  weirdness: number,
  chosen: ChordSuggestion,
  prev: ChordSuggestion | null,
  next: ChordSuggestion | null,
  limit: number = 3
): ChordSuggestion[] {
  return getRankedCandidates(targetFunction, chords, tonic, weirdness)
    .filter(
      (c) =>
        c.symbol !== chosen.symbol &&
        (prev === null || isValidTransition(prev, c)) &&
        isValidTransition(c, next)
    )
    .slice(0, limit)
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the harmonic function of a roman numeral directly (without chord symbol).
 */
function getHarmonicFunctionFromRoman(roman: string): HarmonicFunction | null {
  // Borrowed chords (look up by bare degree so "bVII7" / "bVImaj7" / "iv7" match)
  const degree = getRomanDegree(roman)
  if (degree.startsWith('b') || degree === 'iv') {
    return BORROWED_CHORD_FUNCTIONS[degree] || 'SD'
  }

  // Applied chords are dominant function
  if (roman.includes('/')) {
    return 'D'
  }

  const parsed = RomanNumeral.get(roman)
  if (parsed.empty) return null

  switch (parsed.step) {
    case 0:
      return 'T' // I/i
    case 1:
      return 'SD' // ii
    case 2:
      return 'T' // iii/III
    case 3:
      return 'SD' // IV/iv
    case 4:
      return 'D' // V/v
    case 5:
      return 'T' // vi/VI
    case 6:
      return 'D' // vii°/VII
    default:
      return null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Function-Based Progression Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate a progression from a function template.
 * Selects chords based on their harmonic function and weirdness-adjusted scores.
 *
 * @param template - The function template to use
 * @param tonic - Root note of the key
 * @param modeName - 'major' or 'minor'
 * @param chords - Pre-computed chord suggestions with indexes
 * @param weirdness - 0 = prefer fitting chords, 1 = prefer colorful chords
 * @param rankOffset - 0 = best chords, 1 = 2nd best, etc. (for variety)
 * @param diatonicOnly - If true, only use diatonic chords
 * @returns A progression suggestion, or null if we couldn't fill all slots
 */
function generateFromFunctionTemplate(
  template: FunctionTemplate,
  tonic: string,
  modeName: string,
  chords: ChordSuggestionResult,
  weirdness: number,
  rankOffset: number = 0,
  diatonicOnly: boolean = false
): ProgressionSuggestion | null {
  // Silence unused variable warning - modeName kept for API compatibility
  void modeName

  const slotCount = template.functions.length
  const lastIndex = slotCount - 1
  const isDeceptive = template.cadence === 'deceptive'

  // Vary rank offset per slot to create more internal variety
  // Pattern: [0, 1, 0, 2, 1, 0, 2, 1] offset from base rankOffset
  const slotRankPattern = [0, 1, 0, 2, 1, 0, 2, 1]

  // Candidate order per slot: start at the slot's rank offset, then wrap
  // around so lower-ranked fallbacks are still available to the search
  const slotCandidates = template.functions.map((fn, i) => {
    const ranked = getRankedCandidates(
      fn,
      chords,
      tonic,
      weirdness,
      isDeceptive && i === lastIndex,
      diatonicOnly
    )
    const slotRankOffset = rankOffset + slotRankPattern[i % slotRankPattern.length]
    const start = Math.min(slotRankOffset, Math.max(0, ranked.length - 1))
    return [...ranked.slice(start), ...ranked.slice(0, start)]
  })
  if (slotCandidates.some((candidates) => candidates.length === 0)) return null

  // Depth-first fill, left to right. Each slot takes its highest-ranked
  // candidate that forms a valid transition from the previous chord; an
  // applied chord therefore forces the next slot to be its target (or is
  // abandoned if that slot can't hold the target). Chords already used in the
  // progression are tried last to keep progressions varied.
  const selectedChords: ChordSuggestion[] = []
  // Feasibility of slots i.. only depends on the chord before slot i
  const deadEnds = new Set<string>()

  const fillSlot = (i: number): boolean => {
    if (i === slotCount) return true

    const prev = i > 0 ? selectedChords[i - 1] : null
    const memoKey = `${i}|${prev?.symbol ?? ''}`
    if (deadEnds.has(memoKey)) return false

    const used = new Set(selectedChords.map((c) => c.symbol))
    const ordered = [
      ...slotCandidates[i].filter((c) => !used.has(c.symbol)),
      ...slotCandidates[i].filter((c) => used.has(c.symbol)),
    ]

    for (const candidate of ordered) {
      if (prev && !isValidTransition(prev, candidate)) continue
      if (i === lastIndex && !isValidTransition(candidate, null)) continue

      selectedChords.push(candidate)
      if (fillSlot(i + 1)) return true
      selectedChords.pop()
    }

    deadEnds.add(memoKey)
    return false
  }

  if (!fillSlot(0)) return null

  const chordSymbols = selectedChords.map((c) => c.symbol)
  const romanNumerals = selectedChords.map((c, i) => c.roman || template.functions[i])

  // Calculate scores
  let totalSupportScore = 0
  let totalColorScore = 0
  let hasColorChord = false
  let containsSecondaryDominant = false
  let containsBorrowedChord = false

  for (const chord of selectedChords) {
    totalSupportScore += chord.supportScore
    totalColorScore += chord.colorScore

    if (chord.source !== 'diatonic') {
      hasColorChord = true
    }
    if (chord.source === 'secondary_dominant' || chord.source === 'substitute_dominant') {
      containsSecondaryDominant = true
    }
    if (chord.source === 'borrowed') {
      containsBorrowedChord = true
    }
  }

  const numChords = selectedChords.length
  const fit = numChords > 0 ? totalSupportScore / numChords : 0
  const spice = numChords > 0 ? totalColorScore / numChords : 0

  // Calculate cadence score
  const cadenceScore = scoreCadenceForTemplate(template, romanNumerals)

  // Compute final score
  const components: ProgressionScoreComponents = {
    fit,
    spice,
    motion: scoreMotion(selectedChords),
    cadence: cadenceScore,
    hasColorChord,
  }
  const score = computeFinalScore(components, weirdness)

  // Build slots with alternatives
  const slots: ProgressionSlot[] = selectedChords.map((chosen, i) => {
    // Alternatives: other chords with the same function that keep the
    // neighbouring transitions valid
    const alternatives = getChordsForFunction(
      template.functions[i],
      chords,
      tonic,
      weirdness,
      chosen,
      i > 0 ? selectedChords[i - 1] : null,
      i < lastIndex ? selectedChords[i + 1] : null
    )

    return {
      role: romanNumerals[i],
      chosen,
      alternatives,
    }
  })

  return {
    chords: chordSymbols,
    romans: romanNumerals,
    slots,
    containsColorChord: hasColorChord,
    containsSecondaryDominant,
    containsBorrowedChord,
    score,
  }
}

/**
 * Score the cadence quality for a function template.
 */
function scoreCadenceForTemplate(template: FunctionTemplate, romans: string[]): number {
  if (romans.length < 2) return 0.3

  const lastRoman = romans[romans.length - 1]
  const secondLastRoman = romans[romans.length - 2]

  // Check last chord function
  const lastFn = getHarmonicFunctionFromRoman(lastRoman)
  const secondLastFn = getHarmonicFunctionFromRoman(secondLastRoman)

  let score = 0.3 // Base score

  switch (template.cadence) {
    case 'authentic':
      // D→T is ideal
      if (secondLastFn === 'D' && lastFn === 'T') score = 0.9
      else if (lastFn === 'T') score = 0.6
      break
    case 'plagal':
      // SD→T
      if (secondLastFn === 'SD' && lastFn === 'T') score = 0.8
      else if (lastFn === 'T') score = 0.5
      break
    case 'half':
      // Ends on D
      if (lastFn === 'D') score = 0.7
      break
    case 'deceptive':
      // D→non-root T
      if (secondLastFn === 'D' && lastFn === 'T') score = 0.75
      break
    case 'open':
      // No strong expectation
      score = 0.5
      break
  }

  return score
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate progression suggestions based on the harmonic field and chord scores.
 *
 * Uses a FUNCTION-BASED approach: progressions are defined in terms of
 * harmonic functions (T, SD, D) rather than specific roman numerals.
 * This allows chord selection to be driven by the chord suggestion scores,
 * ensuring that highly-scored chords appear in the suggested progressions.
 *
 * Variety is achieved through:
 * 1. Different rank offsets (0=best, 1=2nd best, 2=3rd best chords)
 * 2. Diatonic-only variants to ensure actual V, ii, iii chords appear
 * 3. Different weirdness levels for color vs. conventional progressions
 *
 * @param harmonicField - The selected harmonic field (tonic + mode)
 * @param chords - Pre-computed chord suggestions with scores and indexes
 * @param features - Riff features (optional, for backwards compatibility)
 * @param weirdness - 0 = prefer conventional progressions, 1 = prefer color-forward (default 0.5)
 */
export function generateProgressions(
  harmonicField: HarmonicFieldCandidate,
  chords: ChordSuggestionResult,
  features?: RiffFeatures,
  weirdness: number = DEFAULT_WEIRDNESS
): ProgressionSuggestion[] {
  const { tonic, mode } = harmonicField
  const tonalModeName = MODE_NAME_MAP[mode] || mode.toLowerCase()

  // Silence unused variable warning - features kept for API compatibility
  void features

  // Helper to re-score a suggestion with the actual weirdness level
  const rescoreForWeirdness = (
    suggestion: ProgressionSuggestion,
    template: FunctionTemplate
  ): ProgressionSuggestion => {
    const components: ProgressionScoreComponents = {
      fit:
        suggestion.slots.reduce((sum, s) => sum + s.chosen.supportScore, 0) /
        suggestion.slots.length,
      spice:
        suggestion.slots.reduce((sum, s) => sum + s.chosen.colorScore, 0) / suggestion.slots.length,
      motion: scoreMotion(suggestion.slots.map((slot) => slot.chosen)),
      cadence: scoreCadenceForTemplate(template, suggestion.romans),
      hasColorChord: suggestion.containsColorChord,
    }
    return { ...suggestion, score: computeFinalScore(components, weirdness) }
  }

  // Separate pools for different types of progressions
  const standardProgressions: ProgressionSuggestion[] = []
  const diatonicProgressions: ProgressionSuggestion[] = []

  const addStandard = (suggestion: ProgressionSuggestion | null) => {
    if (suggestion) standardProgressions.push(suggestion)
  }

  const addDiatonic = (suggestion: ProgressionSuggestion | null) => {
    if (suggestion) diatonicProgressions.push(suggestion)
  }

  // 1. Generate with rank offset 0 (best chords) - these are the "optimal" progressions
  for (const template of FUNCTION_TEMPLATES) {
    addStandard(
      generateFromFunctionTemplate(template, tonic, tonalModeName, chords, weirdness, 0, false)
    )
  }

  // 2. Generate with rank offset 1 (2nd best chords) - for variety
  for (const template of FUNCTION_TEMPLATES.slice(0, 8)) {
    addStandard(
      generateFromFunctionTemplate(template, tonic, tonalModeName, chords, weirdness, 1, false)
    )
  }

  // 3. Generate with rank offset 2 (3rd best chords) - more variety
  for (const template of FUNCTION_TEMPLATES.slice(0, 5)) {
    addStandard(
      generateFromFunctionTemplate(template, tonic, tonalModeName, chords, weirdness, 2, false)
    )
  }

  // 4. Generate diatonic-only progressions (ensures actual V, ii, iii appear)
  // These go into a separate pool to guarantee inclusion
  for (const template of FUNCTION_TEMPLATES.slice(0, 8)) {
    const suggestion = generateFromFunctionTemplate(
      template,
      tonic,
      tonalModeName,
      chords,
      weirdness,
      0,
      true // diatonicOnly
    )
    if (suggestion) {
      addDiatonic(rescoreForWeirdness(suggestion, template))
    }
  }

  // 5. Generate at different weirdness levels for more variety
  const weirdnessVariations = [0.0, 0.3, 0.7, 1.0].filter(
    (w) => Math.abs(w - weirdness) >= 0.2 // Skip if too close to main weirdness
  )

  for (const varWeirdness of weirdnessVariations) {
    for (const template of FUNCTION_TEMPLATES.slice(0, 4)) {
      const suggestion = generateFromFunctionTemplate(
        template,
        tonic,
        tonalModeName,
        chords,
        varWeirdness,
        0,
        false
      )
      if (suggestion) {
        addStandard(rescoreForWeirdness(suggestion, template))
      }
    }
  }

  // Deduplicate each pool separately
  const deduplicateProgressions = (
    progressions: ProgressionSuggestion[]
  ): ProgressionSuggestion[] => {
    const seen = new Set<string>()
    return progressions.filter((s) => {
      const key = s.chords.join('-')
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  const uniqueStandard = deduplicateProgressions(standardProgressions)
  const uniqueDiatonic = deduplicateProgressions(diatonicProgressions)

  // Sort each pool by score
  uniqueStandard.sort((a, b) => b.score - a.score)
  uniqueDiatonic.sort((a, b) => b.score - a.score)

  // Combine: Take top standard progressions but reserve slots for diatonic
  // This ensures diatonic progressions (with actual V, ii, iii) appear
  const result: ProgressionSuggestion[] = []
  const finalSeen = new Set<string>()

  // Take top 10 from standard
  for (const s of uniqueStandard.slice(0, 10)) {
    const key = s.chords.join('-')
    if (!finalSeen.has(key)) {
      finalSeen.add(key)
      result.push(s)
    }
  }

  // Add up to 5 diatonic progressions (that aren't duplicates)
  let diatonicAdded = 0
  for (const s of uniqueDiatonic) {
    if (diatonicAdded >= 5) break
    const key = s.chords.join('-')
    if (!finalSeen.has(key)) {
      finalSeen.add(key)
      result.push(s)
      diatonicAdded++
    }
  }

  // Fill remaining slots from standard if we have room
  for (const s of uniqueStandard.slice(10)) {
    if (result.length >= 15) break
    const key = s.chords.join('-')
    if (!finalSeen.has(key)) {
      finalSeen.add(key)
      result.push(s)
    }
  }

  // Final sort by score
  result.sort((a, b) => b.score - a.score)

  return result.slice(0, 15)
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for Testing
// ─────────────────────────────────────────────────────────────────────────────
// These exports expose internal scoring functions for unit testing.
// They are not part of the public API and may change without notice.

export {
  computeFinalScore,
  scoreAppliedChordResolution,
  scoreNeapolitanResolution,
  scoreSubstituteResolution,
  isValidTransition,
  getResolutionTarget,
}

export type { ProgressionScoreComponents, HarmonicFunction }
