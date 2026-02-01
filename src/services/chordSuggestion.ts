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
    'Major': 'major',
    'Minor': 'minor',
}

// Parallel modes for borrowing (same tonic, different modes)
const PARALLEL_MODES_FOR_BORROWING = ['major', 'minor', 'dorian', 'mixolydian']

// Scoring parameters
const CLASH_PENALTY_FACTOR = 0.3
const COLOR_BONUS = 0.1

// Roman numerals for Key module (indexes match array positions)
const MAJOR_ROMAN_FROM_KEY = ['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°']
// Natural minor: no raised degrees
const MINOR_NATURAL_ROMAN = ['i', 'ii°', 'III', 'iv', 'v', 'VI', 'VII']
// Harmonic minor: raised 7th gives V and vii° (strong dominant function)
const MINOR_HARMONIC_ROMAN = ['i', 'ii°', 'III+', 'iv', 'V', 'VI', 'vii°']
// Melodic minor: raised 6th and 7th (jazz/modern color)
const MINOR_MELODIC_ROMAN = ['i', 'ii', 'III+', 'IV', 'V', 'vi°', 'vii°']

// Harmonic function assignments for borrowed chords by roman numeral pattern
const BORROWED_FUNCTIONS: Record<string, HarmonicFunction> = {
    'bII': 'SD',   // Neapolitan - predominant function
    'bii': 'SD',
    'bIII': 'T',   // Borrowed mediant - tonic substitute
    'biii': 'T',
    'iv': 'SD',    // Minor iv in major - predominant
    'IV': 'SD',
    'bVI': 'SD',   // Borrowed submediant - predominant
    'bvi': 'SD',
    'bVII': 'D',   // Borrowed subtonic - dominant function
    'bvii': 'D',
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

// ─────────────────────────────────────────────────────────────────────────────
// Key Module Helpers (for major/minor modes)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build diatonic chord suggestions from Key module triads and 7ths arrays.
 */
function buildDiatonicFromKey(
    triads: readonly string[],
    sevenths: readonly string[],
    harmonicFunctions: readonly string[],
    romanNumerals: readonly string[],
    pcWeights: PitchClassWeights
): ChordSuggestion[] {
    const chords: ChordSuggestion[] = []

    // Add triads
    for (let i = 0; i < triads.length; i++) {
        const rawSymbol = triads[i]
        if (!rawSymbol) continue

        const chord = Chord.get(rawSymbol)
        if (!chord.notes.length) continue

        const scores = calculateScores(chord.notes, pcWeights, 'diatonic')
        const hf = harmonicFunctions[i] as HarmonicFunction | undefined // T, SD, or D

        chords.push({
            id: getCanonicalSymbol(rawSymbol),
            symbol: formatChordSymbol(rawSymbol),
            roman: romanNumerals[i],
            function: hf,
            degree: i,
            source: 'diatonic',
            sourceDetail: hf ? `Harmonic function: ${hf === 'T' ? 'Tonic' : hf === 'SD' ? 'Subdominant' : 'Dominant'}` : undefined,
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
        const hf = harmonicFunctions[i] as HarmonicFunction | undefined

        chords.push({
            id: getCanonicalSymbol(rawSymbol),
            symbol: formatChordSymbol(rawSymbol),
            roman: `${romanNumerals[i]}7`,
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
        const rawSymbol = secondaryDominants[i]
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
        const rawSymbol = substituteDominants[i]
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
            substitutes: buildSubstitutesFromKey(key.substituteDominants, MAJOR_ROMAN_FROM_KEY, pcWeights),
        }
    }

    if (modeName === 'minor') {
        const key = Key.minorKey(tonic)

        // Build diatonic chords from all three minor variants:
        // - Natural minor: provides bVII, bVI, bIII (mixture flavor)
        // - Harmonic minor: provides strong V7 and vii° (raised 7th)
        // - Melodic minor: provides modern/jazz color (raised 6th and 7th)
        const naturalDiatonic = buildDiatonicFromKey(
            key.natural.triads,
            key.natural.chords,
            key.natural.chordsHarmonicFunction,
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

        // Union all diatonic chords, using mergeChordDuplicates to handle overlaps
        const allDiatonic = mergeChordDuplicates([
            ...naturalDiatonic,
            ...harmonicDiatonic,
            ...melodicDiatonic,
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
                existing.sources.forEach(s => allSources.add(s))
            }
            allSources.add(chord.source)
            if (chord.sources) {
                chord.sources.forEach(s => allSources.add(s))
            }

            // Merge source details
            const allDetails: string[] = []
            if (existing.sourceDetail) allDetails.push(existing.sourceDetail)
            if (existing.sourceDetails) allDetails.push(...existing.sourceDetails)
            if (chord.sourceDetail && !allDetails.includes(chord.sourceDetail)) {
                allDetails.push(chord.sourceDetail)
            }
            if (chord.sourceDetails) {
                chord.sourceDetails.forEach(d => {
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
    const borrowedChords = generateBorrowedChords(tonic, tonalModeName, pcWeights)

    // Sort each category by supportScore (best-fitting chords first)
    const sortBySupport = (a: ChordSuggestion, b: ChordSuggestion) => b.supportScore - a.supportScore
    const sortedDiatonic = [...diatonicChords].sort(sortBySupport)
    const sortedSecondary = [...secondaryChords].sort(sortBySupport)
    const sortedBorrowed = [...borrowedChords].sort(sortBySupport)

    // Create ranked list with merged duplicates
    const allChords = [...diatonicChords, ...secondaryChords, ...borrowedChords]
    const mergedChords = mergeChordDuplicates(allChords)
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
    pcWeights: PitchClassWeights
): ChordSuggestion[] {
    // Get base mode's chord symbols (to avoid duplicates)
    const baseScaleName = `${tonic} ${baseModeName}`
    const baseScale = Scale.get(baseScaleName)
    const baseChordSymbols = new Set<string>()

    for (let degree = 0; degree < baseScale.notes.length; degree++) {
        const root = baseScale.notes[degree]
        const triadType = getChordTypeForDegree(baseModeName, degree)
        const seventhType = getSeventhChordTypeForDegree(baseModeName, degree)
        baseChordSymbols.add(`${root}${triadType}`)
        baseChordSymbols.add(`${root}${seventhType}`)
    }

    const borrowedChords: ChordSuggestion[] = []

    // Borrow from parallel modes
    for (const sourceModeName of PARALLEL_MODES_FOR_BORROWING) {
        if (sourceModeName === baseModeName) continue

        const sourceScaleName = `${tonic} ${sourceModeName}`
        const sourceScale = Scale.get(sourceScaleName)

        if (!sourceScale.notes.length) continue

        const sourceDisplayName = getDisplayModeName(sourceModeName)

        for (let degree = 0; degree < sourceScale.notes.length; degree++) {
            const root = sourceScale.notes[degree]
            const triadType = getChordTypeForDegree(sourceModeName, degree)
            const seventhType = getSeventhChordTypeForDegree(sourceModeName, degree)

            // Check if triad is different from base mode
            const triadSymbol = `${root}${triadType}`
            if (!baseChordSymbols.has(triadSymbol)) {
                const chord = Chord.get(triadSymbol)
                if (chord.notes.length) {
                    const scores = calculateScores(chord.notes, pcWeights, 'borrowed')
                    const roman = getBorrowedRomanNumeral(root, triadType, tonic)
                    const harmonicFn = BORROWED_FUNCTIONS[roman] || BORROWED_FUNCTIONS[roman.toLowerCase()]

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

            // Check if 7th chord is different from base mode
            const seventhSymbolKey = `${root}${seventhType}`
            if (!baseChordSymbols.has(seventhSymbolKey)) {
                const seventhChord = Chord.get(seventhSymbolKey)
                if (seventhChord.notes.length) {
                    const scores = calculateScores(seventhChord.notes, pcWeights, 'borrowed')
                    const baseRoman = getBorrowedRomanNumeral(root, seventhType, tonic)
                    const roman = `${baseRoman}7`
                    const harmonicFn = BORROWED_FUNCTIONS[baseRoman] || BORROWED_FUNCTIONS[baseRoman.toLowerCase()]

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
 * Get a simple roman numeral for a borrowed chord.
 */
function getBorrowedRomanNumeral(root: string, chordType: string, tonic: string): string {
    // Simple mapping based on pitch class distance from tonic
    const rootPc = Note.chroma(root) ?? 0
    const tonicPc = Note.chroma(tonic) ?? 0
    const degreeFromTonic = ((rootPc - tonicPc + 12) % 12)

    // Map semitones to scale degree approximation
    const degreeMap: Record<number, string> = {
        0: 'I',
        1: 'bII',
        2: 'II',
        3: 'bIII',
        4: 'III',
        5: 'IV',
        6: 'bV',
        7: 'V',
        8: 'bVI',
        9: 'VI',
        10: 'bVII',
        11: 'VII',
    }

    let numeral = degreeMap[degreeFromTonic] || 'I'

    // Adjust case based on chord quality
    if (['m', 'm7', 'dim', 'm7b5'].includes(chordType)) {
        numeral = numeral.toLowerCase()
    }
    if (chordType === 'dim' || chordType === 'm7b5') {
        numeral = numeral + '°'
    }

    return numeral
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
    for (const pc of chordPCs) {
        supportSum += pcWeights[pc]
    }
    // supportSum is already 0-1 (percentage of riff covered by chord tones)
    const supportScore = supportSum

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
    const colorScore = Math.max(0, Math.min(1, supportScore - CLASH_PENALTY_FACTOR * clashSum + colorBonus))

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
        if (type === 'm7b5' || type === 'half-diminished' || type === 'minor seventh flat five') return `${root}ø7`
        if (type === '7' || type === 'dominant seventh') return `${root}7`
        if (type === 'maj7' || type === 'major seventh') return `${root}maj7`
        if (type === 'm7' || type === 'minor seventh') return `${root}m7`
        if (type === 'aug' || type === 'augmented') return `${root}+`
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
        case '':
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
