import { describe, it, expect } from 'vitest'
import { analyzeHarmony, getScaleNotes, getScalePitchClasses } from './harmonyAnalysis'
import { extractFeatures } from './featureExtraction'
import type { RiffFeatures, PitchClassWeights, TranscribedNote } from '../domain/types'

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

  // Helper to build a riff from MIDI numbers: 0.45s notes every 0.5s, velocity 0.8
  const riffFromMidi = (midis: number[]): TranscribedNote[] =>
    midis.map((midi, i) => ({
      midi,
      startSec: i * 0.5,
      endSec: i * 0.5 + 0.45,
      velocity: 0.8,
    }))

  // Helper to look up a candidate's display data among all returned candidates
  const findCandidate = (features: RiffFeatures, id: string) =>
    analyzeHarmony(features).candidates.find((c) => c.id === id)

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

      // A Minor should beat its relative major (same notes, different tonic)
      expect(result.selectedCandidateId).toBe('A-minor')
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
        pcWeights: createPcWeights({ 0: 0.3, 1: 0.1, 4: 0.3, 6: 0.1, 7: 0.2 }), // C#, F# are chromatic
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
        pcWeights: createPcWeights({ 0: 0.5, 4: 0.3, 7: 0.2 }),
        topPitchClasses: [0, 4, 7],
      }

      const result = analyzeHarmony(features)

      // All candidates should have valid tonic and mode
      expect(result.candidates.length).toBeGreaterThan(0)
      for (const candidate of result.candidates) {
        expect(candidate.tonic).toBeDefined()
        expect(candidate.mode).toBeDefined()
        expect(['Major', 'Minor']).toContain(candidate.mode)
      }
    })
  })

  describe('insufficient input', () => {
    it('returns no candidates for empty input', () => {
      const result = analyzeHarmony(extractFeatures([]))
      expect(result.candidates).toEqual([])
      expect(result.selectedCandidateId).toBe('')
      expect(result.ambiguous).toBe(false)
    })

    it('returns no candidates for a single pitch class', () => {
      // A2, A3 and A4: one pitch class says nothing about major vs minor
      const result = analyzeHarmony(extractFeatures(riffFromMidi([45, 57, 69, 57])))
      expect(result.candidates).toEqual([])
      expect(result.selectedCandidateId).toBe('')
    })

    it('ignores a negligible ghost pitch class when counting pitch classes', () => {
      const result = analyzeHarmony({
        pcWeights: createPcWeights({ 9: 0.99, 1: 0.01 }),
        topPitchClasses: [9],
      })
      expect(result.candidates).toEqual([])
    })

    it('flags a two-pitch-class (power chord) riff as ambiguous', () => {
      // E and B only: E major and E minor are equally plausible
      const result = analyzeHarmony(extractFeatures(riffFromMidi([40, 47, 40, 47, 40])))
      expect(result.ambiguous).toBe(true)
      expect(result.candidates[0].tonic).toBe('E')
      expect(result.alternativeCandidateId).toBe(result.candidates[1].id)
    })
  })

  describe('confidence', () => {
    it('gives each candidate a confidence in 0-1, descending, summing to at most 1', () => {
      const result = analyzeHarmony(
        extractFeatures(riffFromMidi([60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]))
      )
      const confidences = result.candidates.map((c) => c.confidence ?? NaN)
      for (let i = 0; i < confidences.length; i++) {
        expect(confidences[i]).toBeGreaterThanOrEqual(0)
        expect(confidences[i]).toBeLessThanOrEqual(1)
        if (i > 0) expect(confidences[i - 1]).toBeGreaterThanOrEqual(confidences[i])
      }
      expect(confidences.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(1 + 1e-9)
    })

    it('is confident and not ambiguous for a clear diatonic riff', () => {
      // C major scale up and down, ending on C
      const result = analyzeHarmony(
        extractFeatures(riffFromMidi([60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]))
      )
      expect(result.selectedCandidateId).toBe('C-major')
      expect(result.ambiguous).toBe(false)
      expect(result.alternativeCandidateId).toBeUndefined()
      expect(result.candidates[0].confidence).toBeGreaterThan(0.75)
    })

    it('does not penalize the raised 6th and 7th in minor', () => {
      // A melodic minor ascending (F#, G#) vs A natural minor ascending (F, G)
      const melodic = analyzeHarmony(
        extractFeatures(riffFromMidi([57, 59, 60, 62, 64, 66, 68, 69, 64, 57]))
      )
      const natural = analyzeHarmony(
        extractFeatures(riffFromMidi([57, 59, 60, 62, 64, 65, 67, 69, 64, 57]))
      )
      const melodicFit = melodic.candidates.find((c) => c.id === 'A-minor')!.fitScore
      const naturalFit = natural.candidates.find((c) => c.id === 'A-minor')!.fitScore
      expect(melodic.selectedCandidateId).toBe('A-minor')
      expect(naturalFit - melodicFit).toBeLessThan(0.02)
    })
  })

  describe('key spelling', () => {
    it.each([
      {
        id: 'Bb-major',
        midis: [58, 60, 62, 63, 65, 67, 69, 70, 65, 62, 58],
        scale: ['Bb', 'C', 'D', 'Eb', 'F', 'G', 'A'],
      },
      {
        id: 'Eb-major',
        midis: [63, 65, 67, 68, 70, 72, 74, 75, 70, 67, 63],
        scale: ['Eb', 'F', 'G', 'Ab', 'Bb', 'C', 'D'],
      },
      {
        id: 'Ab-major',
        midis: [68, 70, 72, 73, 75, 77, 79, 80, 75, 72, 68],
        scale: ['Ab', 'Bb', 'C', 'Db', 'Eb', 'F', 'G'],
      },
      {
        id: 'Bb-minor',
        midis: [58, 61, 65, 70, 68, 65, 63, 61, 58],
        scale: ['Bb', 'C', 'Db', 'Eb', 'F', 'Gb', 'Ab'],
      },
      {
        id: 'Eb-minor',
        midis: [63, 66, 70, 75, 73, 70, 68, 66, 63],
        scale: ['Eb', 'F', 'Gb', 'Ab', 'Bb', 'Cb', 'Db'],
      },
    ])('spells $id with flats', ({ id, midis, scale }) => {
      const result = analyzeHarmony(extractFeatures(riffFromMidi(midis)))

      expect(result.selectedCandidateId).toBe(id)
      expect(result.candidates[0].tonic).toBe(id.split('-')[0])
      expect(result.candidates[0].scaleNotes).toEqual(scale)
    })

    it('uses conventional tonic spellings and never double accidentals', () => {
      const majorTonics = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
      const minorTonics = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']

      // A tonic + fifth riff pulls each of the 12 tonics to the top in turn
      for (let pc = 0; pc < 12; pc++) {
        const result = analyzeHarmony({
          pcWeights: createPcWeights({ [pc]: 0.7, [(pc + 7) % 12]: 0.3 }),
          topPitchClasses: [pc, (pc + 7) % 12],
          lastNotePc: pc,
          bassPc: pc,
        })
        expect(result.candidates.length).toBeGreaterThan(0)

        for (const candidate of result.candidates) {
          const tonics = candidate.mode === 'Major' ? majorTonics : minorTonics
          expect(tonics).toContain(candidate.tonic)
          expect(candidate.id).toBe(`${candidate.tonic}-${candidate.mode.toLowerCase()}`)
          for (const note of candidate.scaleNotes) {
            expect(note).not.toMatch(/##|bb/)
          }
        }
      }
    })

    it('spells out-of-scale notes using the key (flats in flat keys)', () => {
      // F major riff with a chromatic Eb (pitch class 3)
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 5: 0.3, 9: 0.2, 0: 0.2, 3: 0.15, 7: 0.15 }),
        topPitchClasses: [5, 9, 0, 3, 7],
        lastNotePc: 5,
        bassPc: 5,
      }

      const fMajor = findCandidate(features, 'F-major')
      expect(fMajor).toBeDefined()
      expect(fMajor!.outOfScale.map((n) => n.note)).toContain('Eb')
      expect(fMajor!.outOfScale.map((n) => n.note)).not.toContain('D#')
    })

    it('spells the raised sixth of a minor key with a sharp', () => {
      // An A melodic minor riff: A B C D E F# G#
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 9: 0.3, 11: 0.1, 0: 0.15, 2: 0.1, 4: 0.15, 6: 0.1, 8: 0.1 }),
        topPitchClasses: [9, 0, 4, 11, 6],
        lastNotePc: 9,
        bassPc: 9,
      }

      const aMinor = findCandidate(features, 'A-minor')
      expect(aMinor).toBeDefined()
      // The raised 7th (G#) is the harmonic minor leading tone and counts as
      // in-scale; the raised 6th is reported (spelled F#, not Gb)
      expect(aMinor!.outOfScale).toEqual([{ note: 'F#', weight: 0.1 }])
    })
  })

  describe('relative keys', () => {
    it('ranks C major clearly above A minor for a C major riff', () => {
      // C D E F G A B C G E C
      const features = extractFeatures(riffFromMidi([60, 62, 64, 65, 67, 69, 71, 72, 67, 64, 60]))
      const result = analyzeHarmony(features)

      expect(result.selectedCandidateId).toBe('C-major')
      const cMajor = result.candidates.find((c) => c.id === 'C-major')!
      const aMinor = result.candidates.find((c) => c.id === 'A-minor')!
      expect(aMinor).toBeDefined()
      expect(cMajor.fitScore - aMinor.fitScore).toBeGreaterThan(0.05)
    })

    it('ranks A minor clearly above C major for an A minor riff', () => {
      // A C E A G E D C A — weighted on A and E, ending on A
      const features = extractFeatures(riffFromMidi([57, 60, 64, 69, 67, 64, 62, 60, 57]))
      const result = analyzeHarmony(features)

      expect(result.selectedCandidateId).toBe('A-minor')
      const aMinor = result.candidates.find((c) => c.id === 'A-minor')!
      const cMajor = result.candidates.find((c) => c.id === 'C-major')!
      expect(cMajor).toBeDefined()
      expect(aMinor.fitScore - cMajor.fitScore).toBeGreaterThan(0.05)
    })

    it('keeps display scores within 0-1 without collapsing ties at 1.0', () => {
      // Every note in C major / A minor, with endings and bass on C
      const features: RiffFeatures = {
        pcWeights: createPcWeights({ 0: 0.4, 4: 0.3, 7: 0.3 }),
        topPitchClasses: [0, 4, 7],
        lastNotePc: 0,
        bassPc: 0,
      }

      const result = analyzeHarmony(features)

      for (const candidate of result.candidates) {
        expect(candidate.fitScore).toBeGreaterThanOrEqual(0)
        expect(candidate.fitScore).toBeLessThanOrEqual(1)
      }
      const scores = result.candidates.map((c) => c.fitScore)
      expect(scores[0]).toBeGreaterThan(scores[1])
    })
  })

  describe('degenerate input', () => {
    it('returns no candidates for an empty riff', () => {
      const result = analyzeHarmony(extractFeatures([]))

      expect(result.candidates).toEqual([])
      expect(result.selectedCandidateId).toBe('')
    })

    it('returns no candidates for a single repeated pitch class', () => {
      // A A A A (two octaves): one pitch class can't define a key
      const result = analyzeHarmony(extractFeatures(riffFromMidi([57, 57, 69, 57])))

      expect(result.candidates).toEqual([])
      expect(result.selectedCandidateId).toBe('')
    })

    it('still ranks keys for two distinct pitch classes', () => {
      const result = analyzeHarmony(extractFeatures(riffFromMidi([57, 64, 57, 64])))

      expect(result.candidates.length).toBeGreaterThan(0)
      expect(result.selectedCandidateId).toBe(result.candidates[0].id)
    })
  })

  describe('harmonic minor leading tone', () => {
    // A C E D C B G# A E F E A: A harmonic minor with the raised 7th
    const harmonicMinorRiff = [57, 60, 64, 62, 60, 59, 56, 57, 64, 65, 64, 57]

    it('does not let a G# in an A minor riff lose to A major', () => {
      const result = analyzeHarmony(extractFeatures(riffFromMidi(harmonicMinorRiff)))
      const aMinor = result.candidates.find((c) => c.id === 'A-minor')
      const aMajor = result.candidates.find((c) => c.id === 'A-major')

      expect(result.selectedCandidateId).toBe('A-minor')
      expect(aMinor).toBeDefined()
      if (aMajor) expect(aMinor!.fitScore).toBeGreaterThan(aMajor.fitScore)
    })

    it('does not penalize or report the raised 7th of a minor key', () => {
      const withLeadingTone = extractFeatures(riffFromMidi(harmonicMinorRiff))
      const aMinor = analyzeHarmony(withLeadingTone).candidates.find((c) => c.id === 'A-minor')!

      expect(aMinor.outOfScale.map((o) => o.note)).not.toContain('G#')
      // Every note is in A harmonic minor, so the fit is as good as an
      // all-diatonic riff with the same tonic emphasis
      const naturalRiff = harmonicMinorRiff.map((midi) => (midi === 56 ? 55 : midi))
      const aMinorNatural = analyzeHarmony(
        extractFeatures(riffFromMidi(naturalRiff))
      ).candidates.find((c) => c.id === 'A-minor')!
      expect(aMinor.fitScore).toBeCloseTo(aMinorNatural.fitScore, 5)
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
