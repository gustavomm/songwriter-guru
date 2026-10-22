import { describe, it, expect } from 'vitest'
import { extractFeatures } from './featureExtraction'
import type { TranscribedNote } from '../domain/types'

describe('featureExtraction', () => {
  describe('extractFeatures', () => {
    it('returns zero weights for empty notes array', () => {
      const result = extractFeatures([])

      // All pitch class weights should be zero
      expect(result.pcWeights.every((w) => w === 0)).toBe(true)
      expect(result.topPitchClasses).toEqual([])
      expect(result.lastNotePc).toBeUndefined()
      expect(result.bassPc).toBeUndefined()
    })

    it('extracts pitch class from single note', () => {
      // C4 (MIDI 60) = pitch class 0
      const notes: TranscribedNote[] = [{ startSec: 0, endSec: 1, midi: 60, velocity: 0.8 }]

      const result = extractFeatures(notes)

      // Pitch class 0 (C) should have weight 1.0 (only note)
      expect(result.pcWeights[0]).toBeCloseTo(1.0, 2)
      // All other pitch classes should be 0
      for (let i = 1; i < 12; i++) {
        expect(result.pcWeights[i]).toBe(0)
      }
      expect(result.topPitchClasses).toContain(0)
      expect(result.lastNotePc).toBe(0)
      expect(result.bassPc).toBe(0)
    })

    it('weights notes by duration', () => {
      // Two notes: C4 for 2 seconds, E4 for 1 second
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 2, midi: 60, velocity: 0.5 }, // C4, 2s
        { startSec: 2, endSec: 3, midi: 64, velocity: 0.5 }, // E4, 1s
      ]

      const result = extractFeatures(notes)

      // C (pc 0) should have 2x the weight of E (pc 4) due to duration
      // Total weighted duration: 2*0.5 + 1*0.5 = 1.5
      // C weight: (2*0.5)/1.5 = 2/3 ≈ 0.667
      // E weight: (1*0.5)/1.5 = 1/3 ≈ 0.333
      expect(result.pcWeights[0]).toBeCloseTo(0.667, 2) // C
      expect(result.pcWeights[4]).toBeCloseTo(0.333, 2) // E
    })

    it('weights notes by amplitude/velocity', () => {
      // Two notes with same duration but different velocities
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 60, velocity: 0.8 }, // C4, loud
        { startSec: 1, endSec: 2, midi: 64, velocity: 0.2 }, // E4, soft
      ]

      const result = extractFeatures(notes)

      // Total weighted duration: 1*0.8 + 1*0.2 = 1.0
      // C weight: 0.8/1.0 = 0.8
      // E weight: 0.2/1.0 = 0.2
      expect(result.pcWeights[0]).toBeCloseTo(0.8, 2) // C
      expect(result.pcWeights[4]).toBeCloseTo(0.2, 2) // E
    })

    it('combines duration and amplitude weights', () => {
      // C4: 2 seconds, velocity 0.5 → weighted duration = 1.0
      // E4: 1 second, velocity 1.0 → weighted duration = 1.0
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 2, midi: 60, velocity: 0.5 }, // C4
        { startSec: 2, endSec: 3, midi: 64, velocity: 1.0 }, // E4
      ]

      const result = extractFeatures(notes)

      // Both should have equal weight
      expect(result.pcWeights[0]).toBeCloseTo(0.5, 2) // C
      expect(result.pcWeights[4]).toBeCloseTo(0.5, 2) // E
    })

    it('uses default velocity of 0.5 when not specified', () => {
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 60 }, // No velocity
        { startSec: 1, endSec: 2, midi: 64, velocity: 0.5 },
      ]

      const result = extractFeatures(notes)

      // Both should have equal weight (both use 0.5 velocity)
      expect(result.pcWeights[0]).toBeCloseTo(0.5, 2) // C
      expect(result.pcWeights[4]).toBeCloseTo(0.5, 2) // E
    })

    it('correctly identifies top pitch classes', () => {
      // Notes that strongly emphasize C major triad: C, E, G
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 60, velocity: 0.8 }, // C4
        { startSec: 1, endSec: 2, midi: 64, velocity: 0.7 }, // E4
        { startSec: 2, endSec: 3, midi: 67, velocity: 0.6 }, // G4
        { startSec: 3, endSec: 3.1, midi: 62, velocity: 0.1 }, // D4 (weak passing tone)
      ]

      const result = extractFeatures(notes)

      // C, E, G should be in top pitch classes
      expect(result.topPitchClasses).toContain(0) // C
      expect(result.topPitchClasses).toContain(4) // E
      expect(result.topPitchClasses).toContain(7) // G
    })

    it('returns top 5 pitch classes max', () => {
      // Create notes with 7 different pitch classes
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 60, velocity: 0.9 }, // C
        { startSec: 1, endSec: 2, midi: 62, velocity: 0.8 }, // D
        { startSec: 2, endSec: 3, midi: 64, velocity: 0.7 }, // E
        { startSec: 3, endSec: 4, midi: 65, velocity: 0.6 }, // F
        { startSec: 4, endSec: 5, midi: 67, velocity: 0.5 }, // G
        { startSec: 5, endSec: 6, midi: 69, velocity: 0.4 }, // A
        { startSec: 6, endSec: 7, midi: 71, velocity: 0.3 }, // B
      ]

      const result = extractFeatures(notes)

      expect(result.topPitchClasses.length).toBeLessThanOrEqual(5)
    })

    it('identifies the last note pitch class', () => {
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 60 }, // C4
        { startSec: 1, endSec: 2, midi: 64 }, // E4
        { startSec: 2, endSec: 3, midi: 67 }, // G4 - last note
      ]

      const result = extractFeatures(notes)

      // G = pitch class 7
      expect(result.lastNotePc).toBe(7)
    })

    it('identifies the bass (lowest) note pitch class', () => {
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 48 }, // C3 - lowest
        { startSec: 0.5, endSec: 1, midi: 60 }, // C4
        { startSec: 0.5, endSec: 1, midi: 64 }, // E4
      ]

      const result = extractFeatures(notes)

      // Lowest MIDI is 48 (C3) = pitch class 0
      expect(result.bassPc).toBe(0)
    })

    it('uses onset time, not array order, for first and last notes', () => {
      const notes: TranscribedNote[] = [
        { startSec: 2, endSec: 3, midi: 67 }, // G4 - starts last
        { startSec: 0, endSec: 1, midi: 62 }, // D4 - starts first
        { startSec: 1, endSec: 2, midi: 64 }, // E4
      ]

      const result = extractFeatures(notes)

      expect(result.firstNotePc).toBe(2)
      expect(result.lastNotePc).toBe(7)
    })

    it('uses the lowest note of a final chord as the last note', () => {
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 60 },
        { startSec: 1, endSec: 3, midi: 64 }, // E4 (chord, listed first)
        { startSec: 1.02, endSec: 3, midi: 57 }, // A3 (chord root)
      ]

      expect(extractFeatures(notes).lastNotePc).toBe(9)
    })

    it('picks a sustained low pedal over a single short lowest note', () => {
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 0.1, midi: 43, velocity: 0.6 }, // G2 - short, lowest
        { startSec: 0.2, endSec: 4, midi: 45, velocity: 0.6 }, // A2 - sustained pedal
        { startSec: 0.5, endSec: 1, midi: 60, velocity: 0.8 },
        { startSec: 1, endSec: 1.5, midi: 64, velocity: 0.8 },
      ]

      const result = extractFeatures(notes)

      expect(result.bassPc).toBe(9)
      expect(result.bassStrength).toBeGreaterThan(0.9)
    })

    it('counts repeated low notes towards the bass', () => {
      // E2 played once, A2 played four times (both in the low register)
      const notes: TranscribedNote[] = [40, 45, 64, 45, 67, 45, 69, 45].map((midi, i) => ({
        startSec: i * 0.5,
        endSec: i * 0.5 + 0.4,
        midi,
        velocity: 0.7,
      }))

      const result = extractFeatures(notes)

      expect(result.bassPc).toBe(9)
      expect(result.bassStrength).toBeCloseTo(0.8, 5)
    })

    it('ignores notes above the low register when finding the bass', () => {
      // Long C4 melody notes must not outweigh the A2 bass
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 0.5, midi: 45, velocity: 0.7 },
        { startSec: 0.5, endSec: 3, midi: 60, velocity: 0.9 },
        { startSec: 3, endSec: 6, midi: 60, velocity: 0.9 },
      ]

      expect(extractFeatures(notes).bassPc).toBe(9)
    })

    it('caps a single let-ring note so it cannot dominate the histogram', () => {
      // Four 0.5s notes then a 5s ringing final C: counted as 1s (2× the median)
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 0.5, midi: 57, velocity: 0.5 },
        { startSec: 0.5, endSec: 1, midi: 60, velocity: 0.5 },
        { startSec: 1, endSec: 1.5, midi: 64, velocity: 0.5 },
        { startSec: 1.5, endSec: 2, midi: 57, velocity: 0.5 },
        { startSec: 2, endSec: 7, midi: 60, velocity: 0.5 },
      ]

      const result = extractFeatures(notes)

      // C: 0.5 + 1.0 (capped) = 1.5 of 3.0 total
      expect(result.pcWeights[0]).toBeCloseTo(0.5, 5)
    })

    it('handles octave equivalence (same pitch class for different octaves)', () => {
      // C2, C3, C4 should all contribute to pitch class 0
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 36, velocity: 0.5 }, // C2
        { startSec: 1, endSec: 2, midi: 48, velocity: 0.5 }, // C3
        { startSec: 2, endSec: 3, midi: 60, velocity: 0.5 }, // C4
      ]

      const result = extractFeatures(notes)

      // All weight should be on pitch class 0 (C)
      expect(result.pcWeights[0]).toBeCloseTo(1.0, 2)
      for (let i = 1; i < 12; i++) {
        expect(result.pcWeights[i]).toBe(0)
      }
    })

    it('correctly handles sharps/flats (enharmonic equivalents)', () => {
      // D# (MIDI 63) and Eb have the same pitch class = 3
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 1, midi: 63, velocity: 0.5 }, // D#4 / Eb4
        { startSec: 1, endSec: 2, midi: 70, velocity: 0.5 }, // A#4 / Bb4 (pitch class 10)
      ]

      const result = extractFeatures(notes)

      expect(result.pcWeights[3]).toBeCloseTo(0.5, 2) // D#/Eb
      expect(result.pcWeights[10]).toBeCloseTo(0.5, 2) // A#/Bb
    })

    it('filters out pitch classes with very low weight from topPitchClasses', () => {
      // One dominant note and one very weak note
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: 10, midi: 60, velocity: 1.0 }, // C - strong
        { startSec: 9.9, endSec: 10, midi: 62, velocity: 0.1 }, // D - very weak (0.1s * 0.1 = 0.01)
      ]

      const result = extractFeatures(notes)

      // D should be filtered out due to < 0.01 threshold
      // Total weighted duration: 10*1.0 + 0.1*0.1 = 10.01
      // D weight: 0.01/10.01 ≈ 0.001 (below 0.01 threshold)
      expect(result.topPitchClasses).toContain(0) // C
      expect(result.topPitchClasses).not.toContain(2) // D filtered out
    })
  })
})
