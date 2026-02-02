import { describe, it, expect } from 'vitest'
import {
  midiToFrequency,
  noteNameToMidi,
  midiToNoteName,
  noteToPitchClass,
  chordNotesToMidi,
} from './noteUtils'

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

    it('handles edge cases with enharmonic equivalents', () => {
      // B# is enharmonically C of the NEXT octave
      expect(noteNameToMidi('B#4')).toBe(72) // B#4 = C5 = MIDI 72
      // Cb is enharmonically B of the PREVIOUS octave
      expect(noteNameToMidi('Cb4')).toBe(59) // Cb4 = B3 = MIDI 59
      // E# is enharmonically F (same octave)
      expect(noteNameToMidi('E#4')).toBe(65) // E#4 = F4 = MIDI 65
      // Fb is enharmonically E (same octave)
      expect(noteNameToMidi('Fb4')).toBe(64) // Fb4 = E4 = MIDI 64
    })

    it('handles double sharps', () => {
      expect(noteNameToMidi('C##4')).toBe(62) // C##4 = D4 = MIDI 62
      expect(noteNameToMidi('F##4')).toBe(67) // F##4 = G4 = MIDI 67
      expect(noteNameToMidi('G##4')).toBe(69) // G##4 = A4 = MIDI 69
    })

    it('handles double flats', () => {
      expect(noteNameToMidi('Dbb4')).toBe(60) // Dbb4 = C4 = MIDI 60
      expect(noteNameToMidi('Ebb4')).toBe(62) // Ebb4 = D4 = MIDI 62
      expect(noteNameToMidi('Bbb4')).toBe(69) // Bbb4 = A4 = MIDI 69
    })

    it('handles x notation for double sharp', () => {
      expect(noteNameToMidi('Cx4')).toBe(62) // Cx4 = D4 = MIDI 62
      expect(noteNameToMidi('Fx4')).toBe(67) // Fx4 = G4 = MIDI 67
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

  describe('noteToPitchClass', () => {
    it('converts natural notes to pitch classes', () => {
      expect(noteToPitchClass('C')).toBe(0)
      expect(noteToPitchClass('D')).toBe(2)
      expect(noteToPitchClass('E')).toBe(4)
      expect(noteToPitchClass('F')).toBe(5)
      expect(noteToPitchClass('G')).toBe(7)
      expect(noteToPitchClass('A')).toBe(9)
      expect(noteToPitchClass('B')).toBe(11)
    })

    it('converts sharps to pitch classes', () => {
      expect(noteToPitchClass('C#')).toBe(1)
      expect(noteToPitchClass('D#')).toBe(3)
      expect(noteToPitchClass('F#')).toBe(6)
      expect(noteToPitchClass('G#')).toBe(8)
      expect(noteToPitchClass('A#')).toBe(10)
    })

    it('converts flats to pitch classes (normalized to sharps)', () => {
      expect(noteToPitchClass('Db')).toBe(1) // Same as C#
      expect(noteToPitchClass('Eb')).toBe(3) // Same as D#
      expect(noteToPitchClass('Gb')).toBe(6) // Same as F#
      expect(noteToPitchClass('Ab')).toBe(8) // Same as G#
      expect(noteToPitchClass('Bb')).toBe(10) // Same as A#
    })

    it('handles edge case flats', () => {
      expect(noteToPitchClass('Fb')).toBe(4) // Same as E
      expect(noteToPitchClass('Cb')).toBe(11) // Same as B
    })

    it('handles edge case sharps', () => {
      expect(noteToPitchClass('E#')).toBe(5) // Same as F
      expect(noteToPitchClass('B#')).toBe(0) // Same as C
    })

    it('handles double sharps', () => {
      expect(noteToPitchClass('C##')).toBe(2) // Same as D
      expect(noteToPitchClass('F##')).toBe(7) // Same as G
      expect(noteToPitchClass('G##')).toBe(9) // Same as A
    })

    it('handles double flats', () => {
      expect(noteToPitchClass('Dbb')).toBe(0) // Same as C
      expect(noteToPitchClass('Ebb')).toBe(2) // Same as D
      expect(noteToPitchClass('Bbb')).toBe(9) // Same as A
    })

    it('handles x notation for double sharp', () => {
      expect(noteToPitchClass('Cx')).toBe(2) // Same as D
      expect(noteToPitchClass('Fx')).toBe(7) // Same as G
    })

    it('returns 0 for unknown notes', () => {
      expect(noteToPitchClass('X')).toBe(0)
      expect(noteToPitchClass('')).toBe(0)
    })
  })

  describe('chordNotesToMidi', () => {
    it('returns empty array for empty input', () => {
      expect(chordNotesToMidi([])).toEqual([])
    })

    it('voices C major triad at octave 4 (C-F roots use baseOctave+1)', () => {
      // C has pitch class 0 (≤5), so it uses baseOctave+1 = octave 4
      const result = chordNotesToMidi(['C', 'E', 'G'], 3)
      expect(result).toEqual([60, 64, 67]) // C4, E4, G4
    })

    it('voices G major triad at octave 3 (G-B roots use baseOctave)', () => {
      // G has pitch class 7 (>5), so it uses baseOctave = octave 3
      const result = chordNotesToMidi(['G', 'B', 'D'], 3)
      expect(result).toEqual([55, 59, 62]) // G3, B3, D4
    })

    it('voices A minor triad at octave 3', () => {
      // A has pitch class 9 (>5), so it uses baseOctave = octave 3
      const result = chordNotesToMidi(['A', 'C', 'E'], 3)
      expect(result).toEqual([57, 60, 64]) // A3, C4, E4
    })

    it('voices B minor 7th chord at octave 3', () => {
      // B has pitch class 11 (>5), so it uses baseOctave = octave 3
      const result = chordNotesToMidi(['B', 'D', 'F#', 'A'], 3)
      expect(result).toEqual([59, 62, 66, 69]) // B3, D4, F#4, A4
    })

    it('voices F major triad at octave 4 (F is pitch class 5, ≤5)', () => {
      // F has pitch class 5 (≤5), so it uses baseOctave+1 = octave 4
      const result = chordNotesToMidi(['F', 'A', 'C'], 3)
      expect(result).toEqual([65, 69, 72]) // F4, A4, C5
    })

    it('voices F# major triad at octave 3 (F# is pitch class 6, >5)', () => {
      // F# has pitch class 6 (>5), so it uses baseOctave = octave 3
      const result = chordNotesToMidi(['F#', 'A#', 'C#'], 3)
      expect(result).toEqual([54, 58, 61]) // F#3, A#3, C#4
    })

    it('keeps all chord roots within a similar MIDI range', () => {
      // Test that all roots fall within roughly an octave (MIDI 54-65)
      const cRoot = chordNotesToMidi(['C', 'E', 'G'], 3)[0] // Should be C4 = 60
      const fRoot = chordNotesToMidi(['F', 'A', 'C'], 3)[0] // Should be F4 = 65
      const fSharpRoot = chordNotesToMidi(['F#', 'A#', 'C#'], 3)[0] // Should be F#3 = 54
      const bRoot = chordNotesToMidi(['B', 'D#', 'F#'], 3)[0] // Should be B3 = 59

      // All roots should be between F#3 (54) and F4 (65)
      expect(cRoot).toBeGreaterThanOrEqual(54)
      expect(cRoot).toBeLessThanOrEqual(65)
      expect(fRoot).toBeGreaterThanOrEqual(54)
      expect(fRoot).toBeLessThanOrEqual(65)
      expect(fSharpRoot).toBeGreaterThanOrEqual(54)
      expect(fSharpRoot).toBeLessThanOrEqual(65)
      expect(bRoot).toBeGreaterThanOrEqual(54)
      expect(bRoot).toBeLessThanOrEqual(65)
    })

    it('handles flats in chord tones', () => {
      // Bb major: Bb, D, F - Bb has pitch class 10 (>5), uses baseOctave
      const result = chordNotesToMidi(['Bb', 'D', 'F'], 3)
      expect(result).toEqual([58, 62, 65]) // Bb3, D4, F4
    })

    it('calculates correct intervals for 7th chords', () => {
      // Cmaj7: C, E, G, B - intervals should be 0, 4, 7, 11
      const result = chordNotesToMidi(['C', 'E', 'G', 'B'], 3)
      const root = result[0]
      expect(result[1] - root).toBe(4) // Major third
      expect(result[2] - root).toBe(7) // Perfect fifth
      expect(result[3] - root).toBe(11) // Major seventh
    })

    it('respects different base octaves', () => {
      // With baseOctave 2, C should be at octave 3
      const resultOctave2 = chordNotesToMidi(['C', 'E', 'G'], 2)
      expect(resultOctave2).toEqual([48, 52, 55]) // C3, E3, G3

      // With baseOctave 4, C should be at octave 5
      const resultOctave4 = chordNotesToMidi(['C', 'E', 'G'], 4)
      expect(resultOctave4).toEqual([72, 76, 79]) // C5, E5, G5
    })
  })
})
