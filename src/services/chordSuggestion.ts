import { Chord, Scale, Note, Key } from 'tonal'
import type {
  ChordSuggestion,
  ChordSuggestionResult,
  ChordSource,
  HarmonicFunction,
  HarmonicFieldCandidate,
  RiffFeatures,
  PitchClassWeights,
} from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Mode name mappings (display name -> Tonal name)
const MODE_NAME_MAP: Record<string, string> = {
  Major: 'major',
  Minor: 'minor',
}

// Parallel modes for borrowing (same tonic, different modes)
const PARALLEL_MODES_FOR_BORROWING = ['major', 'minor', 'dorian', 'mixolydian']

// Scoring parameters
const CLASH_PENALTY_FACTOR = 0.3
const COLOR_BONUS = 0.1
// Penalty per chord tone the riff never plays, so an extension (e.g. the G of
// Am7) only wins over the plain triad when the riff actually contains it
const MISSING_TONE_PENALTY = 0.04
// Weight below which a chord tone counts as (partly) missing from the riff
const MISSING_TONE_THRESHOLD = 0.03

// Roman numerals for Key module (indexes match array positions)
const MAJOR_ROMAN_FROM_KEY = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
// Natural minor: no raised degrees
const MINOR_NATURAL_ROMAN = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']
// Harmonic minor: raised 7th gives V and vii° (strong dominant function)
const MINOR_HARMONIC_ROMAN = ['i', 'ii°', 'III+', 'iv', 'V', 'VI', 'vii°']
// Melodic minor: raised 6th and 7th (jazz/modern color)
const MINOR_MELODIC_ROMAN = ['i', 'ii', 'III+', 'IV', 'V', 'vi°', 'vii°']

/**
 * Harmonic function by the chord root's distance above the tonic (semitones).
 * Used for borrowed chords and for diatonic chords Tonal leaves unlabeled
 * (melodic minor vi° / vii°), so every chord can fill a progression slot:
 * I/iii/vi-ish → T, ii/IV → SD, V/vii → D, bII (Neapolitan) and bVI → SD,
 * bIII → T, bVII / minor VII → D (subtonic dominant substitute).
 */
const FUNCTION_BY_SEMITONES: readonly HarmonicFunction[] = [
  'T', // 0: I / i
  'SD', // 1: bII (Neapolitan)
  'SD', // 2: ii / II
  'T', // 3: bIII / III (minor mediant)
  'T', // 4: iii / #III
  'SD', // 5: IV / iv
  'SD', // 6: #iv° / bV
  'D', // 7: V / v
  'SD', // 8: bVI / VI
  'T', // 9: vi (diminished vi° is predominant, see harmonicFunctionForChord)
  'D', // 10: bVII / VII (subtonic)
  'D', // 11: vii°
]

/**
 * Degree numerals by semitones above the tonic, used to name borrowed chords.
 * Minor keys name their own natural degrees without accidentals (III, VI, VII)
 * so a borrowed chord gets the same numeral as the diatonic chord on that
 * root (Gmaj7 is VIImaj7 in A minor, like diatonic G = VII); raised 6th and
 * 7th degrees match the harmonic/melodic minor labels (vi°, vii°).
 */
const BORROWED_DEGREE_NUMERALS: Record<string, readonly string[]> = {
  major: ['I', 'bII', 'II', 'bIII', 'III', 'IV', 'bV', 'V', 'bVI', 'VI', 'bVII', 'VII'],
  minor: ['I', 'bII', 'II', 'III', '#III', 'IV', '#IV', 'V', 'VI', 'VI', 'VII', 'VII'],
}

/**
 * Harmonic function of a chord from its root's scale degree and its quality.
 */
function harmonicFunctionForChord(
  root: string,
  tonic: string,
  intervals: readonly string[]
): HarmonicFunction {
  const semitones = ((Note.chroma(root) ?? 0) - (Note.chroma(tonic) ?? 0) + 12) % 12
  // A diminished chord on the (raised) 6th, e.g. F#ø7 in A minor, sounds like
  // a rootless IV7/ii9: predominant rather than tonic
  if (semitones === 9 && intervals.includes('5d')) return 'SD'
  return FUNCTION_BY_SEMITONES[semitones]
}

/**
 * Key for comparing chords by sound rather than spelling: root pitch class
 * plus the sorted pitch-class set (so enharmonic spellings compare equal).
 */
function chordPitchKey(notes: readonly string[]): string {
  const pcs = notes.map((n) => Note.chroma(n)).filter((pc): pc is number => pc !== undefined)
  if (pcs.length === 0) return ''
  return `${pcs[0]}:${[...pcs].sort((a, b) => a - b).join(',')}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get canonical (stable) symbol for a chord using Tonal's chord parser.
 * This is used as the `id` field for reliable lookups.
 */
function getCanonicalSymbol(symbol: string): string {
  const chord = Chord.get(symbol)
  return chord.symbol || symbol
}

/**
 * Respell a chord whose root has a double accidental (e.g. Tonal's tritone
 * substitute 'Dbb7' for subV/VI in Eb minor) with its simpler enharmonic root
 * ('C7'). Other symbols are returned unchanged.
 */
function simplifyDoubleAccidentalRoot(symbol: string): string {
  const chord = Chord.get(symbol)
  if (chord.empty || !chord.tonic || !/##|bb/.test(chord.tonic)) return symbol
  const suffix = chord.aliases[0] ?? ''
  return `${Note.simplify(chord.tonic)}${suffix}`
}

/**
 * Build a roman numeral that reflects a chord's actual quality.
 *
 * The degree numeral (e.g. 'IV', 'bVII', 'vii°') only supplies the scale degree
 * and any chromatic prefix; case and suffix come from the chord's intervals:
 * - Triads: I (major), i (minor), i° (diminished), I+ (augmented)
 * - Sevenths: Imaj7, V7, ii7, i(maj7), iiø7, vii°7, III+maj7, I+7
 * - Sixths: I6 (major sixth), i6 (minor sixth)
 */
export function romanForChord(degreeNumeral: string, intervals: readonly string[]): string {
  const match = /^([b#]*)(IV|iv|VI{0,3}|vi{0,3}|I{1,3}|i{1,3})/.exec(degreeNumeral)
  const accidental = match?.[1] ?? ''
  const numeral = (match?.[2] ?? degreeNumeral).toUpperCase()

  const has = (ivl: string) => intervals.includes(ivl)
  const isMinorThird = has('3m')
  const base = accidental + (isMinorThird ? numeral.toLowerCase() : numeral)

  // Diminished family
  if (has('5d') && isMinorThird) {
    if (has('7d')) return `${base}°7`
    if (has('7m')) return `${base}ø7`
    return `${base}°`
  }

  // Augmented family
  if (has('5A') && !isMinorThird) {
    if (has('7M')) return `${base}+maj7`
    if (has('7m')) return `${base}+7`
    return `${base}+`
  }

  // Seventh chords
  if (has('7M')) return isMinorThird ? `${base}(maj7)` : `${base}maj7`
  if (has('7m')) return `${base}7`

  // Added sixth chords (e.g. melodic minor tonic m6)
  if (has('6M')) return `${base}6`

  return base
}

// ─────────────────────────────────────────────────────────────────────────────
// Key Module Helpers (for major/minor modes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build diatonic chord suggestions from Key module triads and 7ths arrays.
 * Roman numerals are derived from each chord's actual quality, using the
 * romanNumerals array only for the scale degree, so e.g. melodic minor's
 * tonic Em6 is labelled 'i6' (not 'i7') and harmonic minor's AmMaj7 'i(maj7)'.
 */
function buildDiatonicFromKey(
  triads: readonly string[],
  sevenths: readonly string[],
  harmonicFunctions: readonly string[],
  romanNumerals: readonly string[],
  pcWeights: PitchClassWeights
): ChordSuggestion[] {
  const chords: ChordSuggestion[] = []
  const tonic = Chord.get(triads[0] ?? '').tonic ?? ''

  // Tonal leaves some functions blank (melodic minor vi° and vii°): derive
  // those from the scale degree so every diatonic chord can fill a slot
  const functionFor = (i: number, chord: { tonic: string | null; intervals: string[] }) =>
    (harmonicFunctions[i] as HarmonicFunction | '' | undefined) ||
    (chord.tonic && tonic
      ? harmonicFunctionForChord(chord.tonic, tonic, chord.intervals)
      : undefined)

  // Add triads
  for (let i = 0; i < triads.length; i++) {
    const rawSymbol = triads[i]
    if (!rawSymbol) continue

    const chord = Chord.get(rawSymbol)
    if (!chord.notes.length) continue

    const scores = calculateScores(chord.notes, pcWeights, 'diatonic')
    const hf = functionFor(i, chord) // T, SD, or D

    chords.push({
      id: getCanonicalSymbol(rawSymbol),
      symbol: formatChordSymbol(rawSymbol),
      roman: romanForChord(romanNumerals[i], chord.intervals),
      function: hf,
      degree: i,
      source: 'diatonic',
      sourceDetail: hf
        ? `Harmonic function: ${hf === 'T' ? 'Tonic' : hf === 'SD' ? 'Subdominant' : 'Dominant'}`
        : undefined,
      chordTones: chord.notes,
      supportScore: scores.supportScore,
      colorScore: scores.colorScore,
    })
  }

  // Add 7th chords
  for (let i = 0; i < sevenths.length; i++) {
    const rawSymbol = sevenths[i]
    if (!rawSymbol) continue

    const chord = Chord.get(rawSymbol)
    if (!chord.notes.length) continue

    const scores = calculateScores(chord.notes, pcWeights, 'diatonic')
    const hf = functionFor(i, chord)

    chords.push({
      id: getCanonicalSymbol(rawSymbol),
      symbol: formatChordSymbol(rawSymbol),
      roman: romanForChord(romanNumerals[i], chord.intervals),
      function: hf,
      degree: i,
      source: 'diatonic',
      chordTones: chord.notes,
      supportScore: scores.supportScore,
      colorScore: scores.colorScore,
    })
  }

  return chords
}

/**
 * Build secondary dominant suggestions from Key module secondaryDominants array.
 */
function buildSecondaryFromKey(
  secondaryDominants: readonly string[],
  romanNumerals: readonly string[],
  pcWeights: PitchClassWeights
): ChordSuggestion[] {
  const chords: ChordSuggestion[] = []

  for (let i = 0; i < secondaryDominants.length; i++) {
    const rawSymbol = simplifyDoubleAccidentalRoot(secondaryDominants[i])
    if (!rawSymbol) continue // Empty string means no secondary dominant for this degree

    const chord = Chord.get(rawSymbol)
    if (!chord.notes.length) continue

    const scores = calculateScores(chord.notes, pcWeights, 'secondary_dominant')
    const targetRoman = romanNumerals[i]

    chords.push({
      id: getCanonicalSymbol(rawSymbol),
      symbol: formatChordSymbol(rawSymbol),
      roman: `V/${targetRoman}`,
      function: 'D', // Secondary dominants have dominant function
      resolvesToRoman: targetRoman,
      source: 'secondary_dominant',
      sourceDetail: `Secondary dominant resolving to ${targetRoman}`,
      chordTones: chord.notes,
      supportScore: scores.supportScore,
      colorScore: scores.colorScore,
    })
  }

  return chords
}

/**
 * Build substitute dominant (tritone sub) suggestions from Key module substituteDominants array.
 * These are "weird but works" chords - tritone substitutes for secondary dominants.
 */
function buildSubstitutesFromKey(
  substituteDominants: readonly string[],
  romanNumerals: readonly string[],
  pcWeights: PitchClassWeights
): ChordSuggestion[] {
  const chords: ChordSuggestion[] = []

  for (let i = 0; i < substituteDominants.length; i++) {
    const rawSymbol = simplifyDoubleAccidentalRoot(substituteDominants[i])
    if (!rawSymbol) continue // Empty string means no substitute for this degree

    const chord = Chord.get(rawSymbol)
    if (!chord.notes.length) continue

    const scores = calculateScores(chord.notes, pcWeights, 'substitute_dominant')
    const targetRoman = romanNumerals[i]

    chords.push({
      id: getCanonicalSymbol(rawSymbol),
      symbol: formatChordSymbol(rawSymbol),
      roman: `subV/${targetRoman}`,
      function: 'D', // Substitute dominants have dominant function
      resolvesToRoman: targetRoman,
      source: 'substitute_dominant',
      sourceDetail: `Tritone substitute resolving to ${targetRoman}`,
      chordTones: chord.notes,
      supportScore: scores.supportScore,
      colorScore: scores.colorScore,
    })
  }

  return chords
}

/**
 * Generate all chords using Tonal's Key module for major/minor modes.
 */
function generateChordsFromKey(
  tonic: string,
  modeName: string,
  pcWeights: PitchClassWeights
): { diatonic: ChordSuggestion[]; secondary: ChordSuggestion[]; substitutes: ChordSuggestion[] } {
  if (modeName === 'major') {
    const key = Key.majorKey(tonic)
    return {
      diatonic: buildDiatonicFromKey(
        key.triads,
        key.chords,
        key.chordsHarmonicFunction,
        MAJOR_ROMAN_FROM_KEY,
        pcWeights
      ),
      secondary: buildSecondaryFromKey(key.secondaryDominants, MAJOR_ROMAN_FROM_KEY, pcWeights),
      substitutes: buildSubstitutesFromKey(
        key.substituteDominants,
        MAJOR_ROMAN_FROM_KEY,
        pcWeights
      ),
    }
  }

  if (modeName === 'minor') {
    const key = Key.minorKey(tonic)

    // Build diatonic chords from all three minor variants:
    // - Natural minor: provides bVII, bVI, bIII (mixture flavor)
    // - Harmonic minor: provides strong V7 and vii° (raised 7th)
    // - Melodic minor: provides modern/jazz color (raised 6th and 7th)
    // Tonal labels natural minor's VII as SD; the subtonic works as a
    // dominant substitute (VII → i, VI–VII–i), so treat it as 'D'
    const naturalFunctions = key.natural.chordsHarmonicFunction.map((fn, i) => (i === 6 ? 'D' : fn))
    const naturalDiatonic = buildDiatonicFromKey(
      key.natural.triads,
      key.natural.chords,
      naturalFunctions,
      MINOR_NATURAL_ROMAN,
      pcWeights
    )
    const harmonicDiatonic = buildDiatonicFromKey(
      key.harmonic.triads,
      key.harmonic.chords,
      key.harmonic.chordsHarmonicFunction,
      MINOR_HARMONIC_ROMAN,
      pcWeights
    )
    const melodicDiatonic = buildDiatonicFromKey(
      key.melodic.triads,
      key.melodic.chords,
      key.melodic.chordsHarmonicFunction,
      MINOR_MELODIC_ROMAN,
      pcWeights
    )

    // Harmonic/melodic minor chords that aren't natural minor and aren't the
    // raised-7th dominants (V, vii°) are colour: i(maj7), i6, III+, ii, IV7...
    // Mark them so "safe" progressions prefer plain i / i7, and give them the
    // same colour bonus as other non-diatonic chords
    const naturalSymbols = new Set(naturalDiatonic.map((c) => c.symbol))
    const markColorVariants = (chords: ChordSuggestion[]): ChordSuggestion[] =>
      chords.map((c) =>
        naturalSymbols.has(c.symbol) || c.function === 'D'
          ? c
          : { ...c, colorVariant: true, colorScore: Math.min(1, c.colorScore + COLOR_BONUS) }
      )

    // Union all diatonic chords, using mergeChordDuplicates to handle overlaps
    const allDiatonic = mergeChordDuplicates([
      ...naturalDiatonic,
      ...markColorVariants(harmonicDiatonic),
      ...markColorVariants(melodicDiatonic),
    ])

    // Use harmonic minor for secondary dominants (strongest V/x, vii°/x)
    const secondary = buildSecondaryFromKey(
      key.harmonic.secondaryDominants,
      MINOR_HARMONIC_ROMAN,
      pcWeights
    )
    const substitutes = buildSubstitutesFromKey(
      key.harmonic.substituteDominants,
      MINOR_HARMONIC_ROMAN,
      pcWeights
    )

    return {
      diatonic: allDiatonic,
      secondary,
      substitutes,
    }
  }

  return { diatonic: [], secondary: [], substitutes: [] }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chord Deduplication
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge duplicate chords (same symbol) into a single entry with multiple sources.
 * Uses the highest scores from any duplicate.
 */
function mergeChordDuplicates(chords: ChordSuggestion[]): ChordSuggestion[] {
  const chordMap = new Map<string, ChordSuggestion>()

  for (const chord of chords) {
    const existing = chordMap.get(chord.symbol)

    if (existing) {
      // Merge sources
      const allSources = new Set<ChordSource>()
      allSources.add(existing.source)
      if (existing.sources) {
        existing.sources.forEach((s) => allSources.add(s))
      }
      allSources.add(chord.source)
      if (chord.sources) {
        chord.sources.forEach((s) => allSources.add(s))
      }

      // Merge source details
      const allDetails: string[] = []
      if (existing.sourceDetail) allDetails.push(existing.sourceDetail)
      if (existing.sourceDetails) allDetails.push(...existing.sourceDetails)
      if (chord.sourceDetail && !allDetails.includes(chord.sourceDetail)) {
        allDetails.push(chord.sourceDetail)
      }
      if (chord.sourceDetails) {
        chord.sourceDetails.forEach((d) => {
          if (!allDetails.includes(d)) allDetails.push(d)
        })
      }

      // Convert Set to array, use first as primary source
      const sourcesArray = Array.from(allSources)
      const primarySource = sourcesArray[0]
      const additionalSources = sourcesArray.length > 1 ? sourcesArray : undefined

      // Take the best scores and preserve id from first occurrence
      chordMap.set(chord.symbol, {
        ...existing,
        id: existing.id || chord.id, // Keep canonical id
        source: primarySource,
        sources: additionalSources,
        sourceDetail: allDetails[0],
        sourceDetails: allDetails.length > 1 ? allDetails : undefined,
        supportScore: Math.max(existing.supportScore, chord.supportScore),
        colorScore: Math.max(existing.colorScore, chord.colorScore),
      })
    } else {
      chordMap.set(chord.symbol, { ...chord })
    }
  }

  return Array.from(chordMap.values())
}

// ─────────────────────────────────────────────────────────────────────────────
// Colour distance (how far a chord is from the plain key)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Base colour distance by kind of chord, before counting its notes outside
 * the key: colour variant < secondary dominant < borrowed < parallel tonic <
 * tritone sub / Neapolitan.
 */
const COLOR_BASE = {
  colorVariant: 0.3,
  secondary: 0.3,
  secondaryOther: 0.35,
  borrowed: 0.35,
  parallelTonic: 0.6,
  neapolitan: 0.7,
  substitute: 0.7,
} as const
/** Added colour distance per chord tone outside the key */
const COLOR_PER_CHROMATIC_NOTE = 0.15

/**
 * Pitch classes that count as "in the key": the scale, plus the leading tone
 * in minor (harmonic minor's V and vii° are everyday minor-key chords).
 */
function keyPitchClasses(tonic: string, modeName: string): Set<number> {
  const scale = Scale.get(`${tonic} ${modeName === 'minor' ? 'minor' : 'major'}`)
  const pcs = new Set(
    scale.notes.map((n) => Note.chroma(n)).filter((pc): pc is number => pc !== undefined)
  )
  const tonicPc = Note.chroma(tonic)
  if (modeName === 'minor' && tonicPc !== undefined) pcs.add((tonicPc + 11) % 12)
  return pcs
}

/**
 * Colour distance of a chord from the key (0 = plain diatonic): a base by
 * the kind of chord (see COLOR_BASE) plus COLOR_PER_CHROMATIC_NOTE for each
 * chord tone outside the key. A chord with several sources takes the
 * closest one (E7 in A minor is diatonic, not a secondary dominant).
 */
export function chordColorDistance(
  chord: ChordSuggestion,
  tonic: string,
  modeName: string
): number {
  const keyPcs = keyPitchClasses(tonic, modeName)
  const chordPcs = chord.chordTones
    .map((n) => Note.chroma(n))
    .filter((pc): pc is number => pc !== undefined)
  const chromatic = new Set(chordPcs.filter((pc) => !keyPcs.has(pc))).size

  const sources = new Set<ChordSource>([chord.source, ...(chord.sources ?? [])])
  const rootPc = chordPcs[0]
  const tonicPc = Note.chroma(tonic) ?? 0
  const rootDistance = rootPc === undefined ? -1 : (rootPc - tonicPc + 12) % 12

  let base: number
  if (sources.has('diatonic')) {
    base = chord.colorVariant ? COLOR_BASE.colorVariant : 0
  } else if (sources.has('secondary_dominant')) {
    base = COLOR_BASE.secondary
  } else if (sources.has('secondary_leading_tone') || sources.has('secondary_supertonic')) {
    base = COLOR_BASE.secondaryOther
  } else if (sources.has('borrowed')) {
    base =
      rootDistance === 1
        ? COLOR_BASE.neapolitan
        : rootDistance === 0
          ? COLOR_BASE.parallelTonic
          : COLOR_BASE.borrowed
  } else {
    base = COLOR_BASE.substitute
  }
  if (base === 0 && chromatic === 0) return 0
  return Math.round((base + COLOR_PER_CHROMATIC_NOTE * chromatic) * 100) / 100
}

function withColorDistance(
  chord: ChordSuggestion,
  tonic: string,
  modeName: string
): ChordSuggestion {
  return { ...chord, colorDistance: chordColorDistance(chord, tonic, modeName) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Export
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate chord suggestions for the selected harmonic field.
 * Uses Tonal's Key module for major/minor modes.
 * Includes diatonic chords, secondary dominants, tritone substitutes,
 * and borrowed chords from parallel modes.
 *
 * Returns categorized arrays plus indexes for efficient progression building.
 */
export function generateChordSuggestions(
  harmonicField: HarmonicFieldCandidate,
  features: RiffFeatures
): ChordSuggestionResult {
  const { tonic, mode } = harmonicField
  const { pcWeights } = features

  // Convert display mode name to Tonal mode name
  const tonalModeName = MODE_NAME_MAP[mode] || mode.toLowerCase()

  // Generate chords using Tonal's Key module (only major/minor supported)
  const keyChords = generateChordsFromKey(tonic, tonalModeName, pcWeights)
  const diatonicChords = keyChords.diatonic
  // Combine secondary dominants and tritone substitutes
  const secondaryChords = [...keyChords.secondary, ...keyChords.substitutes]
  const borrowedChords = generateBorrowedChords(tonic, tonalModeName, pcWeights, diatonicChords)

  // Sort each category by supportScore (best-fitting chords first)
  const sortBySupport = (a: ChordSuggestion, b: ChordSuggestion) => b.supportScore - a.supportScore
  const annotate = (c: ChordSuggestion) => withColorDistance(c, tonic, tonalModeName)
  const sortedDiatonic = diatonicChords.map(annotate).sort(sortBySupport)
  const sortedSecondary = secondaryChords.map(annotate).sort(sortBySupport)
  const sortedBorrowed = borrowedChords.map(annotate).sort(sortBySupport)

  // Create ranked list with merged duplicates
  const allChords = [...diatonicChords, ...secondaryChords, ...borrowedChords]
  const mergedChords = mergeChordDuplicates(allChords).map((c) =>
    withColorDistance(c, tonic, tonalModeName)
  )
  const rankedByColor = [...mergedChords].sort((a, b) => {
    // Primary sort by colorScore, secondary by supportScore
    if (Math.abs(b.colorScore - a.colorScore) > 0.01) {
      return b.colorScore - a.colorScore
    }
    return b.supportScore - a.supportScore
  })

  // Build indexes for progression building
  const byId = new Map<string, ChordSuggestion>()
  const byRoman = new Map<string, ChordSuggestion[]>()
  const byFunction = new Map<HarmonicFunction, ChordSuggestion[]>()
  const byResolvesTo = new Map<string, ChordSuggestion[]>()

  for (const chord of mergedChords) {
    // Index by canonical id
    byId.set(chord.id, chord)

    // Index by roman numeral
    if (chord.roman) {
      const existing = byRoman.get(chord.roman) || []
      existing.push(chord)
      byRoman.set(chord.roman, existing)
    }

    // Index by harmonic function
    if (chord.function) {
      const existing = byFunction.get(chord.function) || []
      existing.push(chord)
      byFunction.set(chord.function, existing)
    }

    // Index by resolution target (for applied chords)
    if (chord.resolvesToRoman) {
      const existing = byResolvesTo.get(chord.resolvesToRoman) || []
      existing.push(chord)
      byResolvesTo.set(chord.resolvesToRoman, existing)
    }
  }

  return {
    diatonic: sortedDiatonic,
    secondary: sortedSecondary,
    borrowed: sortedBorrowed,
    ranked: rankedByColor,
    byId,
    byRoman,
    byFunction,
    byResolvesTo,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Chord Type Helpers (used by borrowed chord generation)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Get triad chord type for a scale degree based on mode.
 */
function getChordTypeForDegree(modeName: string, degree: number): string {
  // Chord qualities by mode (0-indexed scale degrees)
  const chordQualities: Record<string, string[]> = {
    major: ['M', 'm', 'm', 'M', 'M', 'm', 'dim'],
    minor: ['m', 'dim', 'M', 'm', 'm', 'M', 'M'],
    dorian: ['m', 'm', 'M', 'M', 'm', 'dim', 'M'],
    phrygian: ['m', 'M', 'M', 'm', 'dim', 'M', 'm'],
    lydian: ['M', 'M', 'm', 'dim', 'M', 'm', 'm'],
    mixolydian: ['M', 'm', 'dim', 'M', 'm', 'm', 'M'],
    locrian: ['dim', 'M', 'm', 'm', 'M', 'M', 'm'],
  }

  const qualities = chordQualities[modeName] || chordQualities.major
  return qualities[degree] || 'M'
}

/**
 * Get 7th chord type for a scale degree based on mode.
 */
function getSeventhChordTypeForDegree(modeName: string, degree: number): string {
  // 7th chord qualities by mode
  const seventhQualities: Record<string, string[]> = {
    major: ['maj7', 'm7', 'm7', 'maj7', '7', 'm7', 'm7b5'],
    minor: ['m7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7', '7'],
    dorian: ['m7', 'm7', 'maj7', '7', 'm7', 'm7b5', 'maj7'],
    phrygian: ['m7', 'maj7', '7', 'm7', 'm7b5', 'maj7', 'm7'],
    lydian: ['maj7', '7', 'm7', 'm7b5', 'maj7', 'm7', 'm7'],
    mixolydian: ['7', 'm7', 'm7b5', 'maj7', 'm7', 'm7', 'maj7'],
    locrian: ['m7b5', 'maj7', 'm7', 'm7', 'maj7', '7', 'm7'],
  }

  const qualities = seventhQualities[modeName] || seventhQualities.major
  return qualities[degree] || 'maj7'
}

// ─────────────────────────────────────────────────────────────────────────────
// Borrowed Chords (Modal Mixture)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generate borrowed chords from parallel modes.
 */
function generateBorrowedChords(
  tonic: string,
  baseModeName: string,
  pcWeights: PitchClassWeights,
  diatonicChords: readonly ChordSuggestion[]
): ChordSuggestion[] {
  // Chords already in the key (the full diatonic set: in minor that includes
  // harmonic and melodic minor) are not "borrowed". Compare by sound so that
  // e.g. D7 / Bm7 / E7 in A minor don't show up in both tabs.
  const diatonicKeys = new Set(diatonicChords.map((c) => chordPitchKey(c.chordTones)))
  const isDiatonic = (notes: readonly string[]) => diatonicKeys.has(chordPitchKey(notes))

  const borrowedChords: ChordSuggestion[] = []

  // Borrow from parallel modes
  for (const sourceModeName of PARALLEL_MODES_FOR_BORROWING) {
    if (sourceModeName === baseModeName) continue

    const sourceScaleName = `${tonic} ${sourceModeName}`
    const sourceScale = Scale.get(sourceScaleName)

    if (!sourceScale.notes.length) continue

    const sourceDisplayName = getDisplayModeName(sourceModeName)

    for (let degree = 0; degree < sourceScale.notes.length; degree++) {
      // Parallel modes of flat keys can contain double flats (Db minor has Bbb):
      // respell those roots enharmonically (Bbb → A) for readable symbols
      const scaleNote = sourceScale.notes[degree]
      const root = /##|bb/.test(scaleNote) ? Note.simplify(scaleNote) : scaleNote
      const triadType = getChordTypeForDegree(sourceModeName, degree)
      const seventhType = getSeventhChordTypeForDegree(sourceModeName, degree)

      // Check if triad is different from the key's own chords
      const triadSymbol = `${root}${triadType}`
      const chord = Chord.get(triadSymbol)
      if (!isDiatonic(chord.notes)) {
        if (chord.notes.length) {
          const scores = calculateScores(chord.notes, pcWeights, 'borrowed')
          const roman = getBorrowedRomanNumeral(root, triadType, tonic, baseModeName)
          const harmonicFn = harmonicFunctionForChord(root, tonic, chord.intervals)

          borrowedChords.push({
            id: getCanonicalSymbol(triadSymbol),
            symbol: formatChordSymbol(root, triadType),
            roman,
            function: harmonicFn,
            source: 'borrowed',
            sourceDetail: `Borrowed from parallel ${sourceDisplayName}`,
            chordTones: chord.notes,
            supportScore: scores.supportScore,
            colorScore: scores.colorScore,
          })
        }
      }

      // Check if 7th chord is different from the key's own chords
      const seventhSymbolKey = `${root}${seventhType}`
      const seventhChord = Chord.get(seventhSymbolKey)
      if (!isDiatonic(seventhChord.notes)) {
        if (seventhChord.notes.length) {
          const scores = calculateScores(seventhChord.notes, pcWeights, 'borrowed')
          const roman = getBorrowedRomanNumeral(root, seventhType, tonic, baseModeName)
          const harmonicFn = harmonicFunctionForChord(root, tonic, seventhChord.intervals)

          borrowedChords.push({
            id: getCanonicalSymbol(seventhSymbolKey),
            symbol: formatChordSymbol(root, seventhType),
            roman,
            function: harmonicFn,
            source: 'borrowed',
            sourceDetail: `Borrowed from parallel ${sourceDisplayName}`,
            chordTones: seventhChord.notes,
            supportScore: scores.supportScore,
            colorScore: scores.colorScore,
          })
        }
      }
    }
  }

  // Remove duplicates (same chord symbol from different sources)
  const uniqueChords = new Map<string, ChordSuggestion>()
  for (const chord of borrowedChords) {
    const key = chord.symbol
    if (!uniqueChords.has(key) || chord.colorScore > uniqueChords.get(key)!.colorScore) {
      uniqueChords.set(key, chord)
    }
  }

  return Array.from(uniqueChords.values())
}

/**
 * Get display name for a mode.
 */
function getDisplayModeName(tonalModeName: string): string {
  const displayNames: Record<string, string> = {
    major: 'Ionian',
    minor: 'Aeolian',
    dorian: 'Dorian',
    phrygian: 'Phrygian',
    lydian: 'Lydian',
    mixolydian: 'Mixolydian',
    locrian: 'Locrian',
  }
  return displayNames[tonalModeName] || tonalModeName
}

/**
 * Get a roman numeral for a borrowed chord, e.g. 'bVII', 'iv7', 'bVImaj7', 'iiø7'.
 * The degree comes from the root's semitone distance to the tonic, named
 * relative to the key's mode (see BORROWED_DEGREE_NUMERALS); case and suffix
 * come from the chord quality (see romanForChord).
 */
function getBorrowedRomanNumeral(
  root: string,
  chordType: string,
  tonic: string,
  baseModeName: string
): string {
  const rootPc = Note.chroma(root) ?? 0
  const tonicPc = Note.chroma(tonic) ?? 0
  const degreeFromTonic = (rootPc - tonicPc + 12) % 12

  const numerals = BORROWED_DEGREE_NUMERALS[baseModeName] ?? BORROWED_DEGREE_NUMERALS.major
  const numeral = numerals[degreeFromTonic] || 'I'
  return romanForChord(numeral, Chord.get(`${root}${chordType}`).intervals)
}

// ─────────────────────────────────────────────────────────────────────────────
// Scoring (exported for use by progressionService)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate support score and color score for a chord.
 *
 * Support score = what percentage of the riff's total weight falls on chord tones
 * Color score = support score minus clash penalty, plus bonus for non-diatonic chords
 *
 * @param chordTones - Array of note names in the chord
 * @param pcWeights - Pitch class weights from the riff
 * @param source - Source type for color bonus calculation
 * @returns Object with supportScore and colorScore (both 0-1)
 */
export function calculateScores(
  chordTones: string[],
  pcWeights: PitchClassWeights,
  source: ChordSource
): { supportScore: number; colorScore: number } {
  // Convert chord tones to pitch classes
  const chordPCs = chordTones
    .map((note) => Note.chroma(note))
    .filter((pc): pc is number => pc !== undefined)

  if (chordPCs.length === 0) {
    return { supportScore: 0, colorScore: 0 }
  }

  // Support score: total weight of riff notes that are chord tones
  // Since pcWeights sum to 1.0, this directly gives us the percentage of the riff
  // that "belongs" to this chord
  let supportSum = 0
  let missingTones = 0
  for (const pc of chordPCs) {
    supportSum += pcWeights[pc]
    // Chord tones the riff (almost) never plays count against the chord, so a
    // 7th chord doesn't automatically beat its triad on equal coverage
    missingTones += Math.max(0, 1 - pcWeights[pc] / MISSING_TONE_THRESHOLD)
  }
  // supportSum is 0-1 (percentage of riff covered by chord tones)
  const supportScore = supportSum - MISSING_TONE_PENALTY * missingTones

  // Clash score: weight of notes that would clash with the chord
  // (semitone dissonances that aren't part of the chord)
  // FIX: Build a Set of clash PCs first to avoid double-counting
  // (e.g., in C7, pitch class A is a neighbor of both G and Bb)
  const chordPCSet = new Set(chordPCs)
  const clashPCs = new Set<number>()

  for (const pc of chordPCs) {
    const below = (pc - 1 + 12) % 12
    const above = (pc + 1) % 12
    // Only add if NOT a chord tone
    if (!chordPCSet.has(below)) clashPCs.add(below)
    if (!chordPCSet.has(above)) clashPCs.add(above)
  }

  // Sum weights only once per clash PC
  let clashSum = 0
  for (const pc of clashPCs) {
    clashSum += pcWeights[pc]
  }

  // Color bonus for non-diatonic chords (they're more interesting!)
  const colorBonus = source !== 'diatonic' ? COLOR_BONUS : 0

  // Color score: support minus clash penalty, plus color bonus
  // This rewards chords that cover the riff well AND don't clash
  const colorScore = Math.max(
    0,
    Math.min(1, supportScore - CLASH_PENALTY_FACTOR * clashSum + colorBonus)
  )

  return {
    supportScore: Math.max(0, Math.min(1, supportScore)),
    colorScore,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilities (exported for use by progressionService)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format chord symbol for display.
 * Ensures consistent naming:
 * - Major triads: just root (e.g., "C" not "CM")
 * - Minor triads: root + "m" (e.g., "Am")
 * - Diminished: root + "°" (e.g., "B°")
 * - Half-diminished: root + "ø7" (e.g., "Bø7")
 *
 * Can be called with (root, type) or with just (chordSymbol).
 */
export function formatChordSymbol(rootOrSymbol: string, type?: string): string {
  // If type is provided, use the simple root + type approach
  if (type !== undefined) {
    const root = rootOrSymbol
    if (type === 'M' || type === '' || type === 'major') return root
    if (type === 'm' || type === 'minor') return `${root}m`
    if (type === 'dim' || type === 'diminished') return `${root}°`
    if (type === 'dim7' || type === 'diminished seventh') return `${root}°7`
    if (type === 'm7b5' || type === 'half-diminished' || type === 'minor seventh flat five')
      return `${root}ø7`
    if (type === '7' || type === 'dominant seventh') return `${root}7`
    if (type === 'maj7' || type === 'major seventh') return `${root}maj7`
    if (type === 'm7' || type === 'minor seventh') return `${root}m7`
    if (type === 'aug' || type === 'augmented') return `${root}+`
    if (type === 'aug7' || type === '+7') return `${root}+7`
    // Note: Tonal calls aug+maj7 "augmented seventh"
    if (type === 'augmaj7' || type === '+maj7' || type === 'augmented seventh')
      return `${root}+maj7`
    // Minor/major seventh (minMaj7)
    if (type === 'mM7' || type === 'mMaj7' || type === 'minor/major seventh') return `${root}mM7`
    if (type === 'sus4' || type === 'suspended fourth') return `${root}sus4`
    if (type === 'sus2' || type === 'suspended second') return `${root}sus2`
    return `${root}${type}`
  }

  // If only symbol provided, parse it with Tonal
  const chordSymbol = rootOrSymbol
  const chord = Chord.get(chordSymbol)
  if (chord.empty || !chord.tonic) return chordSymbol

  const root = chord.tonic
  const chordType = chord.type

  // Map Tonal types to display format
  switch (chordType) {
    case 'major':
      return root
    case '':
      // Empty type - check if it's an augmented dominant 7th (Tonal doesn't set a type for this)
      if (chord.quality === 'Augmented' && chord.intervals?.includes('7m')) {
        return `${root}+7`
      }
      return root
    case 'minor':
      return `${root}m`
    case 'diminished':
      return `${root}°`
    case 'diminished seventh':
      return `${root}°7`
    case 'half-diminished':
    case 'minor seventh flat five':
      return `${root}ø7`
    case 'dominant seventh':
      return `${root}7`
    case 'major seventh':
      return `${root}maj7`
    case 'minor seventh':
      return `${root}m7`
    case 'augmented':
      return `${root}+`
    case 'augmented seventh':
      // Tonal calls aug+maj7 "augmented seventh"
      return `${root}+maj7`
    case 'minor/major seventh':
      // Minor chord with major 7th (minMaj7)
      return `${root}mM7`
    case 'suspended fourth':
      return `${root}sus4`
    case 'suspended second':
      return `${root}sus2`
    case 'major sixth':
      return `${root}6`
    case 'minor sixth':
      return `${root}m6`
    case 'dominant ninth':
      return `${root}9`
    case 'major ninth':
      return `${root}maj9`
    case 'minor ninth':
      return `${root}m9`
    default:
      // For other types, use Tonal's symbol if available
      if (chord.symbol && chord.symbol !== chordSymbol) {
        return chord.symbol
      }
      return chordType ? `${root}${chordType}` : root
  }
}
