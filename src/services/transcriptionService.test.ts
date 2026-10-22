import { describe, it, expect } from 'vitest'
import { calculateAdaptiveThresholds } from './transcriptionService'
import type { AudioMetrics } from './audioAnalysis'

describe('transcriptionService', () => {
  describe('calculateAdaptiveThresholds', () => {
    const createMetrics = (rmsLevelDb: number, noiseFloorDb: number): AudioMetrics => ({
      peakLevelDb: rmsLevelDb + 10,
      rmsLevelDb,
      noiseFloorDb,
      dynamicRangeDb: 10,
      hasTransients: false,
      peakLinear: Math.pow(10, (rmsLevelDb + 10) / 20),
      rmsLinear: Math.pow(10, rmsLevelDb / 20),
    })

    const clean = createMetrics(-20, -60) // 40 dB SNR
    const noisy = createMetrics(-20, -28) // 8 dB SNR

    it('raises onset and frame thresholds as SNR falls', () => {
      const cleanT = calculateAdaptiveThresholds(clean, 'lead')
      const noisyT = calculateAdaptiveThresholds(noisy, 'lead')

      expect(noisyT.onsetThreshold).toBeGreaterThan(cleanT.onsetThreshold)
      expect(noisyT.frameThreshold).toBeGreaterThan(cleanT.frameThreshold)
    })

    it('uses base thresholds for clean signals', () => {
      const t = calculateAdaptiveThresholds(clean, 'lead')
      expect(t.onsetThreshold).toBeCloseTo(0.5)
      expect(t.frameThreshold).toBeCloseTo(0.35)
      expect(t.minNoteLength).toBe(11)
    })

    it('keeps thresholds within their clamps', () => {
      const veryNoisy = calculateAdaptiveThresholds(createMetrics(-20, -20), 'chord')
      expect(veryNoisy.onsetThreshold).toBeLessThanOrEqual(0.7)
      expect(veryNoisy.frameThreshold).toBeLessThanOrEqual(0.5)
    })

    it('grows min note length by at most 2 frames with noise', () => {
      const cleanT = calculateAdaptiveThresholds(clean, 'lead')
      const veryNoisyT = calculateAdaptiveThresholds(createMetrics(-20, -20), 'lead')
      expect(veryNoisyT.minNoteLength - cleanT.minNoteLength).toBeGreaterThan(0)
      expect(veryNoisyT.minNoteLength - cleanT.minNoteLength).toBeLessThanOrEqual(2)
    })

    it('keeps chord preset boosts', () => {
      const lead = calculateAdaptiveThresholds(clean, 'lead')
      const chord = calculateAdaptiveThresholds(clean, 'chord')
      expect(chord.onsetThreshold).toBeGreaterThan(lead.onsetThreshold)
      expect(chord.frameThreshold).toBeGreaterThan(lead.frameThreshold)
      expect(chord.minNoteLength).toBe(lead.minNoteLength + 2)
    })
  })
})
