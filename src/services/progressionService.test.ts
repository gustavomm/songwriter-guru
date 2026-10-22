import { describe, it, expect } from 'vitest'
import { Chord, Note, Scale } from 'tonal'
import {
  generateProgressions,
  computeFinalScore,
  scoreAppliedChordResolution,
  scoreNeapolitanResolution,
  scoreSubstituteResolution,
  isValidTransition,
  getResolutionTarget,
  scoreCadence,
  type ProgressionScoreComponents,
} from './progressionService'
import { generateChordSuggestions } from './chordSuggestion'
import { extractFeatures } from './featureExtraction'
import { analyzeHarmony } from './harmonyAnalysis'
import type {
  ChordSuggestion,
  HarmonicFieldCandidate,
  ProgressionSuggestion,
  RiffFeatures,
  PitchClassWeights,
  TranscribedNote,
} from '../domain/types'

describe('progressionService', () => {
  // Helper to create pitch class weights
  const createPcWeights = (weights: Partial<Record<number, number>>): PitchClassWeights => {
    const pcWeights: PitchClassWeights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (const [pc, weight] of Object.entries(weights)) {
      const index = parseInt(pc) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
      pcWeights[index] = weight ?? 0
    }
    return pcWeights
  }

  // Create test fixtures
  const cMajorField: HarmonicFieldCandidate = {
    id: 'C-major',
    tonic: 'C',
    mode: 'Major',
    scaleNotes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
    fitScore: 0.9,
    outOfScale: [],
  }

  const aMinorField: HarmonicFieldCandidate = {
    id: 'A-minor',
    tonic: 'A',
    mode: 'Minor',
    scaleNotes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
    fitScore: 0.9,
    outOfScale: [],
  }

  // Features that emphasize C major triad
  const cMajorFeatures: RiffFeatures = {
    pcWeights: createPcWeights({ 0: 0.35, 4: 0.35, 7: 0.3 }),
    topPitchClasses: [0, 4, 7],
    lastNotePc: 0,
    bassPc: 0,
  }

  // Features that emphasize A minor triad
  const aMinorFeatures: RiffFeatures = {
    pcWeights: createPcWeights({ 9: 0.35, 0: 0.35, 4: 0.3 }),
    topPitchClasses: [9, 0, 4],
    lastNotePc: 9,
    bassPc: 9,
  }

  describe('generateProgressions', () => {
    it('generates progressions for major key', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      expect(progressions.length).toBeGreaterThan(0)
    })

    it('generates progressions for minor key', () => {
      const chords = generateChordSuggestions(aMinorField, aMinorFeatures)
      const progressions = generateProgressions(aMinorField, chords, aMinorFeatures)

      expect(progressions.length).toBeGreaterThan(0)
    })

    it('returns progressions sorted by score descending', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      for (let i = 1; i < progressions.length; i++) {
        expect(progressions[i - 1].score).toBeGreaterThanOrEqual(progressions[i].score)
      }
    })

    it('returns progressions with valid structure', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      for (const prog of progressions) {
        // Should have matching arrays
        expect(prog.chords.length).toBe(prog.romans.length)
        expect(prog.chords.length).toBe(prog.slots.length)
        expect(prog.chords.length).toBeGreaterThanOrEqual(3)

        // Score should be between 0 and 1
        expect(prog.score).toBeGreaterThanOrEqual(0)
        expect(prog.score).toBeLessThanOrEqual(1)

        // Boolean flags should be set
        expect(typeof prog.containsColorChord).toBe('boolean')
        expect(typeof prog.containsSecondaryDominant).toBe('boolean')
        expect(typeof prog.containsBorrowedChord).toBe('boolean')
      }
    })

    it('includes diatonic progressions', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures, 0) // weirdness = 0

      // At low weirdness, should have some pure diatonic progressions
      const hasDiatonic = progressions.some(
        (prog) => !prog.containsSecondaryDominant && !prog.containsBorrowedChord
      )
      expect(hasDiatonic).toBe(true)
    })

    it('includes progressions with secondary dominants at higher weirdness', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures, 0.8)

      // At higher weirdness, should have some progressions with secondary dominants
      const hasSecondary = progressions.some((prog) => prog.containsSecondaryDominant)
      expect(hasSecondary).toBe(true)
    })

    it('slots contain alternatives', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      // At least some slots should have alternatives
      const hasAlternatives = progressions.some((prog) =>
        prog.slots.some((slot) => slot.alternatives.length > 0)
      )
      expect(hasAlternatives).toBe(true)
    })

    it('slots have valid chosen chord', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      for (const prog of progressions) {
        for (let i = 0; i < prog.slots.length; i++) {
          const slot = prog.slots[i]

          // Slot should have a role
          expect(slot.role).toBeTruthy()

          // Chosen chord should match the chord at this position
          expect(slot.chosen.symbol).toBe(prog.chords[i])

          // Chosen chord should have required fields
          expect(slot.chosen.id).toBeTruthy()
          expect(slot.chosen.chordTones).toBeDefined()
          expect(slot.chosen.source).toBeTruthy()
        }
      }
    })

    it('common progressions patterns are included', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      // Check that we have progressions starting with tonic (I or tonic-function chord)
      const startsWithTonic = progressions.some(
        (p) => p.romans[0] === 'I' || p.romans[0] === 'I7' || p.slots[0]?.chosen.function === 'T'
      )
      expect(startsWithTonic).toBe(true)

      // Check that we have progressions containing dominant function (V, V7, vii°, etc.)
      const containsDominant = progressions.some((p) =>
        p.slots.some((slot) => slot.chosen.function === 'D')
      )
      expect(containsDominant).toBe(true)

      // Check that we have progressions containing subdominant function (ii, IV, etc.)
      const containsSubdominant = progressions.some((p) =>
        p.slots.some((slot) => slot.chosen.function === 'SD')
      )
      expect(containsSubdominant).toBe(true)
    })

    it('respects weirdness parameter', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)

      const lowWeirdness = generateProgressions(cMajorField, chords, cMajorFeatures, 0)
      const highWeirdness = generateProgressions(cMajorField, chords, cMajorFeatures, 1)

      // At high weirdness, color chords should score better
      // So the top progressions should contain more color
      const lowColorCount = lowWeirdness.slice(0, 5).filter((p) => p.containsColorChord).length
      const highColorCount = highWeirdness.slice(0, 5).filter((p) => p.containsColorChord).length

      expect(highColorCount).toBeGreaterThanOrEqual(lowColorCount)
    })

    it('limits output to reasonable number of progressions', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      // Should return at most 15 progressions
      expect(progressions.length).toBeLessThanOrEqual(15)
    })

    it('correctly identifies borrowed chords', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures, 1)

      // Find progressions marked as containing borrowed chords
      const withBorrowed = progressions.filter((p) => p.containsBorrowedChord)

      // Borrowed progressions should contain a borrowed chord with a roman
      // numeral and a harmonic function (every borrowed chord gets one)
      expect(withBorrowed.length).toBeGreaterThan(0)
      for (const prog of withBorrowed) {
        const borrowedSlots = prog.slots.filter((slot) => slot.chosen.source === 'borrowed')
        expect(borrowedSlots.length).toBeGreaterThan(0)
        for (const slot of borrowedSlots) {
          expect(slot.chosen.roman).toBeTruthy()
          expect(slot.chosen.function).toBeDefined()
        }
      }
    })

    it('correctly identifies secondary dominants', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures, 0.8)

      // Find progressions marked as containing secondary dominants
      const withSecondary = progressions.filter((p) => p.containsSecondaryDominant)

      // If we have secondary dominant progressions, they should have V/x or subV patterns
      for (const prog of withSecondary) {
        const hasSecondaryRoman = prog.romans.some((r) => r.includes('/') || r.startsWith('subV'))
        expect(hasSecondaryRoman).toBe(true)
      }
    })

    it('generates unique progressions (no duplicates)', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)
      const progressions = generateProgressions(cMajorField, chords, cMajorFeatures)

      // Check for unique chord sequences
      const sequences = progressions.map((p) => p.chords.join('-'))
      const uniqueSequences = new Set(sequences)

      expect(uniqueSequences.size).toBe(sequences.length)
    })

    it('works without features parameter (backwards compatibility)', () => {
      const chords = generateChordSuggestions(cMajorField, cMajorFeatures)

      // Should not throw when features is undefined
      expect(() => {
        generateProgressions(cMajorField, chords)
      }).not.toThrow()

      const progressions = generateProgressions(cMajorField, chords)
      expect(progressions.length).toBeGreaterThan(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Unit Tests for Internal Scoring Functions
  // ─────────────────────────────────────────────────────────────────────────────

  describe('computeFinalScore', () => {
    const baseComponents: ProgressionScoreComponents = {
      fit: 0.8,
      spice: 0.5,
      motion: 0.6,
      cadence: 0.7,
      hasColorChord: false,
    }

    it('calculates weights correctly at weirdness=0', () => {
      // At weirdness=0: fit=0.40, spice=0.10, motion=0.30, cadence=0.20
      const score = computeFinalScore(baseComponents, 0)
      // Expected: 0.8*0.40 + 0.5*0.10 + 0.6*0.30 + 0.7*0.20 = 0.32 + 0.05 + 0.18 + 0.14 = 0.69
      // No color chord penalty at weirdness=0
      expect(score).toBeCloseTo(0.69, 1)
    })

    it('calculates weights correctly at weirdness=0.5', () => {
      // At weirdness=0.5: fit=0.24, spice=0.325, motion=0.225, cadence=0.20
      const score = computeFinalScore(baseComponents, 0.5)
      // Expected: 0.8*0.24 + 0.5*0.325 + 0.6*0.225 + 0.7*0.20 = 0.192 + 0.1625 + 0.135 + 0.14 = 0.6295
      // No color chord at 0.5 weirdness: penalty = 0.5 * -0.20 = -0.10
      expect(score).toBeCloseTo(0.53, 1)
    })

    it('calculates weights correctly at weirdness=1', () => {
      // At weirdness=1: fit=0.08, spice=0.55, motion=0.15, cadence=0.20
      const score = computeFinalScore(baseComponents, 1)
      // Expected: 0.8*0.08 + 0.5*0.55 + 0.6*0.15 + 0.7*0.20 = 0.064 + 0.275 + 0.09 + 0.14 = 0.569
      // No color chord at weirdness=1: penalty = -0.20
      expect(score).toBeCloseTo(0.369, 1)
    })

    it('applies color chord bonus at high weirdness', () => {
      const withColor = { ...baseComponents, hasColorChord: true }
      const withoutColor = { ...baseComponents, hasColorChord: false }

      const scoreWithColor = computeFinalScore(withColor, 1)
      const scoreWithoutColor = computeFinalScore(withoutColor, 1)

      // At weirdness=1: colorBonus = +0.25, noColorPenalty = -0.20
      // Difference should be significant
      expect(scoreWithColor).toBeGreaterThan(scoreWithoutColor)
      expect(scoreWithColor - scoreWithoutColor).toBeCloseTo(0.45, 1)
    })

    it('applies color chord penalty at low weirdness', () => {
      const withColor = { ...baseComponents, hasColorChord: true }
      const withoutColor = { ...baseComponents, hasColorChord: false }

      const scoreWithColor = computeFinalScore(withColor, 0)
      const scoreWithoutColor = computeFinalScore(withoutColor, 0)

      // At weirdness=0: colorBonus = -0.15, noColorPenalty = 0
      expect(scoreWithColor).toBeLessThan(scoreWithoutColor)
    })

    it('clamps score to 0-1 range', () => {
      const highComponents: ProgressionScoreComponents = {
        fit: 1.0,
        spice: 1.0,
        motion: 1.0,
        cadence: 1.0,
        hasColorChord: true,
      }
      const lowComponents: ProgressionScoreComponents = {
        fit: 0,
        spice: 0,
        motion: 0,
        cadence: 0,
        hasColorChord: false,
      }

      expect(computeFinalScore(highComponents, 1)).toBeLessThanOrEqual(1)
      expect(computeFinalScore(lowComponents, 0)).toBeGreaterThanOrEqual(0)
    })
  })

  describe('scoreAppliedChordResolution', () => {
    it('gives bonus for correct resolution (V/vi → vi)', () => {
      const score = scoreAppliedChordResolution('V/vi', 'vi')
      expect(score).toBe(0.25)
    })

    it('gives bonus for correct resolution (V7/V → V)', () => {
      const score = scoreAppliedChordResolution('V7/V', 'V')
      expect(score).toBe(0.25)
    })

    it('gives penalty for wrong resolution (V/vi → IV)', () => {
      const score = scoreAppliedChordResolution('V/vi', 'IV')
      expect(score).toBe(-0.3)
    })

    it('gives penalty for no resolution (null next)', () => {
      const score = scoreAppliedChordResolution('V/vi', null)
      expect(score).toBe(-0.3)
    })

    it('returns 0 for non-applied chords', () => {
      const score = scoreAppliedChordResolution('V', 'I')
      expect(score).toBe(0)
    })

    it('handles vii°/x resolutions', () => {
      const correct = scoreAppliedChordResolution('vii°/V', 'V')
      const wrong = scoreAppliedChordResolution('vii°/V', 'I')

      expect(correct).toBe(0.25)
      expect(wrong).toBe(-0.3)
    })
  })

  describe('scoreNeapolitanResolution', () => {
    it('gives bonus for correct resolution (bII → V)', () => {
      const score = scoreNeapolitanResolution('bII', 'V')
      expect(score).toBe(0.15)
    })

    it('gives bonus for resolution to V7', () => {
      const score = scoreNeapolitanResolution('bII', 'V7')
      expect(score).toBe(0.15)
    })

    it('gives penalty for wrong resolution (bII → I)', () => {
      const score = scoreNeapolitanResolution('bII', 'I')
      expect(score).toBe(-0.15)
    })

    it('gives penalty for no resolution', () => {
      const score = scoreNeapolitanResolution('bII', null)
      expect(score).toBe(-0.15)
    })

    it('returns 0 for non-Neapolitan chords', () => {
      const score = scoreNeapolitanResolution('IV', 'V')
      expect(score).toBe(0)
    })
  })

  describe('scoreSubstituteResolution', () => {
    it('gives bonus for subV → I resolution', () => {
      const score = scoreSubstituteResolution('subV', 'I')
      expect(score).toBe(0.2)
    })

    it('gives bonus for subV7 → I resolution', () => {
      const score = scoreSubstituteResolution('subV7', 'I')
      expect(score).toBe(0.2)
    })

    it('gives bonus for subV/ii → ii resolution', () => {
      const score = scoreSubstituteResolution('subV/ii', 'ii')
      expect(score).toBe(0.2)
    })

    it('gives penalty for wrong resolution (subV → IV)', () => {
      const score = scoreSubstituteResolution('subV', 'IV')
      expect(score).toBe(-0.15)
    })

    it('gives penalty for no resolution', () => {
      const score = scoreSubstituteResolution('subV', null)
      expect(score).toBe(-0.15)
    })

    it('returns 0 for non-substitute chords', () => {
      const score = scoreSubstituteResolution('V', 'I')
      expect(score).toBe(0)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Transition Rules (applied chord resolution, repeated roots)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('isValidTransition', () => {
    const chord = (symbol: string, roman: string, extra: Partial<ChordSuggestion> = {}) =>
      ({
        id: symbol,
        symbol,
        roman,
        source: 'diatonic',
        chordTones: Chord.get(symbol).notes,
        supportScore: 0.5,
        colorScore: 0.2,
        ...extra,
      }) as ChordSuggestion

    const secondary = (symbol: string, target: string) =>
      chord(symbol, `V/${target}`, { source: 'secondary_dominant', resolvesToRoman: target })
    const tritoneSub = (symbol: string, target: string) =>
      chord(symbol, `subV/${target}`, { source: 'substitute_dominant', resolvesToRoman: target })

    it('allows a secondary dominant followed by its target (any 7th/quality suffix)', () => {
      expect(isValidTransition(secondary('D7', 'V'), chord('G', 'V'))).toBe(true)
      expect(isValidTransition(secondary('D7', 'V'), chord('G7', 'V7'))).toBe(true)
      expect(isValidTransition(secondary('A7', 'ii'), chord('Dm7', 'ii7'))).toBe(true)
    })

    it('rejects a secondary dominant that does not resolve to its target', () => {
      expect(isValidTransition(secondary('D7', 'V'), chord('Cmaj7', 'Imaj7'))).toBe(false)
      expect(isValidTransition(secondary('C7', 'IV'), chord('C', 'I'))).toBe(false)
    })

    it('rejects an applied chord as the final chord', () => {
      expect(isValidTransition(secondary('E7', 'vi'), null)).toBe(false)
      expect(isValidTransition(tritoneSub('Ab7', 'V'), null)).toBe(false)
    })

    it('requires tritone subs to resolve down a half step to their target', () => {
      expect(isValidTransition(tritoneSub('F7', 'iii'), chord('Em7', 'iii7'))).toBe(true)
      expect(isValidTransition(tritoneSub('F7', 'iii'), chord('Cmaj7', 'Imaj7'))).toBe(false)
      expect(isValidTransition(tritoneSub('C7', 'V'), chord('Em6', 'i6'))).toBe(false)
    })

    it('rejects a degree match whose root is wrong (VI vs vi° in minor)', () => {
      // V/VI in A minor is C7 → F; F#° (melodic vi°) only matches the roman case-insensitively
      expect(isValidTransition(secondary('C7', 'VI'), chord('F', 'VI'))).toBe(true)
      expect(isValidTransition(secondary('C7', 'VI'), chord('F#dim', 'vi°'))).toBe(false)
    })

    it('requires the Neapolitan to move to V', () => {
      expect(isValidTransition(chord('Db', 'bII'), chord('G7', 'V7'))).toBe(true)
      expect(isValidTransition(chord('Db', 'bII'), chord('C', 'I'))).toBe(false)
    })

    it('rejects adjacent chords on the same root', () => {
      expect(isValidTransition(chord('Cmaj7', 'Imaj7'), chord('C', 'I'))).toBe(false)
      expect(isValidTransition(chord('Em7', 'iii7'), chord('Em', 'iii'))).toBe(false)
      expect(isValidTransition(chord('C', 'I'), chord('F', 'IV'))).toBe(true)
    })

    it('reports resolution targets only for chords that must resolve', () => {
      expect(getResolutionTarget(secondary('D7', 'V'))).toBe('V')
      expect(getResolutionTarget(chord('Db', 'bII'))).toBe('V')
      expect(getResolutionTarget(chord('G7', 'V7'))).toBeNull()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // Golden Musical Tests (full pipeline: notes → features → key → chords)
  // ─────────────────────────────────────────────────────────────────────────────

  describe('quality-aware resolution (minor keys)', () => {
    const chord = (symbol: string, roman: string, extra: Partial<ChordSuggestion> = {}) =>
      ({
        id: symbol,
        symbol,
        roman,
        source: 'diatonic',
        chordTones: Chord.get(symbol).notes,
        supportScore: 0.5,
        colorScore: 0.2,
        ...extra,
      }) as ChordSuggestion
    const vOfV = chord('B7', 'V/V', { source: 'secondary_dominant', resolvesToRoman: 'V' })

    it('requires V/V to resolve to the major V, not the minor v', () => {
      expect(isValidTransition(vOfV, chord('E7', 'V7'))).toBe(true)
      expect(isValidTransition(vOfV, chord('E', 'V'))).toBe(true)
      expect(isValidTransition(vOfV, chord('Em', 'v'))).toBe(false)
      expect(isValidTransition(vOfV, chord('Em7', 'v7'))).toBe(false)
    })

    it('scores V/V → v as a wrong resolution', () => {
      expect(scoreAppliedChordResolution('V/V', 'V7')).toBeGreaterThan(0)
      expect(scoreAppliedChordResolution('V/V', 'v')).toBeLessThan(0)
    })

    it('expects the Neapolitan to resolve to the major V', () => {
      expect(scoreNeapolitanResolution('bII', 'V7')).toBeGreaterThan(0)
      expect(scoreNeapolitanResolution('bII', 'v')).toBeLessThan(0)
    })
  })

  describe('scoreCadence', () => {
    const chord = (
      symbol: string,
      roman: string,
      fn: ChordSuggestion['function'],
      extra: Partial<ChordSuggestion> = {}
    ) =>
      ({
        id: Chord.get(symbol).symbol || symbol,
        symbol,
        roman,
        function: fn,
        source: 'diatonic',
        chordTones: Chord.get(symbol).notes,
        supportScore: 0.5,
        colorScore: 0.2,
        ...extra,
      }) as ChordSuggestion
    const C = chord('C', 'I', 'T')
    const F = chord('F', 'IV', 'SD')
    const G7 = chord('G7', 'V7', 'D')
    const Bdim = chord('Bdim', 'vii°', 'D')
    const Em7 = chord('Em7', 'iii7', 'T')
    const Am = chord('Am', 'vi', 'T')
    const subVofIII = chord('F7', 'subV/iii', 'D', {
      source: 'substitute_dominant',
      resolvesToRoman: 'iii',
    })
    const Bb = chord('Bb', 'bVII', 'D', { source: 'borrowed' })

    it('scores V → I and vii° → I as authentic', () => {
      expect(scoreCadence('authentic', [F, G7, C], 'C')).toBeCloseTo(0.9)
      expect(scoreCadence('authentic', [F, Bdim, C], 'C')).toBeCloseTo(0.9)
    })

    it('requires an authentic cadence to end on the tonic chord', () => {
      // subV/iii → iii is a D → T move, but it doesn't cadence on the tonic
      const subVToIii = scoreCadence('authentic', [C, subVofIII, Em7], 'C')
      expect(subVToIii).toBeLessThan(scoreCadence('authentic', [F, G7, C], 'C'))
      expect(subVToIii).toBeLessThanOrEqual(0.3)
      // V → vi is deceptive, not authentic
      expect(scoreCadence('authentic', [F, G7, Am], 'C')).toBeLessThanOrEqual(0.3)
    })

    it('treats subtonic → tonic as a softer cadence', () => {
      const soft = scoreCadence('authentic', [F, Bb, C], 'C')
      expect(soft).toBeLessThan(0.9)
      expect(soft).toBeGreaterThan(scoreCadence('authentic', [G7, F, C], 'C'))

      // In A minor, VII → i (G → Am) is the natural-minor cadence
      const am = chord('Am', 'i', 'T')
      const g = chord('G', 'VII', 'D')
      const f = chord('F', 'VI', 'SD')
      expect(scoreCadence('authentic', [f, g, am], 'A')).toBeCloseTo(soft)
    })

    it('scores a deceptive cadence only when it avoids the tonic', () => {
      expect(scoreCadence('deceptive', [F, G7, Am], 'C')).toBeCloseTo(0.75)
      expect(scoreCadence('deceptive', [F, G7, C], 'C')).toBeLessThan(0.75)
    })
  })

  describe('key-specific progression behaviour', () => {
    const buildRiff = (midis: number[]): TranscribedNote[] =>
      midis.map((midi, i) => ({ startSec: i * 0.5, endSec: i * 0.5 + 0.45, midi, velocity: 0.8 }))
    const fieldFor = (tonic: string, mode: string): HarmonicFieldCandidate => ({
      id: `${tonic}-${mode.toLowerCase()}`,
      tonic,
      mode,
      scaleNotes: Scale.get(`${tonic} ${mode.toLowerCase()}`).notes,
      fitScore: 1,
      outOfScale: [],
    })
    const rootOf = (chord: ChordSuggestion) => Note.chroma(Chord.get(chord.id).tonic ?? '')
    const aMinor = fieldFor('A', 'Minor')
    // A C E G F G A E D C A: an A minor riff that leans on the subtonic G
    const aMinorFeatures = extractFeatures(buildRiff([57, 60, 64, 67, 65, 67, 69, 64, 62, 60, 57]))

    it('includes VII → i (e.g. VI–VII–i) for an A minor riff at low weirdness', () => {
      const chords = generateChordSuggestions(aMinor, aMinorFeatures)
      const progressions = generateProgressions(aMinor, chords, aMinorFeatures, 0)
      const tonic = Note.chroma('A')
      const subtonic = Note.chroma('G')

      const hasSubtonicCadence = progressions.some((p) =>
        p.slots.some(
          (slot, i) =>
            i < p.slots.length - 1 &&
            rootOf(slot.chosen) === subtonic &&
            rootOf(p.slots[i + 1].chosen) === tonic
        )
      )
      expect(hasSubtonicCadence, progressions.map((p) => p.chords.join(' ')).join(' | ')).toBe(true)
    })

    it('rests on plain i / i7 (not i(maj7), i6 or III+) at low weirdness', () => {
      // A harmonic minor riff with G#, which makes AmMaj7 a good fit on paper
      const features = extractFeatures(buildRiff([57, 60, 64, 62, 60, 59, 56, 57, 64, 65, 64, 57]))
      const chords = generateChordSuggestions(aMinor, features)
      for (const weirdness of [0, 0.25]) {
        const progressions = generateProgressions(aMinor, chords, features, weirdness)
        for (const p of progressions) {
          for (const slot of p.slots) {
            if (slot.chosen.function === 'T') {
              expect(slot.chosen.colorVariant, p.chords.join(' ')).toBeFalsy()
            }
          }
        }
        // The top suggestion uses no colour variant at all
        expect(progressions[0].slots.some((slot) => slot.chosen.colorVariant)).toBe(false)
      }
    })

    it('drops near-duplicate progressions with the same chord roots', () => {
      for (const [field, features] of [
        [aMinor, aMinorFeatures],
        [
          fieldFor('C', 'Major'),
          extractFeatures(buildRiff([60, 64, 67, 65, 62, 67, 71, 72, 69, 67, 64, 60])),
        ],
      ] as const) {
        const chords = generateChordSuggestions(field, features)
        for (const weirdness of [0, 0.5, 1]) {
          const progressions = generateProgressions(field, chords, features, weirdness)
          const rootSequences = progressions.map((p) =>
            p.slots.map((s) => rootOf(s.chosen)).join('-')
          )
          expect(new Set(rootSequences).size).toBe(rootSequences.length)
        }
      }
    })
  })

  describe('golden progressions from real riffs', () => {
    const buildRiff = (midis: number[]): TranscribedNote[] =>
      midis.map((midi, i) => ({
        startSec: i * 0.5,
        endSec: i * 0.5 + 0.45,
        midi,
        velocity: 0.8,
      }))

    const RIFFS = [
      {
        name: 'C major scale riff',
        midis: [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60],
        tonic: 'C',
        mode: 'Major',
      },
      {
        name: 'A minor scale riff',
        midis: [57, 59, 60, 62, 64, 65, 67, 69, 64, 60, 57],
        tonic: 'A',
        mode: 'Minor',
      },
      {
        name: 'E minor scale riff',
        midis: [64, 66, 67, 69, 71, 72, 74, 76, 71, 67, 64],
        tonic: 'E',
        mode: 'Minor',
      },
    ]
    const WEIRDNESS_LEVELS = [0, 0.5, 1]

    const rootChroma = (chord: ChordSuggestion): number => {
      const root = Chord.get(chord.id).tonic ?? chord.chordTones[0]
      return Note.chroma(root) as number
    }

    // Scale degree of a roman numeral, ignoring 7th/quality suffixes and case
    const degree = (roman: string | undefined): string =>
      (roman?.match(/^[b#]*[iv]+/i)?.[0] ?? '').toLowerCase()

    const isApplied = (chord: ChordSuggestion): boolean =>
      chord.source === 'secondary_dominant' ||
      chord.source === 'substitute_dominant' ||
      !!chord.resolvesToRoman ||
      !!chord.roman?.includes('/')

    const describeProgression = (p: ProgressionSuggestion) =>
      p.slots.map((s) => `${s.chosen.symbol}(${s.chosen.roman})`).join(' ')

    // Checks a chord → next chord transition against the musical rules
    const transitionProblem = (
      chord: ChordSuggestion,
      next: ChordSuggestion | null
    ): string | null => {
      if (isApplied(chord)) {
        if (!next) return `${chord.symbol} (${chord.roman}) ends the progression unresolved`
        const target = chord.resolvesToRoman ?? chord.roman?.split('/')[1]
        if (degree(next.roman) !== degree(target)) {
          return `${chord.symbol} (${chord.roman}) is followed by ${next.symbol} (${next.roman})`
        }
        // V/x falls a fifth, subV/x falls a half step
        const expected = chord.roman?.startsWith('subV') ? 11 : 5
        if ((rootChroma(next) - rootChroma(chord) + 12) % 12 !== expected) {
          return `${chord.symbol} does not resolve by root motion to ${next.symbol}`
        }
      }
      if (degree(chord.roman) === 'bii' && chord.roman?.startsWith('bII')) {
        if (degree(next?.roman) !== 'v') return `Neapolitan ${chord.symbol} not followed by V`
      }
      if (next && rootChroma(chord) === rootChroma(next)) {
        return `${chord.symbol} → ${next.symbol} repeats the same root`
      }
      return null
    }

    const progressionProblems = (p: ProgressionSuggestion): string[] => {
      const problems: string[] = []
      const chosen = p.slots.map((s) => s.chosen)
      chosen.forEach((chord, i) => {
        const prev = i > 0 ? chosen[i - 1] : null
        const next = i < chosen.length - 1 ? chosen[i + 1] : null

        const problem = transitionProblem(chord, next)
        if (problem) problems.push(problem)

        // Alternatives must be drop-in replacements for the slot
        for (const alt of p.slots[i].alternatives) {
          const altProblem = transitionProblem(alt, next) ?? (prev && transitionProblem(prev, alt))
          if (altProblem) problems.push(`alternative ${alt.symbol} in slot ${i}: ${altProblem}`)
        }
      })
      return problems.map((msg) => `${describeProgression(p)}: ${msg}`)
    }

    for (const riff of RIFFS) {
      describe(riff.name, () => {
        const features = extractFeatures(buildRiff(riff.midis))
        const harmony = analyzeHarmony(features)
        // Pick the candidate by tonic/mode, not by rank (key ranking may change)
        const field: HarmonicFieldCandidate = harmony.candidates.find(
          (c) =>
            Note.chroma(c.tonic) === Note.chroma(riff.tonic) &&
            c.mode.toLowerCase() === riff.mode.toLowerCase()
        ) ?? {
          id: `${riff.tonic}-${riff.mode.toLowerCase()}`,
          tonic: riff.tonic,
          mode: riff.mode,
          scaleNotes: Scale.get(`${riff.tonic} ${riff.mode.toLowerCase()}`).notes,
          fitScore: 1,
          outOfScale: [],
        }
        const chords = generateChordSuggestions(field, features)

        for (const weirdness of WEIRDNESS_LEVELS) {
          it(`obeys voice-leading rules at weirdness ${weirdness}`, () => {
            const progressions = generateProgressions(field, chords, features, weirdness)
            expect(progressions.length).toBeGreaterThan(0)
            expect(progressions.flatMap(progressionProblems)).toEqual([])
          })
        }

        it('still offers color chords at weirdness 1', () => {
          const progressions = generateProgressions(field, chords, features, 1)
          expect(progressions.some((p) => p.containsColorChord)).toBe(true)
        })
      })
    }
  })
})

describe('weirdness knob on template progressions', () => {
  const buildRiff = (midis: number[]): TranscribedNote[] =>
    midis.map((midi, i) => ({ startSec: i * 0.5, endSec: i * 0.5 + 0.45, midi, velocity: 0.8 }))
  const fieldFor = (tonic: string, mode: string): HarmonicFieldCandidate => ({
    id: `${tonic}-${mode.toLowerCase()}`,
    tonic,
    mode,
    scaleNotes: Scale.get(`${tonic} ${mode.toLowerCase()}`).notes,
    fitScore: 1,
    outOfScale: [],
  })
  const RIFFS: [HarmonicFieldCandidate, number[]][] = [
    // Harmonic minor riff leaning on G#: i(maj7) fits it well on paper
    [fieldFor('A', 'Minor'), [57, 60, 64, 62, 60, 59, 56, 57, 64, 65, 64, 57]],
    [fieldFor('E', 'Minor'), [64, 66, 67, 69, 71, 72, 74, 76, 71, 67, 64]],
    [fieldFor('C', 'Major'), [60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]],
  ]
  const STEPS = [0, 0.25, 0.5, 0.75, 1]
  const isColorTonic = (c: ChordSuggestion, tonic: string) =>
    !!c.colorVariant && Note.chroma(Chord.get(c.id).tonic ?? '') === Note.chroma(tonic)

  it('uses a colour-variant tonic at most once per progression, never last, in few progressions', () => {
    for (const [field, midis] of RIFFS) {
      const features = extractFeatures(buildRiff(midis))
      const chords = generateChordSuggestions(field, features)
      for (const w of STEPS) {
        const progressions = generateProgressions(field, chords, features, w)
        let withColorTonic = 0
        for (const p of progressions) {
          const chosen = p.slots.map((s) => s.chosen)
          const count = chosen.filter((c) => isColorTonic(c, field.tonic)).length
          expect(count, p.chords.join(' ')).toBeLessThanOrEqual(1)
          expect(isColorTonic(chosen[chosen.length - 1], field.tonic), p.chords.join(' ')).toBe(
            false
          )
          if (count > 0) withColorTonic++
        }
        expect(withColorTonic, `${field.id} w=${w}`).toBeLessThanOrEqual(3)
      }
    }
  })

  it('adds colour smoothly: none at 0, non-decreasing on average up to 1', () => {
    for (const [field, midis] of RIFFS) {
      const features = extractFeatures(buildRiff(midis))
      const chords = generateChordSuggestions(field, features)
      const means = STEPS.map((w) => {
        const progressions = generateProgressions(field, chords, features, w)
        const colour = progressions.map(
          (p) => p.slots.filter((s) => (s.chosen.colorDistance ?? 0) > 0).length
        )
        return colour.reduce((a, b) => a + b, 0) / progressions.length
      })
      expect(means[0]).toBe(0)
      for (let i = 1; i < means.length; i++) {
        expect(means[i], `${field.id}: ${means.join(', ')}`).toBeGreaterThanOrEqual(means[i - 1])
      }
      expect(means[means.length - 1]).toBeGreaterThan(0)
    }
  })

  it('keeps every chord within the weirdness reach', () => {
    const [field, midis] = RIFFS[2]
    const features = extractFeatures(buildRiff(midis))
    const chords = generateChordSuggestions(field, features)
    // At 0.5 the reach stops short of tritone subs and the Neapolitan
    for (const p of generateProgressions(field, chords, features, 0.5)) {
      for (const slot of p.slots) {
        expect(slot.chosen.colorDistance ?? 0, p.chords.join(' ')).toBeLessThanOrEqual(0.625)
      }
    }
  })
})
