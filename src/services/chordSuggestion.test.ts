import { describe, it, expect } from 'vitest'
import { calculateScores, formatChordSymbol, generateChordSuggestions } from './chordSuggestion'
import type { PitchClassWeights, HarmonicFieldCandidate, RiffFeatures } from '../domain/types'

describe('chordSuggestion', () => {
  describe('calculateScores', () => {
    // Create a helper for pitch class weights (C=0, C#=1, ..., B=11)
    const createPcWeights = (weights: Partial<Record<number, number>>): PitchClassWeights => {
      const pcWeights: PitchClassWeights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      for (const [pc, weight] of Object.entries(weights)) {
        const index = parseInt(pc) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
        pcWeights[index] = weight ?? 0
      }
      return pcWeights
    }

    it('returns zero scores for empty chord tones', () => {
      const pcWeights = createPcWeights({ 0: 0.5, 4: 0.5 }) // C and E
      const scores = calculateScores([], pcWeights, 'diatonic')
      expect(scores.supportScore).toBe(0)
      expect(scores.colorScore).toBe(0)
    })

    it('calculates high support score when chord tones match riff notes', () => {
      // Riff strongly emphasizes C (0), E (4), G (7) - C major triad notes
      const pcWeights = createPcWeights({ 0: 0.4, 4: 0.35, 7: 0.25 })
      const cMajorTones = ['C', 'E', 'G']

      const scores = calculateScores(cMajorTones, pcWeights, 'diatonic')

      // Support score should be sum of weights for chord tones = 0.4 + 0.35 + 0.25 = 1.0
      expect(scores.supportScore).toBeCloseTo(1.0, 2)
    })

    it('calculates lower support score when chord tones partially match', () => {
      // Riff has C, E, but also D and F which are not in C major triad
      const pcWeights = createPcWeights({ 0: 0.3, 2: 0.2, 4: 0.3, 5: 0.2 })
      const cMajorTones = ['C', 'E', 'G']

      const scores = calculateScores(cMajorTones, pcWeights, 'diatonic')

      // Support = 0.3 (C) + 0.3 (E) + 0 (G not in riff) = 0.6
      expect(scores.supportScore).toBeCloseTo(0.6, 2)
    })

    it('applies clash penalty for semitone clashes', () => {
      // Riff has C and C# (semitone clash)
      const pcWeights = createPcWeights({ 0: 0.5, 1: 0.5 })
      const cMajorTones = ['C', 'E', 'G']

      const scores = calculateScores(cMajorTones, pcWeights, 'diatonic')

      // Support = 0.5 (C only)
      // Clash from C# (semitone above C) = 0.5
      // Color should be lower due to clash penalty
      expect(scores.colorScore).toBeLessThan(scores.supportScore)
    })

    it('adds color bonus for non-diatonic chords', () => {
      // Use lower weights so color score doesn't get capped at 1.0
      const pcWeights = createPcWeights({ 0: 0.3, 4: 0.3 })
      const chordTones = ['C', 'E', 'G']

      const diatonicScores = calculateScores(chordTones, pcWeights, 'diatonic')
      const secondaryScores = calculateScores(chordTones, pcWeights, 'secondary_dominant')
      const borrowedScores = calculateScores(chordTones, pcWeights, 'borrowed')

      // Support scores should be the same
      expect(secondaryScores.supportScore).toBeCloseTo(diatonicScores.supportScore, 2)

      // Non-diatonic should have higher color score due to 0.1 bonus
      expect(secondaryScores.colorScore).toBeGreaterThan(diatonicScores.colorScore)
      expect(borrowedScores.colorScore).toBeGreaterThan(diatonicScores.colorScore)
    })

    it('handles flat notes correctly', () => {
      // Bb = pitch class 10, same as A#
      const pcWeights = createPcWeights({ 10: 0.5, 5: 0.3, 0: 0.2 })
      const fMajorTones = ['F', 'A', 'C'] // F=5, A=9, C=0

      const scores = calculateScores(fMajorTones, pcWeights, 'diatonic')

      // Support = 0.3 (F) + 0 (A) + 0.2 (C) = 0.5
      expect(scores.supportScore).toBeCloseTo(0.5, 2)
    })
  })

  describe('formatChordSymbol', () => {
    it('formats major triads without suffix', () => {
      expect(formatChordSymbol('C')).toBe('C')
      expect(formatChordSymbol('CM')).toBe('C')
      expect(formatChordSymbol('Cmaj')).toBe('C')
      expect(formatChordSymbol('Cmajor')).toBe('C')
    })

    it('formats minor triads with m suffix', () => {
      expect(formatChordSymbol('Am')).toBe('Am')
      expect(formatChordSymbol('Amin')).toBe('Am')
      expect(formatChordSymbol('Aminor')).toBe('Am')
    })

    it('formats diminished chords with ° symbol', () => {
      expect(formatChordSymbol('Bdim')).toBe('B°')
      expect(formatChordSymbol('Bdiminished')).toBe('B°')
    })

    it('formats seventh chords correctly', () => {
      expect(formatChordSymbol('Cmaj7')).toBe('Cmaj7')
      expect(formatChordSymbol('Am7')).toBe('Am7')
      expect(formatChordSymbol('G7')).toBe('G7')
    })

    it('formats half-diminished chords with ø7 symbol', () => {
      expect(formatChordSymbol('Bm7b5')).toBe('Bø7')
    })

    it('formats augmented chords with + symbol', () => {
      expect(formatChordSymbol('Caug')).toBe('C+')
    })

    it('formats suspended chords correctly', () => {
      expect(formatChordSymbol('Csus4')).toBe('Csus4')
      expect(formatChordSymbol('Csus2')).toBe('Csus2')
    })

    it('handles sharps and flats in root', () => {
      expect(formatChordSymbol('F#m')).toBe('F#m')
      expect(formatChordSymbol('Bbmaj7')).toBe('Bbmaj7')
      expect(formatChordSymbol('Eb7')).toBe('Eb7')
    })

    it('works with root and type arguments', () => {
      expect(formatChordSymbol('C', 'M')).toBe('C')
      expect(formatChordSymbol('A', 'm')).toBe('Am')
      expect(formatChordSymbol('G', '7')).toBe('G7')
      expect(formatChordSymbol('B', 'dim')).toBe('B°')
      expect(formatChordSymbol('D', 'maj7')).toBe('Dmaj7')
    })
  })

  describe('generateChordSuggestions', () => {
    // Create a simple C major harmonic field
    const cMajorField: HarmonicFieldCandidate = {
      id: 'C-major',
      tonic: 'C',
      mode: 'Major',
      scaleNotes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
      fitScore: 0.9,
      outOfScale: [],
    }

    // Create features that strongly suggest C major (C, E, G emphasized)
    const cMajorFeatures: RiffFeatures = {
      pcWeights: [0.35, 0, 0, 0, 0.35, 0, 0, 0.3, 0, 0, 0, 0],
      topPitchClasses: [0, 4, 7], // C, E, G
      lastNotePc: 0, // Ends on C
      bassPc: 0, // Bass is C
    }

    it('returns diatonic chords for the harmonic field', () => {
      const result = generateChordSuggestions(cMajorField, cMajorFeatures)

      expect(result.diatonic.length).toBeGreaterThan(0)

      // Should include common C major diatonic chords
      const diatonicSymbols = result.diatonic.map((c) => c.symbol)
      expect(diatonicSymbols).toContain('C')
      expect(diatonicSymbols).toContain('Am')
      expect(diatonicSymbols).toContain('G')
    })

    it('includes secondary dominants', () => {
      const result = generateChordSuggestions(cMajorField, cMajorFeatures)

      expect(result.secondary.length).toBeGreaterThan(0)

      // Should include secondary dominants like V/ii (A7), V/vi (E7)
      const hasSecondaryDominant = result.secondary.some(
        (c) => c.source === 'secondary_dominant' || c.source === 'substitute_dominant'
      )
      expect(hasSecondaryDominant).toBe(true)
    })

    it('includes borrowed chords', () => {
      const result = generateChordSuggestions(cMajorField, cMajorFeatures)

      expect(result.borrowed.length).toBeGreaterThan(0)

      // All borrowed chords should have source = 'borrowed'
      const allBorrowed = result.borrowed.every((c) => c.source === 'borrowed')
      expect(allBorrowed).toBe(true)
    })

    it('provides ranked list sorted by color score', () => {
      const result = generateChordSuggestions(cMajorField, cMajorFeatures)

      expect(result.ranked.length).toBeGreaterThan(0)

      // Verify ranked is sorted by colorScore (descending)
      for (let i = 1; i < result.ranked.length; i++) {
        expect(result.ranked[i - 1].colorScore).toBeGreaterThanOrEqual(result.ranked[i].colorScore)
      }
    })

    it('builds byId index for lookups', () => {
      const result = generateChordSuggestions(cMajorField, cMajorFeatures)

      expect(result.byId.size).toBeGreaterThan(0)

      // Should be able to look up C major chord
      const cMajor = result.byId.get('C')
      expect(cMajor).toBeDefined()
      expect(cMajor?.symbol).toBe('C')
    })

    it('builds byRoman index for lookups', () => {
      const result = generateChordSuggestions(cMajorField, cMajorFeatures)

      expect(result.byRoman.size).toBeGreaterThan(0)

      // Should have I chord
      const tonicChords = result.byRoman.get('I')
      expect(tonicChords).toBeDefined()
      expect(tonicChords!.length).toBeGreaterThan(0)
    })

    it('builds byFunction index for lookups', () => {
      const result = generateChordSuggestions(cMajorField, cMajorFeatures)

      // Should have tonic, subdominant, and dominant function chords
      expect(result.byFunction.get('T')).toBeDefined()
      expect(result.byFunction.get('SD')).toBeDefined()
      expect(result.byFunction.get('D')).toBeDefined()
    })

    it('works with minor harmonic field', () => {
      const aMinorField: HarmonicFieldCandidate = {
        id: 'A-minor',
        tonic: 'A',
        mode: 'Minor',
        scaleNotes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
        fitScore: 0.9,
        outOfScale: [],
      }

      const aMinorFeatures: RiffFeatures = {
        pcWeights: [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 0.4, 0, 0],
        topPitchClasses: [9, 4, 0], // A, E, C
        lastNotePc: 9,
        bassPc: 9,
      }

      const result = generateChordSuggestions(aMinorField, aMinorFeatures)

      expect(result.diatonic.length).toBeGreaterThan(0)

      // Should include Am as tonic
      const diatonicSymbols = result.diatonic.map((c) => c.symbol)
      expect(diatonicSymbols).toContain('Am')
    })
  })
})
