import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TONE,
  GUITAR_SAMPLES,
  KNOB_RANGES,
  driveToGain,
  makeupGain,
  nearestSample,
  playbackRate,
  sanitizeTone,
  tubeCurve,
} from './guitarTone'

describe('sanitizeTone', () => {
  it('returns the defaults for missing or broken input', () => {
    expect(sanitizeTone(null)).toEqual(DEFAULT_TONE)
    expect(sanitizeTone(undefined)).toEqual(DEFAULT_TONE)
    expect(sanitizeTone('nope' as never)).toEqual(DEFAULT_TONE)
  })

  it('keeps every default inside its usable range', () => {
    for (const [knob, r] of Object.entries(KNOB_RANGES)) {
      const v = DEFAULT_TONE[knob as keyof typeof KNOB_RANGES]
      expect(v).toBeGreaterThanOrEqual(r.min)
      expect(v).toBeLessThanOrEqual(r.max)
    }
  })

  it('clamps knobs to their usable range', () => {
    const t = sanitizeTone({ drive: 10, bass: 0, treble: 99, room: -3 })
    expect(t.drive).toBe(KNOB_RANGES.drive.max)
    expect(t.bass).toBe(KNOB_RANGES.bass.min)
    expect(t.treble).toBe(KNOB_RANGES.treble.max)
    expect(t.room).toBe(KNOB_RANGES.room.min)
  })

  it('ignores invalid pickups and non-numeric knobs', () => {
    const t = sanitizeTone({ pickup: 7 as never, mid: NaN, presence: '5' as never, amp: false })
    expect(t.pickup).toBe(DEFAULT_TONE.pickup)
    expect(t.mid).toBe(DEFAULT_TONE.mid)
    expect(t.presence).toBe(DEFAULT_TONE.presence)
    expect(t.amp).toBe(false)
  })
})

describe('nearestSample', () => {
  const recorded = Object.keys(GUITAR_SAMPLES).map(Number)

  it('uses the exact sample when there is one', () => {
    expect(nearestSample(40, recorded)).toBe(40)
  })

  it('picks the closest recording and prefers the lower one on ties', () => {
    expect(nearestSample(41, recorded)).toBe(40)
    expect(nearestSample(43, recorded)).toBe(42)
    // 46.5 is not a note, but 46 is 1 from 45 and 2 from 48
    expect(nearestSample(46, recorded)).toBe(45)
  })

  it('never repitches a guitar-range note by more than 1.5 semitones', () => {
    for (let midi = 38; midi <= 86; midi++) {
      expect(Math.abs(midi - nearestSample(midi, recorded)!)).toBeLessThanOrEqual(2)
    }
    for (let midi = 40; midi <= 84; midi++) {
      expect(Math.abs(midi - nearestSample(midi, recorded)!)).toBeLessThanOrEqual(1)
    }
  })

  it('returns null when nothing is loaded', () => {
    expect(nearestSample(60, [])).toBeNull()
  })
})

describe('amp math', () => {
  it('shifts by equal-tempered semitones', () => {
    expect(playbackRate(60, 60)).toBe(1)
    expect(playbackRate(72, 60)).toBeCloseTo(2)
    expect(playbackRate(61, 60)).toBeCloseTo(1.0595, 4)
  })

  it('makes drive add gain while the makeup trim pulls level back', () => {
    expect(driveToGain(0)).toBe(1)
    expect(driveToGain(5)).toBeGreaterThan(driveToGain(2))
    expect(makeupGain(driveToGain(5))).toBeLessThan(makeupGain(driveToGain(2)))
  })

  it('builds a tube curve that passes through zero and stays bounded', () => {
    const c = tubeCurve(5, 0.22, 4097)
    expect(c[2048]).toBeCloseTo(0, 6)
    for (const v of c) expect(Math.abs(v)).toBeLessThan(2)
    // Asymmetric: the two halves clip at different levels
    expect(Math.abs(c[0])).not.toBeCloseTo(Math.abs(c[4096]), 2)
  })
})
