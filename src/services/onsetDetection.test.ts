import { describe, it, expect } from 'vitest'
import {
  detectOnsets,
  findNearestOnset,
  snapNotesToOnsets,
  getOnsetDensity,
  hasStrongOnsetNear,
  type OnsetEvent,
} from './onsetDetection'

describe('onsetDetection', () => {
  // Helper to create a simple sine wave
  const createSineWave = (
    frequency: number,
    amplitude: number,
    durationMs: number,
    sampleRate: number = 22050
  ): Float32Array => {
    const numSamples = Math.round((durationMs / 1000) * sampleRate)
    const data = new Float32Array(numSamples)
    for (let i = 0; i < numSamples; i++) {
      data[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / sampleRate)
    }
    return data
  }

  // Helper to create silence
  const createSilence = (durationMs: number, sampleRate: number = 22050): Float32Array => {
    const numSamples = Math.round((durationMs / 1000) * sampleRate)
    return new Float32Array(numSamples)
  }

  // Helper to create audio with distinct attacks
  const createAudioWithAttacks = (
    attackTimesSec: number[],
    toneDurationMs: number,
    totalDurationMs: number,
    sampleRate: number = 22050
  ): Float32Array => {
    const totalSamples = Math.round((totalDurationMs / 1000) * sampleRate)
    const audio = new Float32Array(totalSamples)
    const toneSamples = Math.round((toneDurationMs / 1000) * sampleRate)

    for (const attackTime of attackTimesSec) {
      const startSample = Math.round(attackTime * sampleRate)
      for (let i = 0; i < toneSamples && startSample + i < totalSamples; i++) {
        // Add a tone with quick attack
        const envelope = Math.min(1, i / 100) // Quick 100-sample attack
        audio[startSample + i] += 0.8 * envelope * Math.sin((2 * Math.PI * 440 * i) / sampleRate)
      }
    }

    return audio
  }

  describe('detectOnsets', () => {
    it('returns empty array for very short audio', () => {
      const shortAudio = new Float32Array(100) // Less than FFT size
      const onsets = detectOnsets(shortAudio, 22050)
      expect(onsets).toEqual([])
    })

    it('returns empty array for silence', () => {
      const silence = createSilence(500)
      const onsets = detectOnsets(silence, 22050)
      expect(onsets.length).toBe(0)
    })

    it('detects onset at start of tone', () => {
      // Silence followed by tone
      const silence = createSilence(200)
      const tone = createSineWave(440, 0.8, 300)
      const audio = new Float32Array(silence.length + tone.length)
      audio.set(silence, 0)
      audio.set(tone, silence.length)

      const onsets = detectOnsets(audio, 22050)

      // Should detect at least one onset near where tone starts
      expect(onsets.length).toBeGreaterThanOrEqual(1)
      if (onsets.length > 0) {
        // Onset should be near 0.2 seconds (where tone starts)
        // Due to FFT windowing, onset may be detected slightly earlier
        const firstOnset = onsets[0]
        expect(firstOnset.timeSec).toBeGreaterThan(0.1)
        expect(firstOnset.timeSec).toBeLessThan(0.35)
      }
    })

    it('detects multiple distinct onsets', () => {
      // Create audio with clear attacks at known times
      const audio = createAudioWithAttacks([0.2, 0.6, 1.0], 150, 1500)

      const onsets = detectOnsets(audio, 22050)

      // Should detect onsets near each attack time
      expect(onsets.length).toBeGreaterThanOrEqual(2)
    })

    it('returns onsets with strength between 0 and 1', () => {
      const audio = createAudioWithAttacks([0.3], 200, 600)
      const onsets = detectOnsets(audio, 22050)

      for (const onset of onsets) {
        expect(onset.strength).toBeGreaterThanOrEqual(0)
        expect(onset.strength).toBeLessThanOrEqual(1)
      }
    })

    it('respects minimum interval between onsets', () => {
      const audio = createAudioWithAttacks([0.2, 0.6, 1.0], 150, 1500)
      const onsets = detectOnsets(audio, 22050)

      // Check minimum interval (30ms)
      for (let i = 1; i < onsets.length; i++) {
        const interval = onsets[i].timeSec - onsets[i - 1].timeSec
        expect(interval).toBeGreaterThanOrEqual(0.03)
      }
    })
  })

  describe('findNearestOnset', () => {
    const mockOnsets: OnsetEvent[] = [
      { timeSec: 0.5, strength: 0.8 },
      { timeSec: 1.0, strength: 0.7 },
      { timeSec: 1.5, strength: 0.9 },
    ]

    it('returns nearest onset within distance', () => {
      const result = findNearestOnset(mockOnsets, 0.52, 0.05)
      expect(result).toBeDefined()
      expect(result?.timeSec).toBe(0.5)
    })

    it('returns undefined when no onset within distance', () => {
      const result = findNearestOnset(mockOnsets, 0.7, 0.05)
      expect(result).toBeUndefined()
    })

    it('returns closest when multiple onsets within distance', () => {
      const result = findNearestOnset(mockOnsets, 0.51, 0.1)
      expect(result?.timeSec).toBe(0.5) // 0.5 is closer than 1.0
    })

    it('uses default max distance of 0.05', () => {
      const result = findNearestOnset(mockOnsets, 0.53)
      expect(result).toBeDefined()

      const farResult = findNearestOnset(mockOnsets, 0.6)
      expect(farResult).toBeUndefined()
    })

    it('returns undefined for empty onset array', () => {
      const result = findNearestOnset([], 0.5)
      expect(result).toBeUndefined()
    })
  })

  describe('snapNotesToOnsets', () => {
    const mockOnsets: OnsetEvent[] = [
      { timeSec: 0.1, strength: 0.8 },
      { timeSec: 0.5, strength: 0.7 },
      { timeSec: 1.0, strength: 0.9 },
    ]

    interface MockNote {
      startSec: number
      midi: number
    }

    it('snaps note start time to nearby onset', () => {
      const notes: MockNote[] = [{ startSec: 0.12, midi: 60 }]
      const result = snapNotesToOnsets(notes, mockOnsets, 0.05)

      expect(result[0].startSec).toBe(0.1) // Snapped to onset at 0.1
    })

    it('does not snap notes far from onsets', () => {
      const notes: MockNote[] = [{ startSec: 0.3, midi: 60 }]
      const result = snapNotesToOnsets(notes, mockOnsets, 0.05)

      expect(result[0].startSec).toBe(0.3) // Unchanged
    })

    it('preserves other note properties', () => {
      const notes: MockNote[] = [{ startSec: 0.12, midi: 64 }]
      const result = snapNotesToOnsets(notes, mockOnsets)

      expect(result[0].midi).toBe(64)
    })

    it('returns unchanged notes when no onsets', () => {
      const notes: MockNote[] = [{ startSec: 0.5, midi: 60 }]
      const result = snapNotesToOnsets(notes, [])

      expect(result).toEqual(notes)
    })

    it('snaps multiple notes independently', () => {
      const notes: MockNote[] = [
        { startSec: 0.12, midi: 60 },
        { startSec: 0.52, midi: 64 },
        { startSec: 0.7, midi: 67 }, // No nearby onset
      ]
      const result = snapNotesToOnsets(notes, mockOnsets, 0.05)

      expect(result[0].startSec).toBe(0.1) // Snapped
      expect(result[1].startSec).toBe(0.5) // Snapped
      expect(result[2].startSec).toBe(0.7) // Unchanged
    })
  })

  describe('getOnsetDensity', () => {
    const mockOnsets: OnsetEvent[] = [
      { timeSec: 0.2, strength: 0.8 },
      { timeSec: 0.4, strength: 0.7 },
      { timeSec: 0.6, strength: 0.9 },
      { timeSec: 0.8, strength: 0.6 },
    ]

    it('calculates correct density', () => {
      // 4 onsets in 1 second = 4 onsets/sec
      const density = getOnsetDensity(mockOnsets, 0, 1)
      expect(density).toBe(4)
    })

    it('calculates density for partial window', () => {
      // 2 onsets (0.2, 0.4) in 0.5 seconds = 4 onsets/sec
      const density = getOnsetDensity(mockOnsets, 0, 0.5)
      expect(density).toBe(4)
    })

    it('returns 0 for window with no onsets', () => {
      const density = getOnsetDensity(mockOnsets, 1.5, 2.0)
      expect(density).toBe(0)
    })

    it('returns 0 for zero-length window', () => {
      const density = getOnsetDensity(mockOnsets, 0.5, 0.5)
      expect(density).toBe(0)
    })

    it('returns 0 for negative-length window', () => {
      const density = getOnsetDensity(mockOnsets, 1.0, 0.5)
      expect(density).toBe(0)
    })
  })

  describe('hasStrongOnsetNear', () => {
    const mockOnsets: OnsetEvent[] = [
      { timeSec: 0.5, strength: 0.8 },
      { timeSec: 1.0, strength: 0.2 }, // Weak onset
    ]

    it('returns true for strong onset nearby', () => {
      const result = hasStrongOnsetNear(mockOnsets, 0.52, 0.05, 0.3)
      expect(result).toBe(true)
    })

    it('returns false for weak onset nearby', () => {
      const result = hasStrongOnsetNear(mockOnsets, 1.02, 0.05, 0.3)
      expect(result).toBe(false)
    })

    it('returns false when no onset nearby', () => {
      const result = hasStrongOnsetNear(mockOnsets, 0.7, 0.05, 0.3)
      expect(result).toBe(false)
    })

    it('uses default parameters', () => {
      // Default: maxDistance=0.03, minStrength=0.3
      const close = hasStrongOnsetNear(mockOnsets, 0.52) // 0.02 away from 0.5
      const far = hasStrongOnsetNear(mockOnsets, 0.55) // 0.05 away from 0.5

      expect(close).toBe(true)
      expect(far).toBe(false)
    })
  })
})
