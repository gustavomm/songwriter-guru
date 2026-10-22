import { describe, it, expect } from 'vitest'
import { Note, Scale } from 'tonal'
import { harmonizeRiff, scoreSegmentFit, canHarmonize } from './riffHarmonizer'
import { generateChordSuggestions } from './chordSuggestion'
import { extractFeatures } from './featureExtraction'
import { analyseSegment } from './riffSegmentation'
import type {
  ChordSuggestion,
  HarmonicFieldCandidate,
  RiffHarmonization,
  TranscribedNote,
} from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const BPM = 100
const BEAT = 60 / BPM
const BAR = BEAT * 4

/**
 * Build a riff from bars of notes. Each bar is a list of [midi, beats] pairs
 * played back to back (beats = length in beats), starting on the downbeat.
 */
function buildBars(bars: [number, number][][], velocity = 0.8): TranscribedNote[] {
  const notes: TranscribedNote[] = []
  bars.forEach((bar, b) => {
    let beat = 0
    for (const [midi, beats] of bar) {
      const start = b * BAR + beat * BEAT
      notes.push({ startSec: start, endSec: start + beats * BEAT * 0.95, midi, velocity })
      beat += beats
    }
  })
  return notes
}

/** Four quarter notes per bar */
const quarters = (...midis: number[]): [number, number][] => midis.map((m) => [m, 1])

const fieldFor = (tonic: string, mode: string): HarmonicFieldCandidate => ({
  id: `${tonic}-${mode.toLowerCase()}`,
  tonic,
  mode,
  scaleNotes: Scale.get(`${tonic} ${mode.toLowerCase()}`).notes,
  fitScore: 1,
  outOfScale: [],
})

function harmonize(field: HarmonicFieldCandidate, notes: TranscribedNote[], weirdness: number) {
  const features = extractFeatures(notes)
  const chords = generateChordSuggestions(field, features)
  return harmonizeRiff(field, chords, features, weirdness)
}

const romans = (option: RiffHarmonization) => option.chords.map((c) => c.chord.roman)
const symbols = (option: RiffHarmonization) => option.chords.map((c) => c.chord.symbol)
const describeOption = (option: RiffHarmonization) =>
  option.chords.map((c) => `${c.chord.symbol}(${c.chord.roman})`).join(' ')

// C | F | G | C arpeggios in C major
const C_F_G_C = buildBars([
  quarters(48, 52, 55, 52),
  quarters(53, 57, 60, 57),
  quarters(55, 59, 62, 59),
  quarters(48, 52, 55, 60),
])

// Am | F | G | Am in A minor
const AM_F_G_AM = buildBars([
  quarters(45, 48, 52, 48),
  quarters(41, 45, 48, 45),
  quarters(43, 47, 50, 47),
  quarters(45, 48, 52, 57),
])

// An E minor rock riff using only E G A B D
const E_MINOR_ROCK = buildBars([
  [
    [40, 1],
    [43, 0.5],
    [40, 0.5],
    [47, 1],
    [43, 1],
  ],
  [
    [43, 1],
    [47, 0.5],
    [43, 0.5],
    [50, 1],
    [47, 1],
  ],
  [
    [45, 1],
    [52, 0.5],
    [45, 0.5],
    [50, 1],
    [52, 1],
  ],
  [
    [50, 1],
    [45, 0.5],
    [50, 0.5],
    [45, 1],
    [43, 1],
  ],
  [
    [40, 1],
    [47, 0.5],
    [43, 0.5],
    [40, 2],
  ],
])

const WEIRDNESS_STEPS = [0, 0.25, 0.5, 0.75, 1]

const cMajor = fieldFor('C', 'Major')
const aMinor = fieldFor('A', 'Minor')
const eMinor = fieldFor('E', 'Minor')

/** Chord suggestion by display symbol from the key's catalog */
function chordFor(field: HarmonicFieldCandidate, symbol: string): ChordSuggestion {
  const features = extractFeatures(C_F_G_C)
  const chord = [...generateChordSuggestions(field, features).byId.values()].find(
    (c) => c.symbol === symbol
  )
  if (!chord) throw new Error(`No ${symbol} in ${field.id}`)
  return chord
}

const timing = { beatSec: BEAT, downbeatSec: 0, source: 'tempo' as const }

const RIFFS = [
  [cMajor, C_F_G_C],
  [aMinor, AM_F_G_AM],
  [eMinor, E_MINOR_ROCK],
] as const

describe('riffHarmonizer', () => {
  describe('scoreSegmentFit', () => {
    const C = chordFor(cMajor, 'C')
    const F = chordFor(cMajor, 'F')

    // C E G arpeggio plus one sustained note on beat 3
    const withSustained = (midi: number) =>
      analyseSegment(
        [
          { startSec: 0, endSec: BEAT, midi: 48, velocity: 0.8 },
          { startSec: BEAT, endSec: 2 * BEAT, midi: 52, velocity: 0.8 },
          { startSec: 2 * BEAT, endSec: 4 * BEAT, midi, velocity: 0.8 },
          { startSec: 3 * BEAT, endSec: 4 * BEAT, midi: 55, velocity: 0.8 },
        ],
        timing,
        1,
        0,
        0,
        BAR
      )

    it('penalises an avoid note (F over C) more than another non-chord tone (D)', () => {
      const avoid = scoreSegmentFit(withSustained(65), C) // F: a semitone above E
      const passing = scoreSegmentFit(withSustained(62), C) // D: a whole step above C
      expect(avoid.chordToneShare).toBeCloseTo(passing.chordToneShare, 5)
      expect(avoid.score).toBeLessThan(passing.score - 0.1)
    })

    it('lets the avoid note pass when it is a short offbeat note', () => {
      const segment = (fStart: number, fLength: number) =>
        analyseSegment(
          [
            { startSec: 0, endSec: BEAT, midi: 48, velocity: 0.8 },
            { startSec: BEAT, endSec: 2 * BEAT, midi: 52, velocity: 0.8 },
            { startSec: fStart, endSec: fStart + fLength, midi: 65, velocity: 0.8 },
            { startSec: 3 * BEAT, endSec: 4 * BEAT, midi: 55, velocity: 0.8 },
          ],
          timing,
          1,
          0,
          0,
          BAR
        )
      const strong = scoreSegmentFit(segment(2 * BEAT, BEAT), C)
      const weak = scoreSegmentFit(segment(2.5 * BEAT, BEAT / 4), C)
      expect(weak.score).toBeGreaterThan(strong.score)
    })

    it('follows metric strength: the downbeat note decides between C and F', () => {
      // E and F of equal length; whichever sits on the downbeat wins
      const segment = (downbeatMidi: number, offbeatMidi: number) =>
        analyseSegment(
          [
            { startSec: 0, endSec: BEAT, midi: downbeatMidi, velocity: 0.8 },
            { startSec: 1.5 * BEAT, endSec: 2.5 * BEAT, midi: offbeatMidi, velocity: 0.8 },
          ],
          timing,
          1,
          0,
          0,
          BAR
        )
      const eFirst = segment(52, 53)
      const fFirst = segment(53, 52)
      expect(scoreSegmentFit(eFirst, C).score).toBeGreaterThan(scoreSegmentFit(eFirst, F).score)
      expect(scoreSegmentFit(fFirst, F).score).toBeGreaterThan(scoreSegmentFit(fFirst, C).score)
    })

    it('prefers the triad over the 7th chord when the 7th is never played', () => {
      const Cmaj7 = chordFor(cMajor, 'Cmaj7')
      const arpeggio = analyseSegment(C_F_G_C.slice(0, 4), timing, 1, 0, 0, BAR)
      expect(scoreSegmentFit(arpeggio, C).score).toBeGreaterThan(
        scoreSegmentFit(arpeggio, Cmaj7).score
      )
    })

    it('scores an empty segment as neutral', () => {
      const empty = analyseSegment([], timing, 1, 0, 0, BAR)
      expect(scoreSegmentFit(empty, C)).toMatchObject({ score: 0, chordToneShare: 0 })
    })
  })

  describe('harmonizeRiff', () => {
    it('harmonizes a C | F | G | C riff as I IV V I', () => {
      for (const w of [0, 0.5]) {
        const best = harmonize(cMajor, C_F_G_C, w)!.options[0]
        expect(romans(best), describeOption(best)).toEqual(['I', 'IV', 'V', 'I'])
        expect(best.chords.map((c) => c.bar)).toEqual([1, 2, 3, 4])
      }
    })

    it('harmonizes an Am | F | G | Am riff as i VI VII i', () => {
      for (const w of [0, 0.5]) {
        const best = harmonize(aMinor, AM_F_G_AM, w)!.options[0]
        expect(romans(best), describeOption(best)).toEqual(['i', 'VI', 'VII', 'i'])
        expect(symbols(best)).toEqual(['Am', 'F', 'G', 'Am'])
      }
    })

    it('gives an E minor rock riff rock-plausible chords and no C# at low weirdness', () => {
      const family = new Set(['E', 'G', 'D', 'C', 'A', 'B'].map((n) => Note.chroma(n)))
      const cSharp = Note.chroma('C#')
      for (const w of [0, 0.25]) {
        const result = harmonize(eMinor, E_MINOR_ROCK, w)!
        // The best option stays in the Em / G / D / C / A (+ B) family
        const best = result.options[0]
        for (const { chord } of best.chords) {
          expect(family.has(Note.chroma(chord.chordTones[0])), describeOption(best)).toBe(true)
        }
        expect(best.chords[0].chord.symbol).toMatch(/^Em/)
        expect(best.chords[best.chords.length - 1].chord.symbol).toMatch(/^Em/)
        // No option uses a chord containing C#
        for (const option of result.options) {
          for (const { chord } of option.chords) {
            const pcs = chord.chordTones.map((n) => Note.chroma(n))
            expect(pcs, describeOption(option)).not.toContain(cSharp)
          }
        }
      }
    })

    it('adds colour chords gradually as weirdness rises', () => {
      let totalAtOne = 0
      for (const [field, notes] of RIFFS) {
        const counts = WEIRDNESS_STEPS.map((w) => harmonize(field, notes, w)!.options[0].colorCount)
        expect(counts[0]).toBe(0)
        for (let i = 1; i < counts.length; i++) {
          expect(counts[i], `${field.id}: ${counts.join(',')}`).toBeGreaterThanOrEqual(
            counts[i - 1]
          )
        }
        totalAtOne += counts[counts.length - 1]
      }
      // Weirdness 1 does reach for colour
      expect(totalAtOne).toBeGreaterThan(0)
    })

    it('uses only plain diatonic chords at weirdness 0', () => {
      for (const [field, notes] of RIFFS) {
        for (const option of harmonize(field, notes, 0)!.options) {
          expect(option.colorCount, describeOption(option)).toBe(0)
        }
      }
    })

    it('uses at most one colour-variant tonic per option and resolves applied chords', () => {
      for (const [field, notes] of RIFFS) {
        const tonic = Note.chroma(field.tonic)
        for (const w of WEIRDNESS_STEPS) {
          for (const option of harmonize(field, notes, w)!.options) {
            const chords = option.chords.map((c) => c.chord)
            const colourTonics = new Set(
              chords
                .filter((c) => c.colorVariant && Note.chroma(c.chordTones[0]) === tonic)
                .map((c) => c.symbol)
            )
            expect(colourTonics.size, describeOption(option)).toBeLessThanOrEqual(1)
            chords.forEach((chord, i) => {
              if (!chord.resolvesToRoman) return
              // An applied chord is held or moves on, but never ends the riff
              const next = chords.slice(i + 1).find((c) => c.symbol !== chord.symbol)
              expect(next, describeOption(option)).toBeDefined()
            })
          }
        }
      }
    })

    it('returns the best option plus diverse alternatives with reasons and bar times', () => {
      const result = harmonize(cMajor, C_F_G_C, 0.5)!
      expect(result.timing.source).toBe('tempo')
      expect(result.options.length).toBeGreaterThanOrEqual(3)
      expect(result.options.length).toBeLessThanOrEqual(4)
      const keys = result.options.map((o) => symbols(o).join(' '))
      expect(new Set(keys).size).toBe(keys.length)

      const best = result.options[0]
      best.chords.forEach((c, i) => {
        expect(c.startSec).toBeCloseTo(i * BAR, 1)
        expect(c.endSec).toBeCloseTo((i + 1) * BAR, 1)
        expect(c.fit).toBeGreaterThan(0.9)
        expect(c.reason).toMatch(new RegExp(`^Bar ${i + 1}`))
      })
      expect(best.chords[1].reason).toBe('Bar 2: F in the bass, with A')
      expect(best.chords[3].reason).toContain('resolves home')
    })

    it('is deterministic', () => {
      const a = harmonize(eMinor, E_MINOR_ROCK, 0.75)
      const b = harmonize(eMinor, E_MINOR_ROCK, 0.75)
      expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    })

    it('needs at least two bars and a few notes', () => {
      const short = buildBars([quarters(48, 52, 55, 52)])
      expect(canHarmonize(extractFeatures(short))).toBe(false)
      expect(harmonize(cMajor, short, 0.5)).toBeNull()
      expect(canHarmonize(extractFeatures(C_F_G_C))).toBe(true)
    })

    it('splits a bar into halves only when it clearly holds two chords', () => {
      // Bar 2 plays F A for two beats, then G B for two beats
      const notes = buildBars([
        quarters(48, 52, 55, 52),
        quarters(53, 57, 55, 59),
        quarters(48, 52, 55, 60),
      ])
      const best = harmonize(cMajor, notes, 0)!.options[0]
      expect(symbols(best), describeOption(best)).toEqual(['C', 'F', 'G', 'C'])
      expect(best.chords.map((c) => [c.bar, c.half])).toEqual([
        [1, 0],
        [2, 1],
        [2, 2],
        [3, 0],
      ])
      // The C | F | G | C arpeggios stay one chord per bar
      const plain = harmonize(cMajor, C_F_G_C, 0)!.options[0]
      expect(plain.chords.every((c) => c.half === 0)).toBe(true)
    })
  })
})
