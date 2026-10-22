import { describe, it, expect } from 'vitest'
import {
  limitPolyphony,
  groupIntoPhrases,
  absorbWobbleNotes,
  mergeConsecutiveSamePitch,
  smartMergeNotes,
  concatenatePitchBends,
  hasSignificantPitchBend,
  filterIsolatedNoiseNotes,
  suppressOvertones,
  DEFAULT_MAX_POLYPHONY,
  DEFAULT_MERGE_TIME_THRESHOLD,
  ISOLATED_NOTE_THRESHOLD,
  ISOLATED_NOTE_MIN_VELOCITY,
  SIGNIFICANT_BEND_THRESHOLD,
  PITCH_BEND_BINS_PER_SEMITONE,
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

    // Basic Pitch bends are integer contour bins of 1/3 semitone
    it('uses a half-semitone threshold expressed in contour bins', () => {
      expect(PITCH_BEND_BINS_PER_SEMITONE).toBe(3)
      expect(SIGNIFICANT_BEND_THRESHOLD).toBe(1.5)
    })

    it('returns false for small pitch bends (one bin = 1/3 semitone)', () => {
      const note = createNote(0, 1, 60, 0.5, [0, 1, -1, 0])
      expect(hasSignificantPitchBend(note)).toBe(false)
    })

    it('returns true for significant pitch bend (2 bins = 2/3 semitone)', () => {
      const note = createNote(0, 1, 60, 0.5, [0, 2, 1])
      expect(hasSignificantPitchBend(note)).toBe(true)
    })

    it('returns true for negative significant pitch bend', () => {
      const note = createNote(0, 1, 60, 0.5, [0, -2, -1])
      expect(hasSignificantPitchBend(note)).toBe(true)
    })

    it('uses custom threshold', () => {
      const note = createNote(0, 1, 60, 0.5, [1])
      expect(hasSignificantPitchBend(note, 0.5)).toBe(true)
      expect(hasSignificantPitchBend(note, 1.5)).toBe(false)
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
      expect(result.some((n) => n.midi === 71)).toBe(false)
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
      const notes = [createNote(0, 0.5, 60), createNote(0.5, 1, 61)]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(2)
    })

    it('absorbs wobble pattern (A-B-A where B is ±1 semitone)', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5), // C
        createNote(0.5, 0.6, 61, 0.5), // C# (wobble - short, ±1 semitone)
        createNote(0.6, 1, 60, 0.5), // C
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
        createNote(0, 0.5, 60, 0.5), // C
        createNote(0.5, 0.6, 63, 0.5), // D# (3 semitones - not wobble)
        createNote(0.6, 1, 60, 0.5), // C
      ]
      const result = absorbWobbleNotes(notes, 1) // 1 semitone threshold
      expect(result.length).toBe(3)
    })

    it('does not absorb if outer pitches differ', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5), // C
        createNote(0.5, 0.6, 61, 0.5), // C#
        createNote(0.6, 1, 62, 0.5), // D (different from first note)
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(3)
    })

    it('preserves intentional pitch bends', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5),
        createNote(0.5, 0.6, 61, 0.5, [0, 2, 3]), // Has significant pitch bend (bins)
        createNote(0.6, 1, 60, 0.5),
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(3) // Not absorbed due to pitch bend
    })

    it('concatenates pitch bends when absorbing', () => {
      const notes = [
        createNote(0, 0.5, 60, 0.5, [0]),
        createNote(0.5, 0.6, 61, 0.5, [1]), // small bend (1 bin), will be absorbed
        createNote(0.6, 1, 60, 0.5, [-1]),
      ]
      const result = absorbWobbleNotes(notes)
      expect(result.length).toBe(1)
      expect(result[0].pitchBend).toEqual([0, 1, -1])
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
      const notes = [createNote(0, 1, 60, 0.5, [0.1, 0.2]), createNote(1, 2, 60, 0.5, [0.3])]
      const result = mergeConsecutiveSamePitch(notes)
      expect(result[0].pitchBend).toEqual([0.1, 0.2, 0.3])
    })
  })

  describe('filterIsolatedNoiseNotes', () => {
    it('returns empty array for empty input', () => {
      expect(filterIsolatedNoiseNotes([])).toEqual([])
    })

    it('returns single note unchanged', () => {
      // Single notes are always kept (no comparison possible)
      const notes = [createNote(0, 1, 60, 0.3)]
      const result = filterIsolatedNoiseNotes(notes)
      expect(result.length).toBe(1)
    })

    it('keeps notes with neighbors regardless of velocity', () => {
      // Notes close together (within threshold) are kept even with low velocity
      const notes = [
        createNote(0, 0.5, 60, 0.3), // Low velocity but has neighbor
        createNote(0.4, 1, 62, 0.3), // Low velocity but has neighbor
      ]
      const result = filterIsolatedNoiseNotes(notes, 0.3, 0.45)
      expect(result.length).toBe(2)
    })

    it('filters isolated notes with low velocity', () => {
      // Isolated weak note should be filtered
      const notes = [
        createNote(0, 0.5, 60, 0.6), // Strong note
        createNote(2, 2.5, 62, 0.3), // Weak isolated note (1.5s gap)
        createNote(4, 4.5, 64, 0.6), // Strong note
      ]
      const result = filterIsolatedNoiseNotes(notes, 0.3, 0.45)
      expect(result.length).toBe(2)
      expect(result.some((n) => n.midi === 62)).toBe(false)
    })

    it('keeps isolated notes with high velocity', () => {
      // Isolated strong note should be kept
      const notes = [
        createNote(0, 0.5, 60, 0.6),
        createNote(2, 2.5, 62, 0.5), // Strong isolated note
        createNote(4, 4.5, 64, 0.6),
      ]
      const result = filterIsolatedNoiseNotes(notes, 0.3, 0.45)
      expect(result.length).toBe(3)
    })

    it('uses default thresholds', () => {
      expect(ISOLATED_NOTE_THRESHOLD).toBe(0.3)
      expect(ISOLATED_NOTE_MIN_VELOCITY).toBe(0.45)
    })

    it('considers overlapping notes as neighbors', () => {
      // Overlapping notes should count as having neighbors
      const notes = [
        createNote(0, 1, 60, 0.6),
        createNote(0.5, 1.5, 62, 0.3), // Low velocity but overlaps with first
      ]
      const result = filterIsolatedNoiseNotes(notes, 0.3, 0.45)
      expect(result.length).toBe(2)
    })

    it('considers notes ending near each other as neighbors', () => {
      // Notes that end near each other should count as neighbors
      const notes = [
        createNote(0, 1, 60, 0.6),
        createNote(0.8, 1.1, 62, 0.3), // Low velocity but ends near first
      ]
      const result = filterIsolatedNoiseNotes(notes, 0.3, 0.45)
      expect(result.length).toBe(2)
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

  describe('suppressOvertones', () => {
    it('drops the 5th-harmonic G# of a ringing low E', () => {
      const lowE = createNote(0, 2, 40, 0.9)
      const ghostGSharp = createNote(0.02, 1.5, 68, 0.4) // E2 + 28 semitones
      expect(suppressOvertones([lowE, ghostGSharp])).toEqual([lowE])
    })

    it.each([12, 19, 24, 28])(
      'drops a quieter note %i semitones above a louder one',
      (interval) => {
        const fundamental = createNote(0, 1, 45, 0.8)
        const overtone = createNote(0.03, 0.9, 45 + interval, 0.5)
        expect(suppressOvertones([fundamental, overtone])).toEqual([fundamental])
      }
    )

    it('drops an overtone that appears while the louder note is still ringing', () => {
      const fundamental = createNote(0, 2, 45, 0.8)
      const overtone = createNote(0.5, 1.8, 57, 0.4)
      expect(suppressOvertones([fundamental, overtone])).toEqual([fundamental])
    })

    it('keeps notes at non-harmonic intervals', () => {
      const root = createNote(0, 1, 40, 0.9)
      const fifth = createNote(0, 1, 47, 0.3) // power-chord fifth (7 semitones)
      const tenth = createNote(0, 1, 56, 0.3) // 16 semitones
      expect(suppressOvertones([root, fifth, tenth])).toHaveLength(3)
    })

    it('keeps an upper note that is about as loud as the lower one', () => {
      // Octave shape: both strings picked
      const low = createNote(0, 1, 45, 0.7)
      const high = createNote(0, 1, 57, 0.6) // 0.6 >= 0.8 × 0.7
      expect(suppressOvertones([low, high])).toHaveLength(2)
    })

    it('keeps an upper note that starts after the lower note has ended', () => {
      const low = createNote(0, 0.5, 45, 0.9)
      const high = createNote(0.6, 1, 57, 0.3)
      expect(suppressOvertones([low, high])).toHaveLength(2)
    })

    it('keeps an upper note that clearly outlasts the lower note', () => {
      // A melody note played over a short low note is not a harmonic of it
      const low = createNote(0, 0.5, 45, 0.9)
      const melody = createNote(0.02, 2, 57, 0.4)
      expect(suppressOvertones([low, melody])).toHaveLength(2)
    })

    it('never drops the lower (louder) note', () => {
      const low = createNote(0, 1, 40, 0.3)
      const high = createNote(0, 1, 52, 0.9)
      expect(suppressOvertones([low, high])).toEqual([low, high])
    })

    it('returns empty and single-note input unchanged', () => {
      expect(suppressOvertones([])).toEqual([])
      const single = [createNote(0, 1, 60)]
      expect(suppressOvertones(single)).toBe(single)
    })
  })
})
