import { describe, it, expect } from 'vitest'
import { hasUsablePcmData } from './pcmCapture'

describe('pcmCapture', () => {
  describe('hasUsablePcmData', () => {
    it('accepts non-empty PCM with a sample rate', () => {
      expect(hasUsablePcmData({ pcmData: new Float32Array(128), pcmSampleRate: 48000 })).toBe(true)
    })

    it('treats an empty PCM buffer as missing', () => {
      expect(hasUsablePcmData({ pcmData: new Float32Array(0), pcmSampleRate: 48000 })).toBe(false)
    })

    it('treats missing data or sample rate as missing', () => {
      expect(hasUsablePcmData({})).toBe(false)
      expect(hasUsablePcmData({ pcmData: new Float32Array(128) })).toBe(false)
      expect(hasUsablePcmData({ pcmSampleRate: 48000 })).toBe(false)
      expect(hasUsablePcmData({ pcmData: new Float32Array(128), pcmSampleRate: 0 })).toBe(false)
    })
  })
})
