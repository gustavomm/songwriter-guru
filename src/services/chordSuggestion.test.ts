import { describe, it, expect } from 'vitest'
import {
  calculateScores,
  formatChordSymbol,
  generateChordSuggestions,
  romanForChord,
} from './chordSuggestion'
import { Chord, Note } from 'tonal'
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

      // Support = 0.3 (C) + 0.3 (E) + 0 (G not in riff) = 0.6,
      // minus 0.04 for the chord tone the riff never plays (G)
      expect(scores.supportScore).toBeCloseTo(0.56, 2)
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

      // Support = 0.3 (F) + 0 (A) + 0.2 (C) = 0.5, minus 0.04 for the missing A
      expect(scores.supportScore).toBeCloseTo(0.46, 2)
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
      expect(formatChordSymbol('Gaug7')).toBe('G+7')
      expect(formatChordSymbol('G+7')).toBe('G+7')
      expect(formatChordSymbol('D+maj7')).toBe('D+maj7')
    })

    it('formats minor/major seventh chords correctly', () => {
      expect(formatChordSymbol('CmMaj7')).toBe('CmM7')
      expect(formatChordSymbol('C', 'minor/major seventh')).toBe('CmM7')
      expect(formatChordSymbol('G', 'mM7')).toBe('GmM7')
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
  describe('romanForChord', () => {
    const roman = (degree: string, symbol: string) =>
      romanForChord(degree, Chord.get(symbol).intervals)

    it('labels triads by quality', () => {
      expect(roman('I', 'C')).toBe('I')
      expect(roman('vi', 'Am')).toBe('vi')
      expect(roman('vii°', 'Bdim')).toBe('vii°')
      expect(roman('III+', 'Caug')).toBe('III+')
      expect(roman('bVII', 'Bb')).toBe('bVII')
    })

    it('labels seventh and sixth chords by quality', () => {
      expect(roman('i', 'Em6')).toBe('i6')
      expect(roman('i', 'AmMaj7')).toBe('i(maj7)')
      expect(roman('ii°', 'Bm7b5')).toBe('iiø7')
      expect(roman('vii°', 'G#o7')).toBe('vii°7')
      expect(roman('V', 'G7')).toBe('V7')
      expect(roman('IV', 'Fmaj7')).toBe('IVmaj7')
      expect(roman('ii', 'Dm7')).toBe('ii7')
      expect(roman('III+', 'C+maj7')).toBe('III+maj7')
      expect(roman('bVI', 'Abmaj7')).toBe('bVImaj7')
    })
  })

  describe('roman numerals for diatonic chords', () => {
    const features: RiffFeatures = {
      pcWeights: [0.2, 0, 0.1, 0, 0.2, 0.1, 0, 0.2, 0, 0.2, 0, 0],
      topPitchClasses: [0, 4, 7, 9],
    }

    const field = (tonic: string, mode: string): HarmonicFieldCandidate => ({
      id: `${tonic}-${mode.toLowerCase()}`,
      tonic,
      mode,
      scaleNotes: [],
      fitScore: 0.9,
      outOfScale: [],
    })

    const romanOf = (tonic: string, mode: string) => {
      const result = generateChordSuggestions(field(tonic, mode), features)
      return new Map(result.diatonic.map((c) => [c.symbol, c.roman]))
    }

    it('labels major key 7th chords by quality', () => {
      const romans = romanOf('C', 'Major')
      expect(romans.get('Cmaj7')).toBe('Imaj7')
      expect(romans.get('Dm7')).toBe('ii7')
      expect(romans.get('Fmaj7')).toBe('IVmaj7')
      expect(romans.get('G7')).toBe('V7')
      expect(romans.get('Bø7')).toBe('viiø7')
    })

    it('labels natural minor 7th chords by quality', () => {
      const romans = romanOf('A', 'Minor')
      expect(romans.get('Am7')).toBe('i7')
      expect(romans.get('Bø7')).toBe('iiø7')
      expect(romans.get('Cmaj7')).toBe('IIImaj7')
      expect(romans.get('G7')).toBe('VII7')
    })

    it('labels harmonic minor 7th chords by quality', () => {
      const romans = romanOf('A', 'Minor')
      expect(romans.get('AmM7')).toBe('i(maj7)')
      expect(romans.get('C+maj7')).toBe('III+maj7')
      expect(romans.get('E7')).toBe('V7')
      expect(romans.get('G#°7')).toBe('vii°7')
    })

    it('labels melodic minor 7th chords by quality (tonic m6 is i6, not i7)', () => {
      const romans = romanOf('E', 'Minor')
      expect(romans.get('Em6')).toBe('i6')
      expect(romans.get('F#m7')).toBe('ii7')
      expect(romans.get('A7')).toBe('IV7')
      expect(romans.get('C#ø7')).toBe('viø7')
      expect(romans.get('D#ø7')).toBe('viiø7')
    })

    it('never labels a non-dominant 7th chord with a bare 7', () => {
      for (const [tonic, mode] of [
        ['C', 'Major'],
        ['A', 'Minor'],
        ['Eb', 'Minor'],
      ]) {
        const result = generateChordSuggestions(field(tonic, mode), features)
        for (const chord of [...result.diatonic, ...result.borrowed]) {
          const quality = Chord.get(chord.id)
          const isMinorSeventh =
            quality.intervals.includes('3m') &&
            quality.intervals.includes('5P') &&
            quality.intervals.includes('7m')
          const isDominant =
            quality.intervals.includes('3M') &&
            quality.intervals.includes('5P') &&
            quality.intervals.includes('7m')
          if (chord.roman && /[IViv]7$/.test(chord.roman)) {
            expect(isMinorSeventh || isDominant).toBe(true)
          }
        }
      }
    })

    it('labels borrowed 7th chords by quality', () => {
      const result = generateChordSuggestions(field('C', 'Major'), features)
      const romans = new Map(result.borrowed.map((c) => [c.symbol, c.roman]))
      expect(romans.get('Abmaj7')).toBe('bVImaj7')
      expect(romans.get('Bbmaj7')).toBe('bVIImaj7')
      expect(romans.get('Bb7')).toBe('bVII7')
      expect(romans.get('Fm7')).toBe('iv7')
      expect(romans.get('Dø7')).toBe('iiø7')
    })

    it('keeps harmonic functions for borrowed 7th chords', () => {
      const result = generateChordSuggestions(field('C', 'Major'), features)
      const bySymbol = new Map(result.borrowed.map((c) => [c.symbol, c]))
      expect(bySymbol.get('Abmaj7')?.function).toBe('SD')
      expect(bySymbol.get('Bb7')?.function).toBe('D')
      expect(bySymbol.get('Fm7')?.function).toBe('SD')
    })
  })

  describe('flat key spelling', () => {
    const features: RiffFeatures = {
      pcWeights: [0.1, 0, 0.1, 0.1, 0, 0.2, 0, 0.1, 0, 0.1, 0.3, 0],
      topPitchClasses: [10, 5, 3],
    }

    const field = (tonic: string, mode: string): HarmonicFieldCandidate => ({
      id: `${tonic}-${mode.toLowerCase()}`,
      tonic,
      mode,
      scaleNotes: [],
      fitScore: 0.9,
      outOfScale: [],
    })

    it('spells Bb major diatonic triads with flats', () => {
      const result = generateChordSuggestions(field('Bb', 'Major'), features)
      const symbols = result.diatonic.map((c) => c.symbol)
      for (const expected of ['Bb', 'Cm', 'Dm', 'Eb', 'F', 'Gm', 'A°']) {
        expect(symbols).toContain(expected)
      }
      expect(result.byRoman.get('I')?.[0].symbol).toBe('Bb')
      expect(result.byRoman.get('IV')?.[0].symbol).toBe('Eb')
    })

    it('spells Eb minor diatonic chords with flats', () => {
      const result = generateChordSuggestions(field('Eb', 'Minor'), features)
      const symbols = result.diatonic.map((c) => c.symbol)
      for (const expected of ['Ebm', 'F°', 'Gb', 'Abm', 'Bbm', 'Cb', 'Db', 'Bb7', 'D°7']) {
        expect(symbols).toContain(expected)
      }
    })

    it.each([
      ['Bb', 'Major'],
      ['Eb', 'Major'],
      ['Ab', 'Major'],
      ['Db', 'Major'],
      ['F', 'Major'],
      ['Bb', 'Minor'],
      ['Eb', 'Minor'],
      ['C', 'Minor'],
      ['F', 'Minor'],
    ])('produces no double sharps or double-accidental roots in %s %s', (tonic, mode) => {
      const result = generateChordSuggestions(field(tonic, mode), features)
      for (const chord of result.ranked) {
        expect(chord.symbol).not.toMatch(/##|bb/)
        for (const tone of chord.chordTones) {
          expect(tone).not.toMatch(/##/)
        }
      }
    })
  })

  describe('key-aware chord catalog', () => {
    const pcWeights = (weights: Partial<Record<number, number>>): PitchClassWeights => {
      const result: PitchClassWeights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      for (const [pc, weight] of Object.entries(weights)) result[Number(pc)] = weight ?? 0
      return result
    }
    const features = (weights: Partial<Record<number, number>>): RiffFeatures => ({
      pcWeights: pcWeights(weights),
      topPitchClasses: [],
    })
    const aMinorField: HarmonicFieldCandidate = {
      id: 'A-minor',
      tonic: 'A',
      mode: 'Minor',
      scaleNotes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      fitScore: 1,
      outOfScale: [],
    }
    const cMajorField: HarmonicFieldCandidate = {
      id: 'C-major',
      tonic: 'C',
      mode: 'Major',
      scaleNotes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
      fitScore: 1,
      outOfScale: [],
    }
    // A natural minor riff: A B C D E F G
    const aMinorRiff = features({ 9: 0.3, 11: 0.1, 0: 0.15, 2: 0.1, 4: 0.15, 5: 0.1, 7: 0.1 })
    const pitchSet = (tones: string[]) =>
      [...new Set(tones.map((t) => Note.chroma(t)))].sort((a, b) => a - b).join(',')

    it('never lists a chord as both diatonic and borrowed in A minor', () => {
      const result = generateChordSuggestions(aMinorField, aMinorRiff)
      const diatonicSymbols = new Set(result.diatonic.map((c) => c.symbol))
      const diatonicSets = new Set(result.diatonic.map((c) => pitchSet(c.chordTones)))

      for (const chord of result.borrowed) {
        expect(diatonicSymbols.has(chord.symbol), chord.symbol).toBe(false)
        expect(diatonicSets.has(pitchSet(chord.chordTones)), chord.symbol).toBe(false)
      }
      // The harmonic/melodic minor chords stay in the diatonic tab only
      for (const symbol of ['D7', 'E7', 'F#ø7', 'Bm7']) {
        expect(diatonicSymbols.has(symbol)).toBe(true)
        expect(result.borrowed.some((c) => c.symbol === symbol)).toBe(false)
      }
    })

    it('treats the natural minor VII as a dominant-function chord', () => {
      const result = generateChordSuggestions(aMinorField, aMinorRiff)
      const g = result.diatonic.find((c) => c.symbol === 'G')
      const g7 = result.diatonic.find((c) => c.symbol === 'G7')

      expect(g?.roman).toBe('VII')
      expect(g?.function).toBe('D')
      expect(g7?.function).toBe('D')
    })

    it('names borrowed chords relative to the minor key (VII, not bVII)', () => {
      const result = generateChordSuggestions(aMinorField, aMinorRiff)
      const gmaj7 = result.borrowed.find((c) => c.symbol === 'Gmaj7')

      expect(gmaj7?.roman).toBe('VIImaj7')
      expect(result.borrowed.some((c) => c.roman?.startsWith('b'))).toBe(false)
    })

    it('keeps flat-degree names for borrowed chords in major', () => {
      const result = generateChordSuggestions(cMajorField, features({ 0: 0.5, 4: 0.25, 7: 0.25 }))
      expect(result.borrowed.find((c) => c.symbol === 'Bb')?.roman).toBe('bVII')
      expect(result.borrowed.find((c) => c.symbol === 'Ab')?.roman).toBe('bVI')
    })

    it('gives every chord a harmonic function', () => {
      for (const field of [cMajorField, aMinorField]) {
        const result = generateChordSuggestions(field, aMinorRiff)
        for (const chord of result.ranked) {
          expect(chord.function, `${field.id} ${chord.symbol} (${chord.roman})`).toBeDefined()
        }
      }
    })

    it('maps borrowed chords to functions by scale degree', () => {
      const result = generateChordSuggestions(cMajorField, features({ 0: 0.5, 4: 0.25, 7: 0.25 }))
      const fn = (symbol: string) => result.borrowed.find((c) => c.symbol === symbol)?.function

      expect(fn('Cm')).toBe('T') // i
      expect(fn('Eb')).toBe('T') // bIII
      expect(fn('Fm')).toBe('SD') // iv
      expect(fn('Ab')).toBe('SD') // bVI
      expect(fn('Gm')).toBe('D') // v
      expect(fn('Bb')).toBe('D') // bVII
    })

    it('marks harmonic/melodic minor tonic variants as colour, not plain diatonic', () => {
      const result = generateChordSuggestions(aMinorField, aMinorRiff)
      const variant = (symbol: string) =>
        result.diatonic.find((c) => c.symbol === symbol)?.colorVariant

      expect(variant('AmM7')).toBe(true)
      expect(variant('Am6')).toBe(true)
      expect(variant('C+')).toBe(true)
      // Plain tonic chords and the raised-7th dominants are not colour variants
      expect(variant('Am')).toBeFalsy()
      expect(variant('Am7')).toBeFalsy()
      expect(variant('E7')).toBeFalsy()
    })
  })

  describe('seventh-chord bias', () => {
    const weights = (w: Partial<Record<number, number>>): PitchClassWeights => {
      const result: PitchClassWeights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      for (const [pc, weight] of Object.entries(w)) result[Number(pc)] = weight ?? 0
      return result
    }

    it('prefers Am over Am7 when the riff has no G', () => {
      const riff = weights({ 9: 0.4, 0: 0.3, 4: 0.3 }) // A C E
      const am = calculateScores(['A', 'C', 'E'], riff, 'diatonic')
      const am7 = calculateScores(['A', 'C', 'E', 'G'], riff, 'diatonic')

      expect(am.supportScore).toBeGreaterThan(am7.supportScore)
    })

    it('prefers Am7 over Am when the riff plays the G', () => {
      const riff = weights({ 9: 0.35, 0: 0.25, 4: 0.25, 7: 0.15 }) // A C E G
      const am = calculateScores(['A', 'C', 'E'], riff, 'diatonic')
      const am7 = calculateScores(['A', 'C', 'E', 'G'], riff, 'diatonic')

      expect(am7.supportScore).toBeGreaterThan(am.supportScore)
    })

    it('keeps scores within 0..1', () => {
      const scores = calculateScores(['A', 'C', 'E', 'G'], weights({ 1: 1 }), 'borrowed')
      expect(scores.supportScore).toBeGreaterThanOrEqual(0)
      expect(scores.colorScore).toBeGreaterThanOrEqual(0)
      expect(scores.supportScore).toBeLessThanOrEqual(1)
      expect(scores.colorScore).toBeLessThanOrEqual(1)
    })
  })

  describe('colour distance', () => {
    const field = (tonic: string, mode: string): HarmonicFieldCandidate => ({
      id: `${tonic}-${mode}`,
      tonic,
      mode,
      scaleNotes: [],
      fitScore: 1,
      outOfScale: [],
    })
    const features: RiffFeatures = {
      pcWeights: [0.3, 0, 0, 0, 0.3, 0, 0, 0.4, 0, 0, 0, 0],
      topPitchClasses: [7, 0, 4],
    }
    const distances = (tonic: string, mode: string) => {
      const result = generateChordSuggestions(field(tonic, mode), features)
      return new Map([...result.byId.values()].map((c) => [c.symbol, c.colorDistance ?? -1]))
    }

    it('orders colour: diatonic < secondary dominant < borrowed < tritone sub', () => {
      const d = distances('C', 'Major')
      expect(d.get('C')).toBe(0)
      expect(d.get('G7')).toBe(0)
      expect(d.get('D7')).toBeCloseTo(0.45) // V7/V: one chromatic note
      expect(d.get('Bb')).toBeCloseTo(0.5) // bVII
      expect(d.get('Fm')).toBeCloseTo(0.5) // iv
      expect(d.get('Ab')).toBeCloseTo(0.65) // bVI: two chromatic notes
      expect(d.get('Eb7')!).toBeGreaterThan(1) // subV/ii: tritone sub, three chromatic notes
    })

    it('treats the minor leading tone as in key and colour variants as mild colour', () => {
      const d = distances('A', 'Minor')
      expect(d.get('Am')).toBe(0)
      expect(d.get('E7')).toBe(0) // harmonic minor V7
      expect(d.get('AmM7')).toBeCloseTo(0.3) // i(maj7)
      expect(d.get('D')).toBeCloseTo(0.45) // melodic minor IV, F# outside the key
    })
  })
})
