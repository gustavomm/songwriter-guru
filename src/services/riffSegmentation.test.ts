import { describe, it, expect } from 'vitest'
import {
  segmentRiff,
  estimateTiming,
  analyseSegment,
  metricStrength,
  METRIC_WEIGHTS,
  FALLBACK_BAR_SEC,
} from './riffSegmentation'
import { extractFeatures } from './featureExtraction'
import type { TranscribedNote } from '../domain/types'

const BPM = 100
const BEAT = 60 / BPM
const BAR = BEAT * 4

/**
 * Build a riff from bars of [midi, beats] pairs played back to back, each bar
 * starting on its downbeat. `offset` shifts the whole riff in time.
 */
function buildBars(
  bars: [number, number][][],
  { offset = 0, jitter = () => 0 }: { offset?: number; jitter?: (i: number) => number } = {}
): TranscribedNote[] {
  const notes: TranscribedNote[] = []
  bars.forEach((bar, b) => {
    let beat = 0
    for (const [midi, beats] of bar) {
      const start = offset + b * BAR + beat * BEAT + jitter(notes.length)
      notes.push({ startSec: start, endSec: start + beats * BEAT * 0.9, midi, velocity: 0.8 })
      beat += beats
    }
  })
  return notes
}

// A 100 bpm riff mixing quarters and eighths, four bars
const RIFF_100_BARS: [number, number][][] = [
  [
    [45, 1],
    [48, 0.5],
    [52, 0.5],
    [48, 1],
    [52, 1],
  ],
  [
    [41, 1],
    [45, 0.5],
    [48, 0.5],
    [45, 1],
    [48, 1],
  ],
  [
    [43, 1],
    [47, 0.5],
    [50, 0.5],
    [47, 1],
    [50, 1],
  ],
  [
    [45, 1],
    [48, 0.5],
    [52, 0.5],
    [57, 2],
  ],
]
const RIFF_100 = buildBars(RIFF_100_BARS)

describe('riffSegmentation', () => {
  describe('estimateTiming', () => {
    it('finds 100 bpm in a riff of quarters and eighths', () => {
      const timing = estimateTiming(RIFF_100)
      expect(timing.source).toBe('tempo')
      expect(timing.bpm).toBeGreaterThanOrEqual(98)
      expect(timing.bpm).toBeLessThanOrEqual(102)
      expect(timing.barSec).toBeCloseTo(BAR, 1)
      expect(timing.downbeatSec).toBeCloseTo(0, 1)
      expect(timing.confidence).toBeGreaterThan(0.6)
    })

    it('copes with human timing jitter and a late start', () => {
      // Deterministic ±20 ms jitter, riff starting at 0.37 s
      const jitter = (i: number) => (((i * 7919) % 41) - 20) / 1000
      const timing = estimateTiming(buildBars(RIFF_100_BARS, { offset: 0.37, jitter }))
      expect(timing.source).toBe('tempo')
      expect(timing.bpm).toBeGreaterThanOrEqual(97)
      expect(timing.bpm).toBeLessThanOrEqual(103)
      expect(timing.downbeatSec).toBeCloseTo(0.37, 1)
    })

    it('falls back to ~2 s bars when the onsets have no steady beat', () => {
      // Irregular onsets (golden-ratio spacing never lines up with a grid)
      const notes: TranscribedNote[] = []
      let t = 0
      for (let i = 0; i < 14; i++) {
        notes.push({ startSec: t, endSec: t + 0.2, midi: 52 + (i % 5), velocity: 0.7 })
        t += 0.25 + ((i * 0.618) % 1) * 0.5
      }
      const timing = estimateTiming(notes)
      expect(timing.source).toBe('fallback')
      expect(timing.bpm).toBeNull()
      expect(timing.barSec).toBeGreaterThan(FALLBACK_BAR_SEC * 0.6)
      expect(timing.barSec).toBeLessThan(FALLBACK_BAR_SEC * 1.5)
    })

    it('falls back for riffs with too few notes', () => {
      const notes = buildBars([
        [
          [45, 2],
          [48, 2],
        ],
      ])
      expect(estimateTiming(notes).source).toBe('fallback')
    })
  })

  describe('segmentRiff', () => {
    it('cuts the 100 bpm riff into its four bars', () => {
      const { bars, timing, noteCount } = segmentRiff(RIFF_100)
      expect(timing.source).toBe('tempo')
      expect(noteCount).toBe(RIFF_100.length)
      expect(bars.map((b) => b.bar)).toEqual([1, 2, 3, 4])
      bars.forEach((bar, i) => {
        expect(bar.startSec).toBeCloseTo(i * BAR, 1)
        expect(bar.endSec).toBeCloseTo((i + 1) * BAR, 1)
      })
      expect(bars.map((b) => b.noteCount)).toEqual([5, 5, 5, 4])
    })

    it('gives each bar its own pitch content and bass note', () => {
      const { bars } = segmentRiff(RIFF_100)
      // Bar 2 outlines F major (F A C)
      const bar2 = bars[1]
      expect(bar2.bassPc).toBe(5)
      expect(bar2.pcWeights[5] + bar2.pcWeights[9] + bar2.pcWeights[0]).toBeCloseTo(1, 5)
      expect(bar2.pcWeights[4]).toBe(0)
      // Weights sum to 1 in each bar
      for (const bar of bars) {
        expect(bar.pcWeights.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5)
      }
    })

    it('keeps a silent bar in the middle as an empty segment', () => {
      const notes = buildBars([
        [
          [45, 2],
          [48, 1],
          [52, 1],
        ],
        [
          [57, 1],
          [52, 1],
          [48, 1],
          [45, 1],
        ],
        [],
        [
          [45, 1],
          [48, 1],
          [52, 1],
          [45, 1],
        ],
      ])
      const { bars } = segmentRiff(notes)
      expect(bars).toHaveLength(4)
      expect(bars[2].noteCount).toBe(0)
    })

    it('pre-analyses both halves of bars with notes in each half', () => {
      const { bars } = segmentRiff(RIFF_100)
      const [first, second] = bars[0].halves!
      expect(first.half).toBe(1)
      expect(second.half).toBe(2)
      expect(first.endSec).toBeCloseTo(BAR / 2, 1)
      expect(first.noteCount + second.noteCount).toBe(bars[0].noteCount)
    })

    it('is attached to extracted features', () => {
      const features = extractFeatures(RIFF_100)
      expect(features.segmentation?.bars).toHaveLength(4)
    })

    it('returns no bars for an empty riff', () => {
      expect(segmentRiff([]).bars).toEqual([])
    })
  })

  describe('metric weighting', () => {
    const timing = { beatSec: BEAT, downbeatSec: 0, source: 'tempo' as const }

    it('ranks downbeat > beat 3 > other beats > offbeats', () => {
      expect(metricStrength(0)).toBe(METRIC_WEIGHTS.downbeat)
      expect(metricStrength(2)).toBe(METRIC_WEIGHTS.beat3)
      expect(metricStrength(1)).toBe(METRIC_WEIGHTS.beat)
      expect(metricStrength(3)).toBe(METRIC_WEIGHTS.beat)
      expect(metricStrength(1.5)).toBe(METRIC_WEIGHTS.offbeat)
      expect(metricStrength(1.25)).toBe(METRIC_WEIGHTS.other)
      expect(metricStrength(4)).toBe(METRIC_WEIGHTS.downbeat)
    })

    it('weights a downbeat note above the same note length on an offbeat', () => {
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: BEAT / 2, midi: 60, velocity: 0.8 }, // C on beat 1
        { startSec: BEAT * 1.5, endSec: BEAT * 2, midi: 62, velocity: 0.8 }, // D on the "and" of 2
      ]
      const segment = analyseSegment(notes, timing, 1, 0, 0, BAR)
      expect(segment.pcWeights[0]).toBeGreaterThan(segment.pcWeights[2])
      expect(segment.pcWeights[0] / segment.pcWeights[2]).toBeCloseTo(
        METRIC_WEIGHTS.downbeat / METRIC_WEIGHTS.offbeat,
        5
      )
    })

    it('marks strong-beat and sustained notes as strong, short offbeats not', () => {
      const notes: TranscribedNote[] = [
        { startSec: 0, endSec: BEAT / 2, midi: 60, velocity: 0.8 }, // beat 1
        { startSec: BEAT * 0.5, endSec: BEAT, midi: 62, velocity: 0.8 }, // offbeat, short
        { startSec: BEAT * 1.5, endSec: BEAT * 3, midi: 65, velocity: 0.8 }, // offbeat, sustained
      ]
      const segment = analyseSegment(notes, timing, 1, 0, 0, BAR)
      expect(segment.strongPcWeights[0]).toBeGreaterThan(0)
      expect(segment.strongPcWeights[2]).toBe(0)
      expect(segment.strongPcWeights[5]).toBeGreaterThan(0)
    })

    it('counts a note held over from the previous bar at reduced weight', () => {
      const notes: TranscribedNote[] = [
        { startSec: BAR - BEAT, endSec: BAR + BEAT, midi: 64, velocity: 0.8 }, // E tied over
        { startSec: BAR, endSec: BAR + BEAT, midi: 60, velocity: 0.8 }, // C on the downbeat
      ]
      const segment = analyseSegment(notes, timing, 2, 0, BAR, 2 * BAR)
      expect(segment.noteCount).toBe(1)
      expect(segment.pcWeights[4]).toBeGreaterThan(0)
      expect(segment.pcWeights[4]).toBeLessThan(segment.pcWeights[0])
    })
  })
})
