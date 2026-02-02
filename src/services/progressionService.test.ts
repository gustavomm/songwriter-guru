import { describe, it, expect } from 'vitest'
import {
  generateProgressions,
  computeFinalScore,
  scoreCadence,
  scoreAppliedChordResolution,
  scoreNeapolitanResolution,
  scoreSubstituteResolution,
  calculateFunctionBonus,
  type ProgressionScoreComponents,
} from './progressionService'
import { generateChordSuggestions } from './chordSuggestion'
import type { HarmonicFieldCandidate, RiffFeatures, PitchClassWeights } from '../domain/types'

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

      // Check that we have progressions starting with tonic (I)
      const startsWithTonic = progressions.some((p) => p.romans[0] === 'I')
      expect(startsWithTonic).toBe(true)

      // Check that we have progressions containing dominant (V)
      const containsDominant = progressions.some((p) => p.romans.includes('V'))
      expect(containsDominant).toBe(true)

      // Check that we have progressions containing subdominant (IV)
      const containsSubdominant = progressions.some((p) => p.romans.includes('IV'))
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

      // If we have borrowed progressions, they should have borrowed roman numerals
      for (const prog of withBorrowed) {
        const hasBorrowedRoman = prog.romans.some(
          (r) => r.startsWith('b') || (r === 'iv' && cMajorField.mode === 'Major')
        )
        expect(hasBorrowedRoman).toBe(true)
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

  describe('scoreCadence', () => {
    it('gives bonus for authentic cadence (V→I)', () => {
      const score = scoreCadence(['I', 'IV', 'V', 'I'], ['C', 'F', 'G', 'C'], 'C')
      // Should have: tonic ending (0.15) + authentic cadence (0.20) = 0.35+
      expect(score).toBeGreaterThanOrEqual(0.35)
    })

    it('gives bonus for plagal cadence (IV→I)', () => {
      const score = scoreCadence(['I', 'V', 'IV', 'I'], ['C', 'G', 'F', 'C'], 'C')
      // Should have: tonic ending (0.15) + plagal cadence (0.10) = 0.25+
      expect(score).toBeGreaterThanOrEqual(0.25)
    })

    it('gives bonus for tonic ending', () => {
      const tonicEnding = scoreCadence(['I', 'IV', 'V', 'I'], ['C', 'F', 'G', 'C'], 'C')
      const nonTonicEnding = scoreCadence(['I', 'IV', 'I', 'V'], ['C', 'F', 'C', 'G'], 'C')

      expect(tonicEnding).toBeGreaterThan(nonTonicEnding)
    })

    it('gives bonus for half cadence (ending on V)', () => {
      const halfCadence = scoreCadence(['I', 'IV', 'V'], ['C', 'F', 'G'], 'C')
      // Half cadence bonus is 0.05
      expect(halfCadence).toBeGreaterThanOrEqual(0.05)
    })

    it('recognizes Neapolitan cadence (bII→V)', () => {
      const withNeapolitan = scoreCadence(['I', 'bII', 'V', 'I'], ['C', 'Db', 'G', 'C'], 'C')
      const withoutNeapolitan = scoreCadence(['I', 'IV', 'V', 'I'], ['C', 'F', 'G', 'C'], 'C')

      // Both have authentic cadence, but Neapolitan adds +0.10
      expect(withNeapolitan).toBeGreaterThan(withoutNeapolitan)
    })

    it('clamps maximum score to 1', () => {
      // Multiple bonuses stacking
      const score = scoreCadence(['bII', 'V', 'I'], ['Db', 'G', 'C'], 'C')
      expect(score).toBeLessThanOrEqual(1)
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

  describe('calculateFunctionBonus', () => {
    it('gives bonus for tonic in final slot', () => {
      const bonus = calculateFunctionBonus('T', 3, 4, null)
      expect(bonus).toBe(0.15)
    })

    it('gives no bonus for tonic in non-final slot', () => {
      const bonus = calculateFunctionBonus('T', 0, 4, null)
      expect(bonus).toBe(0)
    })

    it('gives bonus for dominant in pre-cadential position', () => {
      // Position 2 in 4-slot progression (slot n-2)
      const bonus1 = calculateFunctionBonus('D', 2, 4, null)
      // Position 3 in 4-slot progression (slot n-1, last slot)
      const bonus2 = calculateFunctionBonus('D', 3, 4, null)

      expect(bonus1).toBe(0.1)
      expect(bonus2).toBe(0.1)
    })

    it('gives no bonus for dominant in early position', () => {
      const bonus = calculateFunctionBonus('D', 0, 4, null)
      expect(bonus).toBe(0)
    })

    it('gives bonus for subdominant before dominant', () => {
      const bonus = calculateFunctionBonus('SD', 1, 4, 'D')
      expect(bonus).toBe(0.08)
    })

    it('gives no bonus for subdominant not before dominant', () => {
      const bonus = calculateFunctionBonus('SD', 1, 4, 'T')
      expect(bonus).toBe(0)
    })

    it('returns 0 for null function', () => {
      const bonus = calculateFunctionBonus(null, 0, 4, null)
      expect(bonus).toBe(0)
    })
  })
})
