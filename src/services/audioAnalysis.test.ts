import { describe, it, expect } from 'vitest'
import {
  analyzeAudio,
  linearToDbfs,
  dbfsToLinear,
  calculateNormalizationGain,
  applyGain,
  normalizeAudio,
} from './audioAnalysis'

describe('audioAnalysis', () => {
  // Helper to create simple sine wave audio data
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

  // Helper to create noise
  const createNoise = (
    amplitude: number,
    durationMs: number,
    sampleRate: number = 22050
  ): Float32Array => {
    const numSamples = Math.round((durationMs / 1000) * sampleRate)
    const data = new Float32Array(numSamples)
    for (let i = 0; i < numSamples; i++) {
      data[i] = amplitude * (Math.random() * 2 - 1)
    }
    return data
  }

  describe('linearToDbfs', () => {
    it('returns 0 dBFS for full scale (1.0)', () => {
      expect(linearToDbfs(1.0)).toBe(0)
    })

    it('returns -6 dBFS for half amplitude', () => {
      // -6.02 dB for 0.5
      expect(linearToDbfs(0.5)).toBeCloseTo(-6.02, 1)
    })

    it('returns -20 dBFS for 0.1 amplitude', () => {
      expect(linearToDbfs(0.1)).toBeCloseTo(-20, 0)
    })

    it('returns -Infinity for zero', () => {
      expect(linearToDbfs(0)).toBe(-Infinity)
    })

    it('returns -Infinity for negative values', () => {
      expect(linearToDbfs(-0.5)).toBe(-Infinity)
    })
  })

  describe('dbfsToLinear', () => {
    it('returns 1.0 for 0 dBFS', () => {
      expect(dbfsToLinear(0)).toBe(1)
    })

    it('returns ~0.5 for -6 dBFS', () => {
      expect(dbfsToLinear(-6)).toBeCloseTo(0.5, 1)
    })

    it('returns 0.1 for -20 dBFS', () => {
      expect(dbfsToLinear(-20)).toBeCloseTo(0.1, 2)
    })

    it('returns 0 for -Infinity', () => {
      expect(dbfsToLinear(-Infinity)).toBe(0)
    })

    it('is inverse of linearToDbfs', () => {
      const testValues = [0.1, 0.25, 0.5, 0.75, 1.0]
      for (const val of testValues) {
        const db = linearToDbfs(val)
        const back = dbfsToLinear(db)
        expect(back).toBeCloseTo(val, 5)
      }
    })
  })

  describe('analyzeAudio', () => {
    it('returns -Infinity for empty audio', () => {
      const metrics = analyzeAudio(new Float32Array(0), 22050)
      expect(metrics.peakLevelDb).toBe(-Infinity)
      expect(metrics.rmsLevelDb).toBe(-Infinity)
      expect(metrics.peakLinear).toBe(0)
      expect(metrics.rmsLinear).toBe(0)
    })

    it('calculates correct peak level for sine wave', () => {
      const audio = createSineWave(440, 0.5, 500)
      const metrics = analyzeAudio(audio, 22050)
      // Peak should be close to 0.5 (some samples might not hit exact peak)
      expect(metrics.peakLinear).toBeCloseTo(0.5, 1)
      expect(metrics.peakLevelDb).toBeCloseTo(-6, 1)
    })

    it('calculates correct RMS level for sine wave', () => {
      const audio = createSineWave(440, 1.0, 500)
      const metrics = analyzeAudio(audio, 22050)
      // RMS of sine wave is amplitude / sqrt(2) ≈ 0.707
      expect(metrics.rmsLinear).toBeCloseTo(0.707, 1)
    })

    it('detects transients in audio with attacks', () => {
      // Create audio with sudden attacks
      // Use longer silence periods to ensure clean frame boundaries
      // (ANALYSIS_FRAME_SIZE is 2048 samples ≈ 93ms at 22050Hz)
      const sampleRate = 22050
      const silence = createSilence(200, sampleRate) // 200ms silence
      const tone = createSineWave(440, 0.8, 300, sampleRate) // 300ms tone

      // Combine: silence -> tone -> silence -> tone -> silence
      const combined = new Float32Array(silence.length * 3 + tone.length * 2)
      combined.set(silence, 0)
      combined.set(tone, silence.length)
      combined.set(silence, silence.length + tone.length)
      combined.set(tone, silence.length * 2 + tone.length)
      combined.set(silence, silence.length * 2 + tone.length * 2)

      const metrics = analyzeAudio(combined, sampleRate)
      expect(metrics.hasTransients).toBe(true)
    })

    it('detects no transients in constant signal', () => {
      const audio = createSineWave(440, 0.5, 1000)
      const metrics = analyzeAudio(audio, 22050)
      expect(metrics.hasTransients).toBe(false)
    })

    it('estimates noise floor from quietest frames', () => {
      // Create audio with varying levels
      const sampleRate = 22050
      const quiet = createNoise(0.01, 200, sampleRate) // Very quiet
      const loud = createSineWave(440, 0.8, 800, sampleRate) // Loud

      const combined = new Float32Array(quiet.length + loud.length)
      combined.set(quiet, 0)
      combined.set(loud, quiet.length)

      const metrics = analyzeAudio(combined, sampleRate)
      // Noise floor should be estimated from the quiet section
      expect(metrics.noiseFloorDb).toBeLessThan(-30)
    })

    it('calculates dynamic range', () => {
      const audio = createSineWave(440, 0.5, 500)
      const metrics = analyzeAudio(audio, 22050)
      // Dynamic range = peak dB - RMS dB
      const expectedDR = metrics.peakLevelDb - metrics.rmsLevelDb
      expect(metrics.dynamicRangeDb).toBeCloseTo(expectedDR, 1)
    })
  })

  describe('calculateNormalizationGain', () => {
    it('returns gain to reach target level', () => {
      // If current peak is -10 dBFS and target is -3 dBFS
      // Need +7 dB gain
      const gain = calculateNormalizationGain(-10, -3)
      const expectedGain = dbfsToLinear(7)
      expect(gain).toBeCloseTo(expectedGain, 3)
    })

    it('returns 1 for silence (no amplification)', () => {
      const gain = calculateNormalizationGain(-Infinity, -3)
      expect(gain).toBe(1)
    })

    it('limits maximum gain to prevent over-amplification', () => {
      // Very quiet signal at -60 dBFS, target -3 dBFS
      // Would need +57 dB but should be limited to +24 dB
      const gain = calculateNormalizationGain(-60, -3)
      const maxGain = dbfsToLinear(24)
      expect(gain).toBeCloseTo(maxGain, 3)
    })

    it('returns less than 1 for signals above target', () => {
      // Signal at -1 dBFS, target -3 dBFS
      // Need -2 dB gain (attenuation)
      const gain = calculateNormalizationGain(-1, -3)
      expect(gain).toBeLessThan(1)
    })
  })

  describe('applyGain', () => {
    it('multiplies all samples by gain', () => {
      const audio = new Float32Array([0.1, 0.2, 0.3, 0.4, 0.5])
      applyGain(audio, 2, false)
      expect(audio[0]).toBeCloseTo(0.2, 5)
      expect(audio[1]).toBeCloseTo(0.4, 5)
      expect(audio[2]).toBeCloseTo(0.6, 5)
    })

    it('applies soft clipping when enabled', () => {
      const audio = new Float32Array([0.5, 0.8, 0.96, 1.0])
      applyGain(audio, 1.5, true)
      // Should soft clip values above 0.95
      expect(audio[0]).toBeCloseTo(0.75, 2)
      expect(audio[3]).toBeLessThan(1.5) // Would be 1.5 without clipping
    })

    it('modifies array in place', () => {
      const audio = new Float32Array([0.5])
      const original = audio
      applyGain(audio, 2, false)
      expect(audio).toBe(original)
      expect(audio[0]).toBeCloseTo(1.0, 5)
    })
  })

  describe('normalizeAudio', () => {
    it('normalizes to target peak level', () => {
      const audio = createSineWave(440, 0.25, 100) // -12 dBFS peak
      normalizeAudio(audio, -3) // Target -3 dBFS

      // Find new peak
      let peak = 0
      for (let i = 0; i < audio.length; i++) {
        const abs = Math.abs(audio[i])
        if (abs > peak) peak = abs
      }

      // Should be close to -3 dBFS = 0.708
      expect(peak).toBeCloseTo(0.708, 1)
    })

    it('returns the gain that was applied', () => {
      const audio = createSineWave(440, 0.5, 100) // -6 dBFS peak
      const gain = normalizeAudio(audio, -3) // Target -3 dBFS

      // Should have applied ~+3 dB gain
      expect(gain).toBeGreaterThan(1)
      expect(gain).toBeLessThan(2)
    })

    it('returns 1 when no normalization needed', () => {
      const audio = createSineWave(440, 0.708, 100) // Already at -3 dBFS
      const gain = normalizeAudio(audio, -3)
      expect(gain).toBeCloseTo(1, 1)
    })
  })
})
