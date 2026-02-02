import { describe, it, expect } from 'vitest'
import {
  limitPolyphony,
  groupIntoPhrases,
  absorbWobbleNotes,
  mergeConsecutiveSamePitch,
  smartMergeNotes,
  concatenatePitchBends,
  hasSignificantPitchBend,
  DEFAULT_MAX_POLYPHONY,
  DEFAULT_MERGE_TIME_THRESHOLD,
} from './noteProcessing'
import type { TranscribedNote } from '../domain/types'

describe('noteProcessing', () => {
  // Helper to create notes
  const createNote = (
    startSec: number,
    endSec: number,
    midi: number,
    velocity: number = 0.5,
    pitchBend?: number[]
  ): TranscribedNote => ({
    startSec,
    endSec,
    midi,
    velocity,
    pitchBend,
  })

  describe('concatenatePitchBends', () => {
    it('returns undefined for notes without pitch bends', () => {
      const note1 = createNote(0, 1, 60)
      const note2 = createNote(1, 2, 60)
      expect(concatenatePitchBends(note1, note2)).toBeUndefined()
    })

    it('concatenates pitch bends from multiple notes', () => {
      const note1 = createNote(0, 1, 60, 0.5, [0.1, 0.2])
      const note2 = createNote(1, 2, 60, 0.5, [0.3, 0.4])
      const result = concatenatePitchBends(note1, note2)
      expect(result).toEqual([0.1, 0.2, 0.3, 0.4])
    })

    it('handles notes with only some having pitch bends', () => {
      const note1 = createNote(0, 1, 60, 0.5, [0.1, 0.2])
      const note2 = createNote(1, 2, 60)
      const note3 = createNote(2, 3, 60, 0.5, [0.3])
      const result = concatenatePitchBends(note1, note2, note3)
      expect(result).toEqual([0.1, 0.2, 0.3])
    })

    it('handles empty pitch bend arrays', () => {
      const note1 = createNote(0, 1, 60, 0.5, [])
      const note2 = createNote(1, 2, 60, 0.5, [0.1])
      const result = concatenatePitchBends(note1, note2)
      expect(result).toEqual([0.1])
    })
  })

  describe('hasSignificantPitchBend', () => {
    it('returns false for note without pitch bend', () => {
      const note = createNote(0, 1, 60)
      expect(hasSignificantPitchBend(note)).toBe(false)
    })

    it('returns false for empty pitch bend array', () => {
      const note = createNote(0, 1, 60, 0.5, [])
      expect(hasSignificantPitchBend(note)).toBe(false)
    })

    it('returns false for small pitch bends', () => {
      const note = createNote(0, 1, 60, 0.5, [0.1, 0.2, 0.15])
      expect(hasSignificantPitchBend(note)).toBe(false)
    })

    it('returns true for significant pitch bend', () => {
      const note = createNote(0, 1, 60, 0.5, [0.1, 0.5, 0.2]) // 0.5 > 0.3 threshold
      expect(hasSignificantPitchBend(note)).toBe(true)
    })

    it('returns true for negative significant pitch bend', () => {
      const note = createNote(0, 1, 60, 0.5, [0.1, -0.5, 0.2])
      expect(hasSignificantPitchBend(note)).toBe(true)
    })

    it('uses custom threshold', () => {
      const note = createNote(0, 1, 60, 0.5, [0.2])
      expect(hasSignificantPitchBend(note, 0.1)).toBe(true)
      expect(hasSignificantPitchBend(note, 0.3)).toBe(false)
    })
  })

  describe('limitPolyphony', () => {
    it('returns all notes when under polyphony limit', () => {
      const notes = [
        createNote(0, 1, 60, 0.5),
        createNote(0, 1, 64, 0.5),
        createNote(0, 1, 67, 0.5),
      ]
      const result = limitPolyphony(notes, 6)
      expect(result.length).toBe(3)
    })

    it('limits to max polyphony when exceeded', () => {
      // 8 overlapping notes
      const notes = [
        createNote(0, 1, 60, 0.8),
        createNote(0, 1, 62, 0.7),
        createNote(0, 1, 64, 0.6),
        createNote(0, 1, 65, 0.5),
        createNote(0, 1, 67, 0.4),
        createNote(0, 1, 69, 0.3),
        createNote(0, 1, 71, 0.2),
        createNote(0, 1, 72, 0.1),
      ]
      const result = limitPolyphony(notes, 6)
      expect(result.length).toBe(6)
    })

    it('keeps notes with highest amplitude', () => {
      // 7 overlapping notes, keep 6 highest amplitude
      const notes = [
        createNote(0, 1, 60, 0.9), // Keep
        createNote(0, 1, 62, 0.8), // Keep
        createNote(0, 1, 64, 0.7), // Keep
        createNote(0, 1, 65, 0.6), // Keep
        createNote(0, 1, 67, 0.5), // Keep
        createNote(0, 1, 69, 0.4), // Keep
        createNote(0, 1, 71, 0.1), // Drop (lowest amplitude)
      ]
      const result = limitPolyphony(notes, 6)
      expect(result.length).toBe(6)
      // Should not include the lowest amplitude note
      expect(result.some(n => n.midi === 71)).toBe(false)
    })

    it('allows notes that dont overlap', () => {
      // Sequential notes don't count towards polyphony
      const notes = [
        createNote(0, 1, 60, 0.5),
        createNote(1, 2, 62, 0.5),
        createNote(2, 3, 64, 0.5),
        createNote(3, 4, 65, 0.5),
        createNote(4, 5, 67, 0.5),
        createNote(5, 6, 69, 0.5),
        createNote(6, 7, 71, 0.5),
        createNote(7, 8, 72, 0.5),
      ]
      const result = limitPolyphony(notes, 6)
      expect(result.length).toBe(8) // All notes kept since none overlap
    })

    it('uses default max polyphony of 6', () => {
      expect(DEFAULT_MAX_POLYPHONY).toBe(6)
    })
  })

  describe('groupIntoPhrases', () => {
    it('returns empty array for empty input', () => {
      expect(groupIntoPhrases([])).toEqual([])
    })

    it('returns single phrase when notes are connected', () => {
      const notes = [
        createNote(0, 0.5, 60),
        createNote(0.5, 1, 62), // Immediately after
        createNote(1, 1.5, 64),
      ]
      const result = groupIntoPhrases(notes)
      expect(result.length).toBe(1)
      expect(result[0].length).toBe(3)
    })

    it('splits into phrases on gaps', () => {
      const notes = [
        createNote(0, 0.5, 60),
        createNote(0.5, 1, 62),
        // Gap > threshold
        createNote(2, 2.5, 64), // 1 second gap
        createNote(2.5, 3, 65),
      ]
      const result = groupIntoPhrases(notes, 0.5) // 0.5s threshold
      expect(result.length).toBe(2)
      expect(result[0].length).toBe(2)
      expect(result[1].length).toBe(2)
    })

    it('uses default threshold', () => {
      expect(DEFAULT_MERGE_TIME_THRESHOLD).toBe(0.15)
    })

    it('keeps overlapping notes in same phrase', () => {
      const notes = [
        createNote(0, 1, 60),
        createNote(0.5, 1.5, 62), // Overlaps
        createNote(1, 2, 64), // Overlaps
      ]
      const result = groupIntoPhrases(notes)
      expect(result.length).toBe(1)
    })
  })

  describe('absorbWobbleNotes', () => {
    it('returns empty array for empty input', () => {
      expect(absorbWobbleNotes([])).toEqual([])
    })

    it('returns single note unchanged', () => {
      const notes = [createNote(0, 1, 60)]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(1)
      expect(result[0].midi).toBe(60)
    })

    it('returns two notes unchanged', () => {
      const notes = [
        createNote(0, 0.5, 60),
        createNote(0.5, 1, 61),
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(2)
    })

    it('absorbs wobble pattern (A-B-A where B is ±1 semitone)', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5),      // C
        createNote(0.5, 0.6, 61, 0.5),    // C# (wobble - short, ±1 semitone)
        createNote(0.6, 1, 60, 0.5),      // C
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(1)
      expect(result[0].midi).toBe(60)
      expect(result[0].startSec).toBe(0)
      expect(result[0].endSec).toBe(1)
    })

    it('does not absorb if middle note is too long', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5),
        createNote(0.5, 1, 61, 0.5), // 0.5s > 0.2s threshold - not a wobble
        createNote(1, 1.5, 60, 0.5),
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(3)
    })

    it('does not absorb if pitch difference is too large', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5),      // C
        createNote(0.5, 0.6, 63, 0.5),    // D# (3 semitones - not wobble)
        createNote(0.6, 1, 60, 0.5),      // C
      ]
      const result = absorbWobbleNotes(notes, 1) // 1 semitone threshold
      expect(result.length).toBe(3)
    })

    it('does not absorb if outer pitches differ', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5),      // C
        createNote(0.5, 0.6, 61, 0.5),    // C#
        createNote(0.6, 1, 62, 0.5),      // D (different from first note)
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(3)
    })

    it('preserves intentional pitch bends', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5),
        createNote(0.5, 0.6, 61, 0.5, [0.5]), // Has significant pitch bend
        createNote(0.6, 1, 60, 0.5),
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(3) // Not absorbed due to pitch bend
    })

    it('concatenates pitch bends when absorbing', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5, [0.1]),
        createNote(0.5, 0.6, 61, 0.5, [0.15]), // small bend, will be absorbed
        createNote(0.6, 1, 60, 0.5, [0.2]),
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(1)
      expect(result[0].pitchBend).toEqual([0.1, 0.15, 0.2])
    })
  })

  describe('mergeConsecutiveSamePitch', () => {
    it('returns empty array for empty input', () => {
      expect(mergeConsecutiveSamePitch([])).toEqual([])
    })

    it('returns single note unchanged', () => {
      const notes = [createNote(0, 1, 60)]
      const result = mergeConsecutiveSamePitch(notes)
      expect(result.length).toBe(1)
    })

    it('merges consecutive same-pitch notes', () => {
      const notes = [
        createNote(0, 1, 60, 0.6),
        createNote(1, 2, 60, 0.4), // Same pitch, close together
      ]
      const result = mergeConsecutiveSamePitch(notes)
      expect(result.length).toBe(1)
      expect(result[0].startSec).toBe(0)
      expect(result[0].endSec).toBe(2)
      expect(result[0].velocity).toBeCloseTo(0.5) // Average of 0.6 and 0.4
    })

    it('does not merge different pitches', () => {
      const notes = [
        createNote(0, 1, 60),
        createNote(1, 2, 62), // Different pitch
      ]
      const result = mergeConsecutiveSamePitch(notes)
      expect(result.length).toBe(2)
    })

    it('does not merge if gap is too large', () => {
      const notes = [
        createNote(0, 1, 60),
        createNote(2, 3, 60), // Same pitch but 1 second gap
      ]
      const result = mergeConsecutiveSamePitch(notes, 0.5)
      expect(result.length).toBe(2)
    })

    it('merges overlapping same-pitch notes', () => {
      const notes = [
        createNote(0, 1.5, 60),
        createNote(1, 2, 60), // Overlaps
      ]
      const result = mergeConsecutiveSamePitch(notes)
      expect(result.length).toBe(1)
      expect(result[0].endSec).toBe(2)
    })

    it('concatenates pitch bends when merging', () => {
      const notes = [
        createNote(0, 1, 60, 0.5, [0.1, 0.2]),
        createNote(1, 2, 60, 0.5, [0.3]),
      ]
      const result = mergeConsecutiveSamePitch(notes)
      expect(result[0].pitchBend).toEqual([0.1, 0.2, 0.3])
    })
  })

  describe('smartMergeNotes', () => {
    it('returns empty array for empty input', () => {
      expect(smartMergeNotes([])).toEqual([])
    })

    it('handles single note', () => {
      const notes = [createNote(0, 1, 60)]
      const result = smartMergeNotes(notes)
      expect(result.length).toBe(1)
    })

    it('combines phrase grouping and cleaning', () => {
      // First phrase with wobble
      // Second phrase after gap
      const notes = [
        createNote(0, 0.5, 60, 0.5),
        createNote(0.5, 0.6, 61, 0.5), // Wobble
        createNote(0.6, 1, 60, 0.5),
        // Gap
        createNote(2, 3, 64, 0.5), // New phrase
      ]
      const result = smartMergeNotes(notes)
      
      // Should have 2 notes: merged first phrase + second phrase
      expect(result.length).toBe(2)
      expect(result[0].midi).toBe(60)
      expect(result[1].midi).toBe(64)
    })

    it('preserves intentional rests between phrases', () => {
      const notes = [
        createNote(0, 1, 60),
        // 0.5 second rest
        createNote(1.5, 2.5, 62),
        // 0.5 second rest
        createNote(3, 4, 64),
      ]
      const result = smartMergeNotes(notes, 0.3) // 0.3s threshold
      expect(result.length).toBe(3) // All three phrases preserved
    })

    it('merges repeated notes within a phrase', () => {
      const notes = [
        createNote(0, 0.5, 60),
        createNote(0.55, 1, 60), // Same pitch, small gap
        createNote(1.05, 1.5, 60), // Same pitch, small gap
      ]
      const result = smartMergeNotes(notes)
      expect(result.length).toBe(1)
      expect(result[0].endSec).toBe(1.5)
    })
  })
})
