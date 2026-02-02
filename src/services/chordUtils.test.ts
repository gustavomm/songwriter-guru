import { describe, it, expect } from 'vitest'
import { getChordTones, getIntervalsForQuality, transposeNote } from './chordUtils'

describe('chordUtils', () => {
  describe('getIntervalsForQuality', () => {
    it('returns major triad intervals for all major variants', () => {
      const majorIntervals = [0, 4, 7]
      expect(getIntervalsForQuality('')).toEqual(majorIntervals)
      expect(getIntervalsForQuality('M')).toEqual(majorIntervals)
      expect(getIntervalsForQuality('maj')).toEqual(majorIntervals)
    })

    it('returns minor triad intervals for all minor variants', () => {
      const minorIntervals = [0, 3, 7]
      expect(getIntervalsForQuality('m')).toEqual(minorIntervals)
      expect(getIntervalsForQuality('min')).toEqual(minorIntervals)
    })

    it('returns seventh chord intervals', () => {
      expect(getIntervalsForQuality('7')).toEqual([0, 4, 7, 10]) // Dominant 7
      expect(getIntervalsForQuality('maj7')).toEqual([0, 4, 7, 11]) // Major 7
      expect(getIntervalsForQuality('M7')).toEqual([0, 4, 7, 11]) // Major 7
      expect(getIntervalsForQuality('m7')).toEqual([0, 3, 7, 10]) // Minor 7
      expect(getIntervalsForQuality('min7')).toEqual([0, 3, 7, 10]) // Minor 7
    })

    it('returns diminished, augmented, and suspended intervals', () => {
      // Diminished
      expect(getIntervalsForQuality('dim')).toEqual([0, 3, 6])
      expect(getIntervalsForQuality('°')).toEqual([0, 3, 6])
      // Half-diminished
      expect(getIntervalsForQuality('m7b5')).toEqual([0, 3, 6, 10])
      expect(getIntervalsForQuality('ø7')).toEqual([0, 3, 6, 10])
      expect(getIntervalsForQuality('ø')).toEqual([0, 3, 6, 10])
      // Augmented
      expect(getIntervalsForQuality('aug')).toEqual([0, 4, 8])
      expect(getIntervalsForQuality('+')).toEqual([0, 4, 8])
      // Suspended
      expect(getIntervalsForQuality('sus4')).toEqual([0, 5, 7])
      expect(getIntervalsForQuality('sus2')).toEqual([0, 2, 7])
    })

    it('defaults to major triad for unknown quality', () => {
      expect(getIntervalsForQuality('unknown')).toEqual([0, 4, 7])
      expect(getIntervalsForQuality('xyz')).toEqual([0, 4, 7])
    })
  })

  describe('transposeNote', () => {
    it('transposes notes by semitones', () => {
      expect(transposeNote('C', 0)).toBe('C')
      expect(transposeNote('C', 1)).toBe('C#')
      expect(transposeNote('C', 4)).toBe('E')
      expect(transposeNote('C', 7)).toBe('G')
      expect(transposeNote('C', 12)).toBe('C')
    })

    it('handles sharps correctly', () => {
      expect(transposeNote('F#', 0)).toBe('F#')
      expect(transposeNote('F#', 1)).toBe('G')
      expect(transposeNote('F#', 2)).toBe('G#')
    })

    it('converts flats to sharps and transposes', () => {
      expect(transposeNote('Db', 0)).toBe('C#')
      expect(transposeNote('Bb', 0)).toBe('A#')
      expect(transposeNote('Bb', 2)).toBe('C')
      expect(transposeNote('Eb', 4)).toBe('G')
    })

    it('handles wrapping around the chromatic scale', () => {
      expect(transposeNote('B', 1)).toBe('C')
      expect(transposeNote('A#', 2)).toBe('C')
    })

    it('returns original note for invalid input', () => {
      expect(transposeNote('X', 5)).toBe('X')
      expect(transposeNote('', 5)).toBe('')
    })
  })

  describe('getChordTones', () => {
    it('returns correct tones for major and minor triads', () => {
      expect(getChordTones('C')).toEqual(['C', 'E', 'G'])
      expect(getChordTones('Am')).toEqual(['A', 'C', 'E'])
      expect(getChordTones('F#m')).toEqual(['F#', 'A', 'C#'])
    })

    it('returns correct tones for seventh chords', () => {
      expect(getChordTones('G7')).toEqual(['G', 'B', 'D', 'F'])
      expect(getChordTones('Cmaj7')).toEqual(['C', 'E', 'G', 'B'])
      expect(getChordTones('Dm7')).toEqual(['D', 'F', 'A', 'C'])
    })

    it('returns correct tones for altered chords', () => {
      expect(getChordTones('Bdim')).toEqual(['B', 'D', 'F'])
      expect(getChordTones('Caug')).toEqual(['C', 'E', 'G#'])
      expect(getChordTones('Dsus4')).toEqual(['D', 'G', 'A'])
    })

    it('handles flats (normalized to sharps)', () => {
      expect(getChordTones('Bb')).toEqual(['A#', 'D', 'F'])
    })

    it('returns fallback C major for invalid input', () => {
      expect(getChordTones('invalid')).toEqual(['C', 'E', 'G'])
    })
  })
})
