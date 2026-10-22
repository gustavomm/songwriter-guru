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
