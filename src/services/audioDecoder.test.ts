import { describe, it, expect } from 'vitest'
import { computeSlidingRms } from './audioDecoder'

describe('audioDecoder', () => {
  describe('computeSlidingRms', () => {
    // Reference: recompute the centered window for every sample
    const naiveSlidingRms = (data: Float32Array, halfWindow: number): Float32Array => {
      const result = new Float32Array(data.length)
      for (let i = 0; i < data.length; i++) {
        const start = Math.max(0, i - halfWindow)
        const end = Math.min(data.length, i + halfWindow)
        let sumSquares = 0
        for (let j = start; j < end; j++) {
          sumSquares += data[j] * data[j]
        }
        result[i] = Math.sqrt(sumSquares / (end - start))
      }
      return result
    }

    it('returns an empty array for empty input', () => {
      expect(computeSlidingRms(new Float32Array(0), 10).length).toBe(0)
    })

    it('matches the per-sample window computation', () => {
      // Burst of loud signal surrounded by quiet noise, to exercise cancellation
      const data = new Float32Array(5000)
      let seed = 1
      for (let i = 0; i < data.length; i++) {
        seed = (seed * 16807) % 2147483647
        const noise = (seed / 2147483647 - 0.5) * 0.002
        const burst = i >= 1500 && i < 2500 ? 0.9 * Math.sin(i * 0.3) : 0
        data[i] = noise + burst
      }

      for (const halfWindow of [1, 7, 220]) {
        const fast = computeSlidingRms(data, halfWindow)
        const naive = naiveSlidingRms(data, halfWindow)
        for (let i = 0; i < data.length; i++) {
          expect(fast[i]).toBeCloseTo(naive[i], 5)
        }
      }
    })

    it('handles a window larger than the signal', () => {
      const data = new Float32Array([0.5, -0.5, 0.5])
      const fast = computeSlidingRms(data, 10)
      const naive = naiveSlidingRms(data, 10)
      for (let i = 0; i < data.length; i++) {
        expect(fast[i]).toBeCloseTo(naive[i], 6)
      }
    })
  })
})
