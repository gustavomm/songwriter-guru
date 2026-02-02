import { Note, Chord, RomanNumeral, Key } from 'tonal'
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

/**
 * Get the harmonic function (T/SD/D) for a chord given a key context.
 * Uses Tonal's Key module for major/minor, with fallbacks for borrowed chords.
 */
function getHarmonicFunction(
  chordSymbol: string,
  roman: string,
  tonic: string,
  modeName: string
): HarmonicFunction | null {
  // Check if it's a borrowed chord first
  if (roman.startsWith('b') || (modeName === 'major' && roman === 'iv')) {
    return BORROWED_CHORD_FUNCTIONS[roman] || null
  }

  // For applied chords (V/x, vii°/x), treat as dominant function
  if (roman.includes('/')) {
    return 'D'
  }

  // Get harmonic functions from Key module
  try {
    const chord = Chord.get(chordSymbol)
    if (!chord.tonic) return null

    const chordRoot = Note.pitchClass(chord.tonic)

    if (modeName === 'major') {
      const key = Key.majorKey(tonic)
      const scaleNotes = key.scale
      const rootIndex = scaleNotes.findIndex((n: string) => Note.pitchClass(n) === chordRoot)
      if (rootIndex >= 0 && rootIndex < key.chordsHarmonicFunction.length) {
        return key.chordsHarmonicFunction[rootIndex] as HarmonicFunction
      }
    } else if (modeName === 'minor') {
      const key = Key.minorKey(tonic)
      const scaleNotes = key.natural.scale
      const rootIndex = scaleNotes.findIndex((n: string) => Note.pitchClass(n) === chordRoot)
      if (rootIndex >= 0 && rootIndex < key.natural.chordsHarmonicFunction.length) {
        return key.natural.chordsHarmonicFunction[rootIndex] as HarmonicFunction
      }
    }
  } catch {
    // Fall through to heuristic
  }

  // Fallback heuristic based on roman numeral degree
  const parsed = RomanNumeral.get(roman)
  if (parsed.empty) return null

  // Standard function assignments by scale degree
  // T = 1, 3, 6 | SD = 2, 4 | D = 5, 7
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
      return 'T' // vi/VI (tonic substitute)
    case 6:
      return 'D' // vii°/VII
    default:
      return null
  }
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

  // Normalize both for comparison (strip suffixes like "7" from V7/x)
  const targetNormalized = targetPart.replace(/[0-9°ø]+/g, '').toLowerCase()
  const nextNormalized = nextRoman.replace(/[0-9°ø]+/g, '').toLowerCase()

  // Check if the next chord is the target
  if (nextNormalized === targetNormalized) {
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
  if (roman !== 'bII') return 0
  if (!nextRoman) return NEAPOLITAN_WRONG_RESOLUTION

  // Neapolitan should resolve to V (or V7, etc.)
  const nextNormalized = nextRoman.replace(/[0-9°ø]+/g, '').toUpperCase()
  if (nextNormalized === 'V') {
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
  if (roman === 'subV' || roman === 'subV7') {
    const nextUpper = nextRoman.replace(/[0-9°ø]+/g, '').toUpperCase()
    return nextUpper === 'I' ? SUBV_CORRECT_RESOLUTION : SUBV_WRONG_RESOLUTION
  }

  // subV/x should resolve to x
  const slashIndex = roman.indexOf('/')
  if (slashIndex === -1) return 0

  const targetPart = roman.slice(slashIndex + 1)
  if (!targetPart) return 0

  // Normalize both for comparison
  const targetNormalized = targetPart.replace(/[0-9°ø]+/g, '').toLowerCase()
  const nextNormalized = nextRoman.replace(/[0-9°ø]+/g, '').toLowerCase()

  return nextNormalized === targetNormalized ? SUBV_CORRECT_RESOLUTION : SUBV_WRONG_RESOLUTION
}

/**
 * Calculate function bonus based on position in progression.
 *
 * This compensates for the fact that dominant chords often match fewer riff
 * tones but are harmonically correct in certain positions.
 *
 * Bonuses:
 * - Dominants get bonus in pre-cadential slots (slot n-2, n-1)
 * - Tonics get bonus in final slot
 * - Predominants get bonus before dominants
 *
 * @param fn - The harmonic function of the chord
 * @param position - 0-based position in the progression
 * @param totalSlots - Total number of slots in the progression
 * @param nextFn - The harmonic function of the next chord (if any)
 * @returns A bonus value (0 to 0.15)
 */
function calculateFunctionBonus(
  fn: HarmonicFunction | null,
  position: number,
  totalSlots: number,
  nextFn: HarmonicFunction | null
): number {
  if (!fn) return 0

  const isLastSlot = position === totalSlots - 1
  const isPreCadential = position >= totalSlots - 2
  const isBeforeDominant = nextFn === 'D'

  switch (fn) {
    case 'T':
      // Tonic in final slot is very good
      return isLastSlot ? 0.15 : 0
    case 'D':
      // Dominant in pre-cadential position is good
      return isPreCadential ? 0.1 : 0
    case 'SD':
      // Predominant before dominant is good
      return isBeforeDominant ? 0.08 : 0
    default:
      return 0
  }
}

/**
 * Score the cadence strength of a progression.
 * Rewards strong endings: tonic ending, authentic cadence (V→I), plagal (IV→I).
 * Also rewards proper bII→V resolution anywhere in the progression.
 */
function scoreCadence(romans: string[], chordSymbols: string[], tonic: string): number {
  let cadenceScore = 0
  const lastRoman = romans[romans.length - 1]
  const secondLast = romans.length >= 2 ? romans[romans.length - 2] : null

  // Tonic ending bonus
  if (endsOnTonic(chordSymbols[chordSymbols.length - 1], tonic)) {
    cadenceScore += 0.15
  }

  // Authentic cadence: V → I (strongest cadence)
  if (secondLast) {
    const secondLastNorm = secondLast.replace(/[0-9°ø]+/g, '').toUpperCase()
    const lastNorm = lastRoman.replace(/[0-9°ø]+/g, '').toUpperCase()
    if (secondLastNorm === 'V' && (lastNorm === 'I' || lastNorm === 'I')) {
      cadenceScore += 0.2
    }

    // Plagal cadence: IV → I
    if (secondLastNorm === 'IV' && (lastNorm === 'I' || lastNorm === 'I')) {
      cadenceScore += 0.1
    }

    // Half cadence ending on V
    if (lastNorm === 'V') {
      cadenceScore += 0.05
    }
  }

  // Neapolitan cadence: bII → V anywhere in progression
  for (let i = 0; i < romans.length - 1; i++) {
    const curr = romans[i]
    const next = romans[i + 1].replace(/[0-9°ø]+/g, '').toUpperCase()
    if (curr === 'bII' && next === 'V') {
      cadenceScore += 0.1
    }
  }

  return Math.min(1, cadenceScore)
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
]

// ─────────────────────────────────────────────────────────────────────────────
// Function-Based Chord Selection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Select a chord for a given harmonic function slot.
 *
 * @param targetFunction - The function to fill ('T', 'SD', 'D', 'T1')
 * @param chords - The chord suggestion catalog
 * @param tonic - The tonic note (for T1 constraint)
 * @param weirdness - 0 = prefer fitting, 1 = prefer colorful
 * @param excludeSymbols - Symbols to exclude (to avoid duplicates in progression)
 * @param isDeceptiveCadence - If true, exclude tonic root for T slots
 * @param rankOffset - 0 = best chord, 1 = 2nd best, etc. (for variety)
 * @param diatonicOnly - If true, only consider diatonic chords
 * @returns The selected chord, or null if none found
 */
function selectChordForFunction(
  targetFunction: string,
  chords: ChordSuggestionResult,
  tonic: string,
  weirdness: number,
  excludeSymbols: Set<string> = new Set(),
  isDeceptiveCadence: boolean = false,
  rankOffset: number = 0,
  diatonicOnly: boolean = false
): ChordSuggestion | null {
  // Map function marker to actual harmonic function
  const actualFunction: HarmonicFunction =
    targetFunction === 'T1' || targetFunction === 'T' ? 'T' : targetFunction === 'SD' ? 'SD' : 'D'

  // Get all chords with this function
  const candidates = chords.byFunction.get(actualFunction) || []

  if (candidates.length === 0) return null

  // Filter based on constraints
  let filtered = candidates.filter((c) => !excludeSymbols.has(c.symbol))

  // Diatonic-only filter: exclude secondary dominants and borrowed chords
  if (diatonicOnly) {
    filtered = filtered.filter((c) => c.source === 'diatonic')
  }

  // T1 constraint: must be the tonic root (I or i)
  if (targetFunction === 'T1') {
    filtered = filtered.filter((c) => {
      const chordObj = Chord.get(c.symbol)
      if (!chordObj.tonic) return false
      return Note.pitchClass(chordObj.tonic) === Note.pitchClass(tonic)
    })
  }

  // Deceptive cadence: exclude tonic root chords for T slots
  if (isDeceptiveCadence && targetFunction === 'T') {
    filtered = filtered.filter((c) => {
      const chordObj = Chord.get(c.symbol)
      if (!chordObj.tonic) return true
      return Note.pitchClass(chordObj.tonic) !== Note.pitchClass(tonic)
    })
  }

  if (filtered.length === 0) return null

  // Sort by weirdness-adjusted score (descending)
  const sorted = [...filtered].sort((a, b) => {
    const scoreA = computeChordSelectionScore(a.supportScore, a.colorScore, weirdness)
    const scoreB = computeChordSelectionScore(b.supportScore, b.colorScore, weirdness)
    return scoreB - scoreA
  })

  // Pick chord at the specified rank (with bounds checking)
  const index = Math.min(rankOffset, sorted.length - 1)
  return sorted[index]
}

/**
 * Get multiple chord options for a function slot, sorted by weirdness-adjusted score.
 * Used for generating alternatives.
 */
function getChordsForFunction(
  targetFunction: string,
  chords: ChordSuggestionResult,
  tonic: string,
  weirdness: number,
  limit: number = 5
): ChordSuggestion[] {
  const actualFunction: HarmonicFunction =
    targetFunction === 'T1' || targetFunction === 'T' ? 'T' : targetFunction === 'SD' ? 'SD' : 'D'

  const candidates = chords.byFunction.get(actualFunction) || []

  // For T1, filter to tonic root only
  let filtered = candidates
  if (targetFunction === 'T1') {
    filtered = candidates.filter((c) => {
      const chordObj = Chord.get(c.symbol)
      if (!chordObj.tonic) return false
      return Note.pitchClass(chordObj.tonic) === Note.pitchClass(tonic)
    })
  }

  // Sort by weirdness-adjusted score
  const sorted = [...filtered].sort((a, b) => {
    const scoreA = computeChordSelectionScore(a.supportScore, a.colorScore, weirdness)
    const scoreB = computeChordSelectionScore(b.supportScore, b.colorScore, weirdness)
    return scoreB - scoreA
  })

  return sorted.slice(0, limit)
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformation Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get the harmonic function of a roman numeral directly (without chord symbol).
 */
function getHarmonicFunctionFromRoman(roman: string): HarmonicFunction | null {
  // Borrowed chords
  if (roman.startsWith('b') || roman === 'iv') {
    return BORROWED_CHORD_FUNCTIONS[roman] || 'SD'
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

  const selectedChords: ChordSuggestion[] = []
  const chordSymbols: string[] = []
  const romanNumerals: string[] = []
  const usedSymbols = new Set<string>()

  // Determine if we need deceptive cadence handling
  const isDeceptive = template.cadence === 'deceptive'
  const lastIndex = template.functions.length - 1

  // Fill each function slot
  // Vary rank offset per slot to create more internal variety
  // Pattern: [0, 1, 0, 2, 1, 0, 2, 1] offset from base rankOffset
  const slotRankPattern = [0, 1, 0, 2, 1, 0, 2, 1]

  for (let i = 0; i < template.functions.length; i++) {
    const fn = template.functions[i]
    const isLastSlot = i === lastIndex
    const needsDeceptive = isDeceptive && isLastSlot

    // Calculate slot-specific rank offset (base offset + slot variation)
    const slotVariation = slotRankPattern[i % slotRankPattern.length]
    const slotRankOffset = rankOffset + slotVariation

    // Select chord for this function with slot-specific rank offset
    const chord = selectChordForFunction(
      fn,
      chords,
      tonic,
      weirdness,
      usedSymbols,
      needsDeceptive,
      slotRankOffset,
      diatonicOnly
    )

    if (!chord) {
      // Couldn't fill this slot - try without exclusions and rank offset as fallback
      const fallback = selectChordForFunction(
        fn,
        chords,
        tonic,
        weirdness,
        new Set(),
        needsDeceptive,
        0, // Reset rank offset for fallback
        diatonicOnly
      )
      if (!fallback) return null // Still couldn't fill - skip this template
      selectedChords.push(fallback)
      chordSymbols.push(fallback.symbol)
      romanNumerals.push(fallback.roman || fn)
    } else {
      selectedChords.push(chord)
      chordSymbols.push(chord.symbol)
      romanNumerals.push(chord.roman || fn)
      usedSymbols.add(chord.symbol)
    }
  }

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

  // Calculate motion score using function transitions
  let motionScore = 0
  for (let i = 0; i < selectedChords.length - 1; i++) {
    const currentFn = selectedChords[i].function
    const nextFn = selectedChords[i + 1].function
    if (currentFn && nextFn) {
      motionScore += TRANSITION_SCORES[currentFn]?.[nextFn] ?? 0
    }
  }
  const normalizedMotion = selectedChords.length > 1 ? motionScore / (selectedChords.length - 1) : 0

  // Calculate cadence score
  const cadenceScore = scoreCadenceForTemplate(template, romanNumerals)

  // Compute final score
  const components: ProgressionScoreComponents = {
    fit,
    spice,
    motion: Math.max(0, Math.min(1, 0.5 + normalizedMotion)), // Normalize to 0-1
    cadence: cadenceScore,
    hasColorChord,
  }
  const score = computeFinalScore(components, weirdness)

  // Build slots with alternatives
  const slots: ProgressionSlot[] = selectedChords.map((chosen, i) => {
    const fn = template.functions[i]
    // Get alternatives (other chords with same function)
    const alternatives = getChordsForFunction(fn, chords, tonic, weirdness, 4)
      .filter((c) => c.symbol !== chosen.symbol)
      .slice(0, 3)

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
      motion: 0.5,
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
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if a chord symbol represents the tonic chord.
 */
function endsOnTonic(chordSymbol: string, tonic: string): boolean {
  // Simple check: chord root matches tonic
  const chord = Chord.get(chordSymbol)
  if (!chord.tonic) return false

  // Compare pitch classes
  const chordRoot = Note.pitchClass(chord.tonic)
  const tonicPc = Note.pitchClass(tonic)

  return chordRoot === tonicPc
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports for Testing
// ─────────────────────────────────────────────────────────────────────────────
// These exports expose internal scoring functions for unit testing.
// They are not part of the public API and may change without notice.

export {
  computeFinalScore,
  scoreCadence,
  scoreAppliedChordResolution,
  scoreNeapolitanResolution,
  scoreSubstituteResolution,
  calculateFunctionBonus,
  getHarmonicFunction,
}

export type { ProgressionScoreComponents, HarmonicFunction }
