import { describe, it, expect } from 'vitest'
import { midiToFrequency, noteNameToMidi, midiToNoteName } from './noteUtils'

describe('noteUtils', () => {
  describe('midiToFrequency', () => {
    it('converts A4 (MIDI 69) to 440 Hz', () => {
      expect(midiToFrequency(69)).toBe(440)
    })

    it('converts middle C (MIDI 60) to ~261.63 Hz', () => {
      expect(midiToFrequency(60)).toBeCloseTo(261.63, 1)
    })

    it('doubles frequency for each octave up', () => {
      const a4 = midiToFrequency(69)
      const a5 = midiToFrequency(81) // A5 = 12 semitones above A4
      expect(a5).toBeCloseTo(a4 * 2, 2)
    })

    it('halves frequency for each octave down', () => {
      const a4 = midiToFrequency(69)
      const a3 = midiToFrequency(57) // A3 = 12 semitones below A4
      expect(a3).toBeCloseTo(a4 / 2, 2)
    })

    it('handles low MIDI values', () => {
      // MIDI 21 = A0 = ~27.5 Hz
      expect(midiToFrequency(21)).toBeCloseTo(27.5, 1)
    })

    it('handles high MIDI values', () => {
      // MIDI 108 = C8 = ~4186 Hz
      expect(midiToFrequency(108)).toBeCloseTo(4186, 0)
    })

    it('increases by factor of 2^(1/12) per semitone', () => {
      const c4 = midiToFrequency(60)
      const cSharp4 = midiToFrequency(61)
      const ratio = cSharp4 / c4
      expect(ratio).toBeCloseTo(Math.pow(2, 1 / 12), 5)
    })
  })

  describe('noteNameToMidi', () => {
    it('converts C4 to MIDI 60', () => {
      expect(noteNameToMidi('C4')).toBe(60)
    })

    it('converts A4 to MIDI 69', () => {
      expect(noteNameToMidi('A4')).toBe(69)
    })

    it('converts C0 to MIDI 12', () => {
      expect(noteNameToMidi('C0')).toBe(12)
    })

    it('handles sharps', () => {
      expect(noteNameToMidi('C#4')).toBe(61)
      expect(noteNameToMidi('F#4')).toBe(66)
      expect(noteNameToMidi('G#3')).toBe(56)
    })

    it('handles flats', () => {
      expect(noteNameToMidi('Db4')).toBe(61) // Same as C#4
      expect(noteNameToMidi('Bb3')).toBe(58) // Same as A#3
      expect(noteNameToMidi('Eb4')).toBe(63) // Same as D#4
    })

    it('handles enharmonic equivalents', () => {
      expect(noteNameToMidi('C#4')).toBe(noteNameToMidi('Db4'))
      expect(noteNameToMidi('D#4')).toBe(noteNameToMidi('Eb4'))
      expect(noteNameToMidi('F#4')).toBe(noteNameToMidi('Gb4'))
    })

    it('handles lowercase note names', () => {
      expect(noteNameToMidi('c4')).toBe(60)
      expect(noteNameToMidi('a4')).toBe(69)
    })

    it('defaults to octave 4 when not specified', () => {
      expect(noteNameToMidi('C')).toBe(60)
      expect(noteNameToMidi('A')).toBe(69)
      expect(noteNameToMidi('G#')).toBe(68)
    })

    it('returns 60 (middle C) for invalid input', () => {
      expect(noteNameToMidi('invalid')).toBe(60)
      expect(noteNameToMidi('')).toBe(60)
      expect(noteNameToMidi('X5')).toBe(60)
    })

    it('handles edge cases', () => {
      // Note: B# and Cb are treated simply - no octave adjustment
      // The implementation uses a simple lookup table approach
      expect(noteNameToMidi('B#4')).toBe(60) // B# maps to pitch class 0, octave 4 = MIDI 60
      expect(noteNameToMidi('Cb4')).toBe(71) // Cb maps to pitch class 11 (B), octave 4 = MIDI 71
      expect(noteNameToMidi('E#4')).toBe(65) // E# = F4
      expect(noteNameToMidi('Fb4')).toBe(64) // Fb = E4
    })
  })

  describe('midiToNoteName', () => {
    it('converts MIDI 60 to C4', () => {
      expect(midiToNoteName(60)).toBe('C4')
    })

    it('converts MIDI 69 to A4', () => {
      expect(midiToNoteName(69)).toBe('A4')
    })

    it('converts MIDI 61 to C#4', () => {
      expect(midiToNoteName(61)).toBe('C#4')
    })

    it('handles all chromatic notes', () => {
      expect(midiToNoteName(60)).toBe('C4')
      expect(midiToNoteName(61)).toBe('C#4')
      expect(midiToNoteName(62)).toBe('D4')
      expect(midiToNoteName(63)).toBe('D#4')
      expect(midiToNoteName(64)).toBe('E4')
      expect(midiToNoteName(65)).toBe('F4')
      expect(midiToNoteName(66)).toBe('F#4')
      expect(midiToNoteName(67)).toBe('G4')
      expect(midiToNoteName(68)).toBe('G#4')
      expect(midiToNoteName(69)).toBe('A4')
      expect(midiToNoteName(70)).toBe('A#4')
      expect(midiToNoteName(71)).toBe('B4')
      expect(midiToNoteName(72)).toBe('C5')
    })

    it('handles different octaves', () => {
      expect(midiToNoteName(24)).toBe('C1')
      expect(midiToNoteName(36)).toBe('C2')
      expect(midiToNoteName(48)).toBe('C3')
      expect(midiToNoteName(72)).toBe('C5')
      expect(midiToNoteName(84)).toBe('C6')
    })

    it('handles low MIDI values', () => {
      expect(midiToNoteName(21)).toBe('A0')
      expect(midiToNoteName(12)).toBe('C0')
    })

    it('handles high MIDI values', () => {
      expect(midiToNoteName(108)).toBe('C8')
      expect(midiToNoteName(127)).toBe('G9')
    })
  })

  describe('round-trip conversions', () => {
    it('noteNameToMidi -> midiToNoteName preserves natural notes', () => {
      const notes = ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']
      for (const note of notes) {
        const midi = noteNameToMidi(note)
        const backToNote = midiToNoteName(midi)
        expect(backToNote).toBe(note)
      }
    })

    it('noteNameToMidi -> midiToNoteName preserves sharps', () => {
      const notes = ['C#4', 'D#4', 'F#4', 'G#4', 'A#4']
      for (const note of notes) {
        const midi = noteNameToMidi(note)
        const backToNote = midiToNoteName(midi)
        expect(backToNote).toBe(note)
      }
    })

    it('noteNameToMidi converts flats to sharps via round-trip', () => {
      // Flats become sharps because midiToNoteName uses sharps
      expect(midiToNoteName(noteNameToMidi('Db4'))).toBe('C#4')
      expect(midiToNoteName(noteNameToMidi('Eb4'))).toBe('D#4')
      expect(midiToNoteName(noteNameToMidi('Gb4'))).toBe('F#4')
      expect(midiToNoteName(noteNameToMidi('Ab4'))).toBe('G#4')
      expect(midiToNoteName(noteNameToMidi('Bb4'))).toBe('A#4')
    })

    it('midiToFrequency and back approximates correctly', () => {
      const midi = 69 // A4
      const freq = midiToFrequency(midi)
      // Convert frequency back to MIDI using the formula: 69 + 12 * log2(f/440)
      const backToMidi = 69 + 12 * Math.log2(freq / 440)
      expect(backToMidi).toBeCloseTo(midi, 5)
    })
  })
})
