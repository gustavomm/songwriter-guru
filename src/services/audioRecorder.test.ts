import { describe, it, expect } from 'vitest'
import { formatTime } from './audioRecorder'

describe('audioRecorder', () => {
  describe('formatTime', () => {
    it('formats zero and sub-second values as 00:00', () => {
      expect(formatTime(0)).toBe('00:00')
      expect(formatTime(500)).toBe('00:00')
      expect(formatTime(999)).toBe('00:00')
    })

    it('formats seconds with zero-padding', () => {
      expect(formatTime(1000)).toBe('00:01')
      expect(formatTime(5000)).toBe('00:05')
      expect(formatTime(15000)).toBe('00:15')
      expect(formatTime(59000)).toBe('00:59')
    })

    it('formats minutes and seconds combined', () => {
      expect(formatTime(60000)).toBe('01:00')
      expect(formatTime(61000)).toBe('01:01')
      expect(formatTime(90000)).toBe('01:30')
      expect(formatTime(185000)).toBe('03:05')
      expect(formatTime(600000)).toBe('10:00')
    })

    it('floors partial seconds', () => {
      expect(formatTime(1500)).toBe('00:01')
      expect(formatTime(1999)).toBe('00:01')
      expect(formatTime(61500)).toBe('01:01')
    })
  })
})
