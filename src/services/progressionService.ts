import { Progression, Scale, Note, Chord, RomanNumeral, Key } from 'tonal'
import type {
    ProgressionSuggestion,
    ProgressionSlot,
    ChordSuggestionResult,
    ChordSuggestion,
    ChordSource,
    HarmonicFieldCandidate,
    RiffFeatures,
    PitchClassWeights,
} from '../domain/types'
import { calculateScores, formatChordSymbol } from './chordSuggestion'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Mode name mappings (display name -> Tonal name)
const MODE_NAME_MAP: Record<string, string> = {
    'Major': 'major',
    'Minor': 'minor',
}

// Default weirdness value (0 = conventional, 1 = color-forward)
const DEFAULT_WEIRDNESS = 0.5

// ─────────────────────────────────────────────────────────────────────────────
// Helper: Transpose down by semitones (Tonal doesn't support negative intervals)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Transpose a note down by a number of semitones.
 * Tonal's Note.transpose() doesn't support negative intervals,
 * so we use MIDI-based transposition instead.
 */
function transposeDownSemitones(note: string, semitones: number): string | null {
    const midi = Note.midi(note)
    if (midi === null) return null
    const transposed = Note.fromMidi(midi - semitones)
    return Note.pitchClass(transposed)
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring Components
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressionScoreComponents {
    fit: number              // Mean supportScore (how well chords match riff)
    spice: number            // Mean colorScore (how "interesting" the chords are)
    motion: number           // Transition score (functional harmony flow)
    cadence: number          // Ending strength (V→I, bII→V, tonic ending)
    hasColorChord: boolean   // Whether progression contains borrowed/secondary chords
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
function computeFinalScore(
    components: ProgressionScoreComponents,
    weirdness: number
): number {
    // Dramatic weight shifts based on weirdness
    // At weirdness=0: fit dominates, motion matters, spice minimal
    // At weirdness=1: spice dominates, fit minimal, motion relaxed

    const fitWeight = 0.40 * (1 - weirdness * 0.8)      // 0.40 → 0.08
    const spiceWeight = 0.10 + weirdness * 0.45         // 0.10 → 0.55
    const motionWeight = 0.30 * (1 - weirdness * 0.5)   // 0.30 → 0.15
    const cadenceWeight = 0.20                           // Constant - endings still matter

    let score =
        components.fit * fitWeight +
        components.spice * spiceWeight +
        components.motion * motionWeight +
        components.cadence * cadenceWeight

    // Color chord bonus/penalty based on weirdness
    // At low weirdness: slight penalty for having color chords (prefer diatonic)
    // At high weirdness: strong bonus for having color chords (require them!)
    if (components.hasColorChord) {
        const colorBonus = -0.15 + weirdness * 0.40  // -0.15 at 0, +0.25 at 1
        score += colorBonus
    } else {
        // No color chord - penalty at high weirdness (we WANT color!)
        const noColorPenalty = weirdness * -0.20  // 0 at 0, -0.20 at 1
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
    'T': { 'T': 0.0, 'SD': 0.15, 'D': 0.05 },  // T→SD good, T→D acceptable
    'SD': { 'T': -0.1, 'SD': 0.0, 'D': 0.20 },  // SD→D very good, SD→T retrogression
    'D': { 'T': 0.25, 'SD': -0.15, 'D': 0.0 }, // D→T best, D→SD bad retrogression
}

// Resolution scoring constants (increased for more impact)
const APPLIED_CHORD_CORRECT_RESOLUTION = 0.25
const APPLIED_CHORD_WRONG_RESOLUTION = -0.30
const NEAPOLITAN_CORRECT_RESOLUTION = 0.15
const NEAPOLITAN_WRONG_RESOLUTION = -0.15
// Substitute dominant (subV) resolution constants
const SUBV_CORRECT_RESOLUTION = 0.20
const SUBV_WRONG_RESOLUTION = -0.15

/**
 * Harmonic function assignments for borrowed chords by degree.
 * Borrowed chords preserve the function of the degree they replace.
 */
const BORROWED_CHORD_FUNCTIONS: Record<string, HarmonicFunction> = {
    'bII': 'SD',   // Neapolitan - predominant function
    'bIII': 'T',   // Borrowed mediant - tonic substitute
    'bVI': 'SD',   // Borrowed submediant - predominant
    'bVII': 'D',   // Borrowed subtonic - dominant function
    'iv': 'SD',    // Minor iv in major - predominant
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
            const rootIndex = scaleNotes.findIndex(
                (n: string) => Note.pitchClass(n) === chordRoot
            )
            if (rootIndex >= 0 && rootIndex < key.chordsHarmonicFunction.length) {
                return key.chordsHarmonicFunction[rootIndex] as HarmonicFunction
            }
        } else if (modeName === 'minor') {
            const key = Key.minorKey(tonic)
            const scaleNotes = key.natural.scale
            const rootIndex = scaleNotes.findIndex(
                (n: string) => Note.pitchClass(n) === chordRoot
            )
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
        case 0: return 'T'  // I/i
        case 1: return 'SD' // ii
        case 2: return 'T'  // iii/III
        case 3: return 'SD' // IV/iv
        case 4: return 'D'  // V/v
        case 5: return 'T'  // vi/VI (tonic substitute)
        case 6: return 'D'  // vii°/VII
        default: return null
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
            return isPreCadential ? 0.10 : 0
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
            cadenceScore += 0.20
        }

        // Plagal cadence: IV → I
        if (secondLastNorm === 'IV' && (lastNorm === 'I' || lastNorm === 'I')) {
            cadenceScore += 0.10
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
            cadenceScore += 0.10
        }
    }

    return Math.min(1, cadenceScore)
}

/**
 * Determine the chord source type based on roman numeral.
 * Used for on-the-fly score calculation.
 */
function getChordSourceFromRoman(roman: string, modeName: string): ChordSource {
    // Applied chords (V/x, vii°/x)
    if (roman.includes('/')) return 'secondary_dominant'

    // Tritone substitute
    if (roman === 'subV') return 'substitute_dominant'

    // Borrowed chords (bVII, bVI, bIII, bII, or iv in major)
    if (roman.startsWith('b')) return 'borrowed'
    if (modeName === 'major' && roman === 'iv') return 'borrowed'

    return 'diatonic'
}

// ─────────────────────────────────────────────────────────────────────────────
// Diatonic Skeletons (Backbones)
// ─────────────────────────────────────────────────────────────────────────────

interface ProgressionSkeleton {
    romans: string[]
    name: string
}

/**
 * Major key diatonic skeletons - core progressions to decorate with transformations.
 */
const MAJOR_SKELETONS: ProgressionSkeleton[] = [
    { romans: ['I', 'IV', 'V', 'I'], name: 'I-IV-V-I' },
    { romans: ['I', 'vi', 'IV', 'V'], name: 'I-vi-IV-V' },
    { romans: ['I', 'V', 'vi', 'IV'], name: 'I-V-vi-IV' },
    { romans: ['ii', 'V', 'I'], name: 'ii-V-I' },
    { romans: ['I', 'vi', 'ii', 'V'], name: 'I-vi-ii-V' },
    { romans: ['vi', 'IV', 'I', 'V'], name: 'vi-IV-I-V' },
    { romans: ['I', 'IV', 'vi', 'V'], name: 'I-IV-vi-V' },
]

/**
 * Minor key diatonic skeletons.
 */
const MINOR_SKELETONS: ProgressionSkeleton[] = [
    { romans: ['i', 'iv', 'v', 'i'], name: 'i-iv-v-i' },
    { romans: ['i', 'VI', 'III', 'VII'], name: 'i-VI-III-VII' },
    { romans: ['i', 'iv', 'VII', 'III'], name: 'i-iv-VII-III' },
    { romans: ['i', 'VII', 'VI', 'VII'], name: 'i-VII-VI-VII' },
    { romans: ['i', 'VI', 'iv', 'V'], name: 'i-VI-iv-V' },
]

// ─────────────────────────────────────────────────────────────────────────────
// Transformation Types
// ─────────────────────────────────────────────────────────────────────────────

type TransformationType =
    | 'applied_dominant'      // Insert V/x before a chord to tonicize it
    | 'chromatic_predominant' // Replace SD chord with bII (Neapolitan)
    | 'tritone_substitute'    // Replace V with subV (tritone sub)
    | 'borrowed_predominant'  // Replace IV with iv (modal mixture)
    | 'borrowed_dominant'     // Replace V with bVII

interface TransformationOpportunity {
    type: TransformationType
    position: number          // Index of the chord to transform
    targetRoman?: string      // For applied dominants, the chord being tonicized
}

/**
 * Get the harmonic function of a roman numeral directly (without chord symbol).
 * Used for skeleton analysis before chord resolution.
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
        case 0: return 'T'  // I/i
        case 1: return 'SD' // ii
        case 2: return 'T'  // iii/III
        case 3: return 'SD' // IV/iv
        case 4: return 'D'  // V/v
        case 5: return 'T'  // vi/VI
        case 6: return 'D'  // vii°/VII
        default: return null
    }
}

/**
 * Find alternative chords that could fill the same slot in a progression.
 * 
 * For applied chords (V/x, subV/x): finds other chords that resolve to the same target
 * For diatonic chords: finds other chords with the same harmonic function
 * 
 * @param roman - The roman numeral of the slot
 * @param currentChordId - The ID of the currently chosen chord (to exclude from alternatives)
 * @param chords - The chord catalog with indexes
 * @returns Array of up to 3 alternative ChordSuggestions
 */
function findAlternatives(
    roman: string,
    currentChordId: string | undefined,
    chords: ChordSuggestionResult
): ChordSuggestion[] {
    const alternatives: ChordSuggestion[] = []

    // For applied chords (V/x, vii°/x, subV/x), find alternatives that resolve to the same target
    if (roman.includes('/')) {
        const slashIndex = roman.indexOf('/')
        const target = roman.slice(slashIndex + 1)

        // Get all chords that resolve to this target
        const resolvingChords = chords.byResolvesTo.get(target) || []

        // Filter out the current chord and sort by colorScore (most interesting first)
        const filtered = resolvingChords
            .filter(c => c.id !== currentChordId && c.roman !== roman)
            .sort((a, b) => b.colorScore - a.colorScore)

        alternatives.push(...filtered.slice(0, 3))
    }

    // If we don't have enough alternatives yet, try finding same-function chords
    if (alternatives.length < 3) {
        const fn = getHarmonicFunctionFromRoman(roman)

        if (fn) {
            const sameFnChords = chords.byFunction.get(fn) || []

            // Filter out current chord and already-added alternatives
            const addedIds = new Set([currentChordId, ...alternatives.map(a => a.id)])
            const filtered = sameFnChords
                .filter(c => !addedIds.has(c.id) && c.roman !== roman)
                .sort((a, b) => b.supportScore - a.supportScore)

            const needed = 3 - alternatives.length
            alternatives.push(...filtered.slice(0, needed))
        }
    }

    return alternatives
}

/**
 * Find transformation opportunities in a skeleton based on chord functions.
 */
function findTransformationOpportunities(
    romans: string[],
    modeName: string
): TransformationOpportunity[] {
    const opportunities: TransformationOpportunity[] = []

    for (let i = 0; i < romans.length; i++) {
        const roman = romans[i]
        const fn = getHarmonicFunctionFromRoman(roman)
        const nextRoman = romans[i + 1]
        const nextFn = nextRoman ? getHarmonicFunctionFromRoman(nextRoman) : null

        // Dominant positions: applied dominant chain, tritone substitute, borrowed dominant
        if (fn === 'D' && i > 0) {
            // Tritone substitute: replace V with subV
            if (roman.toUpperCase() === 'V') {
                opportunities.push({ type: 'tritone_substitute', position: i })
                // Borrowed dominant: replace V with bVII
                if (modeName === 'major') {
                    opportunities.push({ type: 'borrowed_dominant', position: i })
                }
            }
        }

        // Applied dominant: insert V/x before any chord that can be tonicized
        // (tonicizable targets: ii, iii, IV, V, vi in major; iv, V, VI in minor)
        if (i > 0 && canBeTonicized(roman, modeName)) {
            opportunities.push({
                type: 'applied_dominant',
                position: i,
                targetRoman: roman,
            })
        }

        // Predominant positions: chromatic predominant, borrowed predominant
        if (fn === 'SD') {
            // Chromatic predominant: replace ii/IV with bII (only if followed by D)
            if (nextFn === 'D') {
                opportunities.push({ type: 'chromatic_predominant', position: i })
            }

            // Borrowed predominant: replace IV with iv in major
            if (modeName === 'major' && roman === 'IV') {
                opportunities.push({ type: 'borrowed_predominant', position: i })
            }
        }
    }

    return opportunities
}

/**
 * Check if a roman numeral chord can be tonicized (target of V/x).
 */
function canBeTonicized(roman: string, modeName: string): boolean {
    const upper = roman.toUpperCase()
    if (modeName === 'major') {
        // In major: ii, iii, IV, V, vi can be tonicized
        return ['II', 'III', 'IV', 'V', 'VI'].includes(upper)
    } else {
        // In minor: iv, V, VI, VII can be tonicized
        return ['IV', 'V', 'VI', 'VII'].includes(upper)
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Transformation Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Apply a transformation to a skeleton, returning the modified roman numeral array.
 */
function applyTransformation(
    skeleton: string[],
    opportunity: TransformationOpportunity,
    modeName: string
): string[] | null {
    const { type, position, targetRoman } = opportunity

    switch (type) {
        case 'applied_dominant':
            return applyAppliedDominant(skeleton, position, targetRoman!)

        case 'chromatic_predominant':
            return applyChromaticPredominant(skeleton, position)

        case 'tritone_substitute':
            return applyTritoneSubstitute(skeleton, position)

        case 'borrowed_predominant':
            return applyBorrowedPredominant(skeleton, position, modeName)

        case 'borrowed_dominant':
            return applyBorrowedDominant(skeleton, position)

        default:
            return null
    }
}

/**
 * Insert V/x before the target chord to create an applied dominant chain.
 * e.g., ['I', 'vi', 'IV', 'V'] with target vi at position 1 → ['I', 'V/vi', 'vi', 'IV', 'V']
 */
function applyAppliedDominant(
    skeleton: string[],
    position: number,
    targetRoman: string
): string[] | null {
    if (position < 1 || position >= skeleton.length) return null

    const result = [...skeleton]
    // Insert V/target before the target chord
    const appliedDominant = `V/${targetRoman}`
    result.splice(position, 0, appliedDominant)

    return result
}

/**
 * Replace a predominant chord with bII (Neapolitan).
 * e.g., ['I', 'IV', 'V', 'I'] with position 1 → ['I', 'bII', 'V', 'I']
 */
function applyChromaticPredominant(
    skeleton: string[],
    position: number
): string[] | null {
    if (position < 0 || position >= skeleton.length) return null

    const result = [...skeleton]
    result[position] = 'bII'
    return result
}

/**
 * Replace V with subV (tritone substitute).
 * e.g., ['ii', 'V', 'I'] → ['ii', 'subV', 'I']
 * Note: subV will be resolved to the actual chord symbol later
 */
function applyTritoneSubstitute(
    skeleton: string[],
    position: number
): string[] | null {
    if (position < 0 || position >= skeleton.length) return null

    const roman = skeleton[position]
    if (roman.toUpperCase() !== 'V') return null

    const result = [...skeleton]
    result[position] = 'subV'
    return result
}

/**
 * Replace IV with iv (borrowed from parallel minor).
 * e.g., ['I', 'IV', 'V', 'I'] → ['I', 'iv', 'V', 'I']
 */
function applyBorrowedPredominant(
    skeleton: string[],
    position: number,
    modeName: string
): string[] | null {
    if (position < 0 || position >= skeleton.length) return null
    if (modeName !== 'major') return null

    const roman = skeleton[position]
    if (roman !== 'IV') return null

    const result = [...skeleton]
    result[position] = 'iv'
    return result
}

/**
 * Replace V with bVII (borrowed subtonic).
 * e.g., ['I', 'IV', 'V', 'I'] → ['I', 'IV', 'bVII', 'I']
 */
function applyBorrowedDominant(
    skeleton: string[],
    position: number
): string[] | null {
    if (position < 0 || position >= skeleton.length) return null

    const roman = skeleton[position]
    if (roman.toUpperCase() !== 'V') return null

    const result = [...skeleton]
    result[position] = 'bVII'
    return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeleton-based Progression Generation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate all progression variations from a single skeleton.
 * Applies single transformations to create color variations.
 */
function generateFromSkeleton(
    skeleton: ProgressionSkeleton,
    tonic: string,
    modeName: string,
    chords: ChordSuggestionResult,
    pcWeights: PitchClassWeights | undefined,
    weirdness: number
): ProgressionSuggestion[] {
    const results: ProgressionSuggestion[] = []
    const seen = new Set<string>() // Deduplicate by roman sequence

    // 1. Add the pure diatonic skeleton
    const diatonic = instantiateRomans(skeleton.romans, tonic, modeName, chords, pcWeights, weirdness)
    if (diatonic) {
        const key = skeleton.romans.join('-')
        if (!seen.has(key)) {
            seen.add(key)
            results.push(diatonic)
        }
    }

    // 2. Find transformation opportunities
    const opportunities = findTransformationOpportunities(skeleton.romans, modeName)

    // 3. Apply single transformations
    for (const opp of opportunities) {
        const transformedRomans = applyTransformation(skeleton.romans, opp, modeName)
        if (!transformedRomans) continue

        const key = transformedRomans.join('-')
        if (seen.has(key)) continue // Skip duplicates
        seen.add(key)

        const suggestion = instantiateRomans(transformedRomans, tonic, modeName, chords, pcWeights, weirdness)
        if (suggestion) {
            results.push(suggestion)
        }
    }

    // 4. Apply selective double transformations (e.g., applied + borrowed)
    // Only combine compatible transformations that don't overlap
    for (let i = 0; i < opportunities.length; i++) {
        for (let j = i + 1; j < opportunities.length; j++) {
            const opp1 = opportunities[i]
            const opp2 = opportunities[j]

            // Skip if they affect the same position
            if (opp1.position === opp2.position) continue

            // Skip if both are insertions (would get complicated)
            if (opp1.type === 'applied_dominant' && opp2.type === 'applied_dominant') continue

            // Apply first transformation
            let transformed = applyTransformation(skeleton.romans, opp1, modeName)
            if (!transformed) continue

            // Adjust opp2 position if opp1 inserted a chord before it
            const adjustedOpp2 = { ...opp2 }
            if (opp1.type === 'applied_dominant' && opp2.position > opp1.position) {
                adjustedOpp2.position += 1
            }

            // Apply second transformation
            transformed = applyTransformation(transformed, adjustedOpp2, modeName)
            if (!transformed) continue

            const key = transformed.join('-')
            if (seen.has(key)) continue
            seen.add(key)

            const suggestion = instantiateRomans(transformed, tonic, modeName, chords, pcWeights, weirdness)
            if (suggestion) {
                results.push(suggestion)
            }
        }
    }

    return results
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate progression suggestions based on the harmonic field and chord scores.
 * Uses skeleton decoration to produce varied progressions with proper cadence behavior.
 * 
 * Now uses the chord catalog indexes for consistent scoring with chord suggestions.
 * 
 * @param harmonicField - The selected harmonic field (tonic + mode)
 * @param chords - Pre-computed chord suggestions with scores and indexes
 * @param features - Riff features including pitch class weights (optional for backwards compatibility)
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
    const isMinorMode = tonalModeName === 'minor'

    // Get pitch class weights for on-the-fly scoring (fallback)
    const pcWeights = features?.pcWeights

    // Select skeletons based on mode
    const skeletons = isMinorMode ? MINOR_SKELETONS : MAJOR_SKELETONS

    // Generate all variations from each skeleton
    const allSuggestions: ProgressionSuggestion[] = []

    for (const skeleton of skeletons) {
        const variations = generateFromSkeleton(
            skeleton,
            tonic,
            tonalModeName,
            chords, // Pass full chord result with indexes
            pcWeights,
            weirdness
        )
        allSuggestions.push(...variations)
    }

    // Deduplicate by chord sequence (in case different skeletons produce same result)
    const seen = new Set<string>()
    const uniqueSuggestions = allSuggestions.filter(s => {
        const key = s.chords.join('-')
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })

    // Sort by score (descending) and take top results
    uniqueSuggestions.sort((a, b) => b.score - a.score)

    return uniqueSuggestions.slice(0, 15)
}

// ─────────────────────────────────────────────────────────────────────────────
// Template Instantiation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Canonicalize a chord symbol using Tonal's chord parser.
 * Returns the canonical symbol, or the original if parsing fails.
 */
function canonicalizeChordSymbol(symbol: string): string {
    const parsed = Chord.get(symbol)
    return parsed.symbol || symbol
}

/**
 * Instantiate a roman numeral array into a progression suggestion.
 * Uses four-component scoring: fit, spice, motion, cadence.
 * 
 * Now uses the chord catalog indexes for consistent scoring.
 * Lookup priority:
 * 1. Try byRoman index (exact match)
 * 2. Try byId index (canonical symbol)
 * 3. Fall back to on-the-fly scoring
 * 
 * @param romans - Array of roman numerals
 * @param tonic - Root note of the key
 * @param modeName - 'major' or 'minor'
 * @param chords - Pre-computed chord suggestions with indexes
 * @param pcWeights - Pitch class weights for on-the-fly scoring
 * @param weirdness - 0 = conventional, 1 = color-forward
 */
/**
 * Create a minimal ChordSuggestion for chords not in the catalog.
 * Used when we derive a chord from a roman numeral but don't have full catalog data.
 */
function createMinimalChordSuggestion(
    symbol: string,
    roman: string,
    supportScore: number,
    colorScore: number,
    source: ChordSource
): ChordSuggestion {
    const chord = Chord.get(symbol)
    return {
        id: canonicalizeChordSymbol(symbol),
        symbol,
        roman,
        source,
        chordTones: chord.notes || [],
        supportScore,
        colorScore,
    }
}

function instantiateRomans(
    romans: string[],
    tonic: string,
    modeName: string,
    chords: ChordSuggestionResult,
    pcWeights: PitchClassWeights | undefined,
    weirdness: number
): ProgressionSuggestion | null {
    const chordSymbols: string[] = []
    const romanNumerals: string[] = []
    const slots: ProgressionSlot[] = []
    let containsSecondaryDominant = false
    let containsBorrowedChord = false

    // Score accumulators
    let totalSupportScore = 0
    let totalColorScore = 0
    let totalFunctionBonus = 0
    let scoredChords = 0

    // First pass: resolve all chords and collect scores
    const resolvedChords: Array<{ symbol: string; roman: string; data?: ChordSuggestion; scores?: { supportScore: number; colorScore: number } }> = []

    for (const roman of romans) {
        // Try to find chord directly from byRoman index first
        const romanCandidates = chords.byRoman.get(roman)

        let chordSymbol: string | null = null
        let chordData: ChordSuggestion | undefined

        if (romanCandidates && romanCandidates.length > 0) {
            // Pick best candidate by supportScore
            chordData = romanCandidates.reduce((a, b) =>
                a.supportScore > b.supportScore ? a : b
            )
            chordSymbol = chordData.symbol
        } else {
            // Fall back to deriving chord symbol from roman numeral
            chordSymbol = romanToChordSymbol(roman, tonic, modeName)

            if (chordSymbol) {
                // Try to find in byId index
                const canonical = canonicalizeChordSymbol(chordSymbol)
                chordData = chords.byId.get(canonical)
            }
        }

        if (!chordSymbol) {
            // Could not resolve this roman numeral, skip this progression
            return null
        }

        chordSymbols.push(chordSymbol)
        romanNumerals.push(roman)

        // Check for secondary dominant (V/x or subV)
        if (roman.includes('/') || roman === 'subV') {
            containsSecondaryDominant = true
        }

        // Check for borrowed chord (starts with 'b' for flat degrees, or iv in major)
        if (roman.match(/^b[IViv]/) || (modeName === 'major' && roman === 'iv')) {
            containsBorrowedChord = true
        }

        // Track scores for this chord (for slot building later)
        let chordScores: { supportScore: number; colorScore: number } | undefined

        if (chordData) {
            // Use pre-computed scores from chord catalog
            totalSupportScore += chordData.supportScore
            totalColorScore += chordData.colorScore
            scoredChords++
            chordScores = { supportScore: chordData.supportScore, colorScore: chordData.colorScore }
        } else if (pcWeights) {
            // Compute scores on-the-fly using same method as chord suggester
            const chord = Chord.get(chordSymbol)
            if (chord.notes.length > 0) {
                const source = getChordSourceFromRoman(roman, modeName)
                const scores = calculateScores(chord.notes, pcWeights, source)
                totalSupportScore += scores.supportScore
                totalColorScore += scores.colorScore
                scoredChords++
                chordScores = scores
            }
        } else {
            // Fallback: no pcWeights available, use neutral default
            totalSupportScore += 0.3
            totalColorScore += 0.3
            scoredChords++
            chordScores = { supportScore: 0.3, colorScore: 0.3 }
        }

        resolvedChords.push({ symbol: chordSymbol, roman, data: chordData, scores: chordScores })
    }

    // Calculate function bonuses for each slot position
    // (dominant chords in pre-cadential slots, tonics in final slot, etc.)
    for (let i = 0; i < resolvedChords.length; i++) {
        const { symbol, roman, data } = resolvedChords[i]
        const nextChord = resolvedChords[i + 1]

        // Get current chord's function (from catalog or derive from roman)
        const currentFn = data?.function || getHarmonicFunction(symbol, roman, tonic, modeName)

        // Get next chord's function (if exists)
        const nextFn = nextChord
            ? (nextChord.data?.function || getHarmonicFunction(nextChord.symbol, nextChord.roman, tonic, modeName))
            : null

        // Calculate and accumulate function bonus
        totalFunctionBonus += calculateFunctionBonus(currentFn, i, resolvedChords.length, nextFn)
    }

    // Second pass: calculate motion score (transition + resolution)
    let transitionScore = 0
    let resolutionScore = 0
    const numTransitions = romans.length - 1

    for (let i = 0; i < romans.length; i++) {
        const roman = romans[i]
        const chordSymbol = chordSymbols[i]
        const nextRoman = romans[i + 1] ?? null

        // Functional harmony transitions (for all but the last chord)
        if (i < numTransitions) {
            const currentFn = getHarmonicFunction(chordSymbol, roman, tonic, modeName)
            const nextFn = getHarmonicFunction(chordSymbols[i + 1], romans[i + 1], tonic, modeName)

            if (currentFn && nextFn) {
                transitionScore += TRANSITION_SCORES[currentFn][nextFn]
            }
        }

        // Applied chord resolution (V/x, vii°/x should resolve to x)
        if (roman.includes('/') && !roman.startsWith('subV')) {
            resolutionScore += scoreAppliedChordResolution(roman, nextRoman)
        }

        // Neapolitan resolution (bII should resolve to V)
        if (roman === 'bII') {
            resolutionScore += scoreNeapolitanResolution(roman, nextRoman)
        }

        // Tritone substitute resolution (subV→I, subV/x→x)
        if (roman.startsWith('subV')) {
            resolutionScore += scoreSubstituteResolution(roman, nextRoman)
        }
    }

    // Compute the four score components
    // Fit includes function bonus weighted at 50% to compensate for dominants
    // that don't match riff tones directly but are harmonically correct
    const baseFit = scoredChords > 0 ? totalSupportScore / scoredChords : 0
    const avgFunctionBonus = scoredChords > 0 ? totalFunctionBonus / scoredChords : 0
    const fit = Math.min(1, baseFit + avgFunctionBonus * 0.5)
    const spice = scoredChords > 0 ? totalColorScore / scoredChords : 0

    // Normalize motion score (transition + resolution combined)
    const normalizedTransition = numTransitions > 0
        ? Math.max(0, (transitionScore / numTransitions + 0.15) / 0.4)
        : 0
    const normalizedResolution = Math.max(0, Math.min(1, resolutionScore + 0.5))
    const motion = (normalizedTransition + normalizedResolution) / 2

    // Cadence score
    const cadence = scoreCadence(romanNumerals, chordSymbols, tonic)

    // Whether this progression contains color chords
    const hasColorChord = containsSecondaryDominant || containsBorrowedChord

    // Compute final score with weirdness-adjusted weights
    const components: ProgressionScoreComponents = { fit, spice, motion, cadence, hasColorChord }
    const score = computeFinalScore(components, weirdness)

    // Build slots with alternatives for each chord position
    for (const { symbol, roman, data, scores } of resolvedChords) {
        // Get or create the ChordSuggestion for this slot
        const chosen: ChordSuggestion = data || createMinimalChordSuggestion(
            symbol,
            roman,
            scores?.supportScore || 0.3,
            scores?.colorScore || 0.3,
            getChordSourceFromRoman(roman, modeName)
        )

        // Find alternative chords for this slot
        const alternatives = findAlternatives(roman, chosen.id, chords)

        slots.push({
            role: roman,
            chosen,
            alternatives,
        })
    }

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

// ─────────────────────────────────────────────────────────────────────────────
// Roman Numeral to Chord Symbol Conversion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a roman numeral to a chord symbol for the given tonic and mode.
 * Handles standard numerals, secondary dominants (V/x), tritone substitutes (subV),
 * and borrowed chords (bVII).
 */
function romanToChordSymbol(roman: string, tonic: string, modeName: string): string | null {
    let chordSymbol: string | null = null

    // Handle tritone substitute (subV = dominant chord a tritone away from tonic)
    if (roman === 'subV') {
        chordSymbol = resolveTritoneSubstitute(tonic, modeName)
    }
    // Handle secondary dominants (V/x, V7/x, vii°/x)
    else if (roman.includes('/')) {
        chordSymbol = resolveSecondaryChord(roman, tonic, modeName)
    }
    // Handle borrowed chords with flat degrees (bVII, bVI, bIII, bII)
    else if (roman.startsWith('b')) {
        chordSymbol = resolveBorrowedChord(roman, tonic, modeName)
    }
    else {
        // Standard roman numeral - use Tonal's Progression helper
        try {
            const result = Progression.fromRomanNumerals(tonic, [roman])
            if (result && result.length > 0 && result[0]) {
                chordSymbol = result[0]
            }
        } catch {
            // Tonal couldn't parse it, try manual resolution
        }

        // Manual fallback for standard numerals
        if (!chordSymbol) {
            chordSymbol = resolveStandardRoman(roman, tonic, modeName)
        }
    }

    // Format for display if we have a result
    return chordSymbol ? formatChordSymbol(chordSymbol) : null
}

/**
 * Resolve tritone substitute (subV).
 * The tritone sub is a dominant 7th chord a tritone away from the tonic,
 * resolving down by half step to I.
 * Uses Key module's substituteDominants if available.
 */
function resolveTritoneSubstitute(tonic: string, modeName: string): string | null {
    try {
        // Get the tritone substitute for the tonic from Key module
        if (modeName === 'major') {
            const key = Key.majorKey(tonic)
            // substituteDominants[0] is the subV for I
            const subV = key.substituteDominants[0]
            if (subV) return subV
        } else if (modeName === 'minor') {
            const key = Key.minorKey(tonic)
            const subV = key.natural.substituteDominants[0]
            if (subV) return subV
        }
    } catch {
        // Fall through to manual calculation
    }

    // Manual fallback: tritone sub root is a tritone (6 semitones) above tonic
    const tonicMidi = Note.midi(tonic + '4')
    if (tonicMidi === null) return null
    const subVRoot = Note.pitchClass(Note.fromMidi(tonicMidi + 6))
    return `${subVRoot}7` // Dominant 7th chord
}

/**
 * Resolve a secondary dominant or secondary leading-tone chord.
 * E.g., V/vi -> the V chord of the vi chord
 * Uses Tonal's RomanNumeral parser for both halves of the applied chord.
 */
function resolveSecondaryChord(roman: string, tonic: string, modeName: string): string | null {
    const [chordPart, targetPart] = roman.split('/')
    if (!targetPart) return null

    // Get the target chord's root
    const targetRoot = getRomanRoot(targetPart, tonic, modeName)
    if (!targetRoot) return null

    // Parse the chord part using RomanNumeral
    const chordParsed = RomanNumeral.get(chordPart)
    if (chordParsed.empty) return null

    // V/x: dominant on 5th above target
    if (chordParsed.step === 4) { // V = step 4
        const dominantRoot = Note.transpose(targetRoot, '5P')
        if (!dominantRoot) return null
        const suffix = chordParsed.chordType || ''
        return suffix ? `${dominantRoot}${suffix}` : dominantRoot
    }

    // vii°/x: diminished on semitone below target
    if (chordParsed.step === 6) { // vii = step 6
        const leadingTone = transposeDownSemitones(targetRoot, 1)
        if (!leadingTone) return null
        return `${leadingTone}${chordParsed.chordType || 'dim'}`
    }

    return null
}

/**
 * Resolve a borrowed chord with a flat degree (bVII, bVI, bIII, bII).
 * Uses Tonal's RomanNumeral parser for robust interval computation.
 */
function resolveBorrowedChord(roman: string, tonic: string, _modeName: string): string | null {
    const parsed = RomanNumeral.get(roman)
    if (parsed.empty) return null

    // Transpose tonic by the interval from RomanNumeral parser
    const root = Note.transpose(tonic, parsed.interval)
    if (!root) return null

    // Build chord type from parsed info
    let suffix = parsed.chordType || ''
    if (!parsed.major && !suffix) suffix = 'm'

    return suffix ? `${root}${suffix}` : root
}

/**
 * Manually resolve a standard roman numeral when Tonal fails.
 * Uses Tonal's RomanNumeral parser for quality and type detection.
 */
function resolveStandardRoman(roman: string, tonic: string, modeName: string): string | null {
    const parsed = RomanNumeral.get(roman)
    if (parsed.empty) return null

    const scaleName = `${tonic} ${modeName}`
    const scale = Scale.get(scaleName)
    if (!scale.notes.length || parsed.step >= scale.notes.length) return null

    const root = scale.notes[parsed.step]

    // Use chordType from parser, add 'm' for minor if no chordType
    let suffix = parsed.chordType || ''
    if (!parsed.major && !suffix) suffix = 'm'

    return suffix ? `${root}${suffix}` : root
}

/**
 * Get the root note of a roman numeral.
 * Uses Tonal's RomanNumeral parser for both flat and standard numerals.
 */
function getRomanRoot(roman: string, tonic: string, modeName: string): string | null {
    const parsed = RomanNumeral.get(roman)
    if (parsed.empty) return null

    // If altered (flat/sharp), use the interval directly
    if (parsed.alt !== 0) {
        return Note.transpose(tonic, parsed.interval)
    }

    // For unaltered numerals, use scale notes for proper spelling
    const scaleName = `${tonic} ${modeName}`
    const scale = Scale.get(scaleName)
    if (!scale.notes.length || parsed.step >= scale.notes.length) return null

    return scale.notes[parsed.step]
}

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
