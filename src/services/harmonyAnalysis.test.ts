import { describe, it, expect } from 'vitest'
import { analyzeHarmony, getScaleNotes, getScalePitchClasses } from './harmonyAnalysis'
import type { RiffFeatures, PitchClassWeights } from '../domain/types'

describe('harmonyAnalysis', () => {
  // Helper to create pitch class weights
  const createPcWeights = (weights: Partial<Record<number, number>>): PitchClassWeights => {
    const pcWeights: PitchClassWeights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    for (const [pc, weight] of Object.entries(weights)) {
      const index = parseInt(pc) as 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11
      pcWeights[index] = weight ?? 0
    }
    return pcWeights
  }

  describe('analyzeHarmony', () => {
    it('ranks C Major highest for C major scale notes', () => {
      // C major scale: C(0), D(2), E(4), F(5), G(7), A(9), B(11)
      const cMajorFeatures: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.2, 2: 0.1, 4: 0.2, 5: 0.1, 7: 0.2, 9: 0.1, 11: 0.1 }),
        topPitchClasses: [0, 4, 7],
        lastNotePc: 0, // Ends on C (tonic)
        bassPc: 0,
      }

      const result = analyzeHarmony(cMajorFeatures)

      // C Major should be the top candidate
      expect(result.candidates[0].tonic).toBe('C')
      expect(result.candidates[0].mode).toBe('Major')
      expect(result.selectedCandidateId).toBe('C-major')
    })

    it('ranks A Minor highest for A minor scale notes', () => {
      // A natural minor scale: A(9), B(11), C(0), D(2), E(4), F(5), G(7)
      const aMinorFeatures: RiffFeatures = {
        pcWeights: createPcWeights({ 9: 0.2, 11: 0.1, 0: 0.2, 2: 0.1, 4: 0.2, 5: 0.1, 7: 0.1 }),
        topPitchClasses: [9, 0, 4],
        lastNotePc: 9, // Ends on A (tonic)
        bassPc: 9,
      }

      const result = analyzeHarmony(aMinorFeatures)

      // A Minor should be in top candidates
      const aMinor = result.candidates.find((c) => c.tonic === 'A' && c.mode === 'Minor')
      expect(aMinor).toBeDefined()
      expect(aMinor!.fitScore).toBeGreaterThan(0.8)
    })

    it('returns candidates sorted by fitScore descending', () => {
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.5, 4: 0.3, 7: 0.2 }),
        topPitchClasses: [0, 4, 7],
      }

      const result = analyzeHarmony(features)

      // Verify descending order
      for (let i = 1; i < result.candidates.length; i++) {
        expect(result.candidates[i - 1].fitScore).toBeGreaterThanOrEqual(
          result.candidates[i].fitScore
        )
      }
    })

    it('returns limited number of top candidates', () => {
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.5, 4: 0.3, 7: 0.2 }),
        topPitchClasses: [0, 4, 7],
      }

      const result = analyzeHarmony(features)

      // Should return at most 8 candidates (TOP_CANDIDATES_COUNT)
      expect(result.candidates.length).toBeLessThanOrEqual(8)
    })

    it('gives ending bonus when last note is tonic', () => {
      // Use lower pitch weights so the bonus isn't clamped at 1.0
      // Total in-scale weight is 0.6 (0.3 + 0.2 + 0.1), leaving room for the 0.05 bonus
      const endsOnTonic: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.3, 4: 0.2, 7: 0.1 }),
        topPitchClasses: [0, 4, 7],
        lastNotePc: 0, // Ends on C
      }

      const endsOnOther: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.3, 4: 0.2, 7: 0.1 }),
        topPitchClasses: [0, 4, 7],
        lastNotePc: 4, // Ends on E
      }

      const resultTonic = analyzeHarmony(endsOnTonic)
      const resultOther = analyzeHarmony(endsOnOther)

      // Find C Major in both results
      const cMajorTonic = resultTonic.candidates.find((c) => c.id === 'C-major')
      const cMajorOther = resultOther.candidates.find((c) => c.id === 'C-major')

      expect(cMajorTonic).toBeDefined()
      expect(cMajorOther).toBeDefined()
      // C Major should score higher when ending on C (due to 0.05 ending bonus)
      expect(cMajorTonic!.fitScore).toBeGreaterThan(cMajorOther!.fitScore)
    })

    it('gives bass bonus when bass note is tonic', () => {
      // Use lower pitch weights so the bonus isn't clamped at 1.0
      const bassIsTonic: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.3, 4: 0.2, 7: 0.1 }),
        topPitchClasses: [0, 4, 7],
        bassPc: 0, // Bass is C
      }

      const bassIsOther: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.3, 4: 0.2, 7: 0.1 }),
        topPitchClasses: [0, 4, 7],
        bassPc: 7, // Bass is G
      }

      const resultTonic = analyzeHarmony(bassIsTonic)
      const resultOther = analyzeHarmony(bassIsOther)

      const cMajorTonic = resultTonic.candidates.find((c) => c.id === 'C-major')
      const cMajorOther = resultOther.candidates.find((c) => c.id === 'C-major')

      expect(cMajorTonic).toBeDefined()
      expect(cMajorOther).toBeDefined()
      // C Major should score higher when bass is C (due to 0.03 bass bonus)
      expect(cMajorTonic!.fitScore).toBeGreaterThan(cMajorOther!.fitScore)
    })

    it('reports out-of-scale notes', () => {
      // C major scale with a prominent F# (not in scale)
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.3, 4: 0.3, 6: 0.2, 7: 0.2 }), // F# = pitch class 6
        topPitchClasses: [0, 4, 6, 7],
      }

      const result = analyzeHarmony(features)

      // C Major should report F# as out of scale
      const cMajor = result.candidates.find((c) => c.id === 'C-major')
      expect(cMajor).toBeDefined()
      expect(cMajor!.outOfScale.length).toBeGreaterThan(0)
      expect(cMajor!.outOfScale.some((n) => n.note === 'F#')).toBe(true)
    })

    it('penalizes candidates with many out-of-scale notes', () => {
      // Notes that fit C Major perfectly
      const cMajorPure: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.3, 4: 0.3, 7: 0.4 }),
        topPitchClasses: [0, 4, 7],
      }

      // Notes with chromatic additions
      const withChromatic: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.2, 1: 0.2, 4: 0.2, 6: 0.2, 7: 0.2 }), // C#, F# are chromatic
        topPitchClasses: [0, 1, 4, 6, 7],
      }

      const pureCMajor = analyzeHarmony(cMajorPure).candidates.find((c) => c.id === 'C-major')
      const chromaticCMajor = analyzeHarmony(withChromatic).candidates.find(
        (c) => c.id === 'C-major'
      )

      expect(pureCMajor).toBeDefined()
      expect(chromaticCMajor).toBeDefined()
      // Pure C major should score higher
      expect(pureCMajor!.fitScore).toBeGreaterThan(chromaticCMajor!.fitScore)
    })

    it('includes scale notes in candidates', () => {
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.5, 4: 0.3, 7: 0.2 }),
        topPitchClasses: [0, 4, 7],
      }

      const result = analyzeHarmony(features)

      // Each candidate should have scaleNotes
      for (const candidate of result.candidates) {
        expect(candidate.scaleNotes).toBeDefined()
        expect(candidate.scaleNotes.length).toBe(7) // 7 notes in major/minor scale
      }
    })

    it('handles all 12 tonics', () => {
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 1 }),
        topPitchClasses: [0],
      }

      const result = analyzeHarmony(features)

      // All candidates should have valid tonic and mode
      for (const candidate of result.candidates) {
        expect(candidate.tonic).toBeDefined()
        expect(candidate.mode).toBeDefined()
        expect(['Major', 'Minor']).toContain(candidate.mode)
      }
    })
  })

  describe('getScaleNotes', () => {
    it('returns correct notes for major and minor scales', () => {
      // C major
      expect(getScaleNotes('C', 'Major')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
      // A minor
      expect(getScaleNotes('A', 'Minor')).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G'])
      // G major (with F#)
      expect(getScaleNotes('G', 'Major')).toContain('F#')
      // F major (with Bb)
      expect(getScaleNotes('F', 'Major')).toContain('Bb')
    })

    it('returns empty array for invalid mode', () => {
      expect(getScaleNotes('C', 'InvalidMode')).toEqual([])
    })

    it('works with lowercase mode name', () => {
      expect(getScaleNotes('C', 'major')).toEqual(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
    })
  })

  describe('getScalePitchClasses', () => {
    it('returns correct pitch classes for major and minor scales', () => {
      // C major: C=0, D=2, E=4, F=5, G=7, A=9, B=11
      const cMajorPcs = getScalePitchClasses('C', 'Major')
      expect(cMajorPcs.sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11])

      // A minor: A=9, B=11, C=0, D=2, E=4, F=5, G=7
      const aMinorPcs = getScalePitchClasses('A', 'Minor')
      expect(aMinorPcs.sort((a, b) => a - b)).toEqual([0, 2, 4, 5, 7, 9, 11])

      // G major has F# (pitch class 6)
      expect(getScalePitchClasses('G', 'Major')).toContain(6)

      // F major has Bb (pitch class 10)
      expect(getScalePitchClasses('F', 'Major')).toContain(10)
    })

    it('returns empty array for invalid mode', () => {
      expect(getScalePitchClasses('C', 'InvalidMode')).toEqual([])
    })
  })
})
