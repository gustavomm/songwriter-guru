import { describe, it, expect } from 'vitest'
import {
  buildPositions,
  chordIntervalLabel,
  diatonicChords,
  intervalToDegreeLabel,
  mapFretboard,
  normalizeRiffWeights,
  STANDARD_TUNING,
} from './fretboard'
import type { PitchClassWeights } from '../domain/types'

const A_MINOR = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const F_MAJOR = ['F', 'G', 'A', 'Bb', 'C', 'D', 'E']

describe('buildPositions', () => {
  it('creates one position per string and fret, including open strings', () => {
    const positions = buildPositions(12)
    expect(positions).toHaveLength(6 * 13)
  })

  it('uses standard tuning with the low E first', () => {
    const positions = buildPositions(0)
    expect(positions.map((p) => p.midi)).toEqual([...STANDARD_TUNING])
    expect(positions.map((p) => p.pc)).toEqual([4, 9, 2, 7, 11, 4])
  })

  it('computes the midi note for fretted positions', () => {
    const fifthFretLowE = buildPositions(5).find((p) => p.string === 0 && p.fret === 5)
    expect(fifthFretLowE?.midi).toBe(45) // A2
    expect(fifthFretLowE?.pc).toBe(9)
  })
})

describe('intervalToDegreeLabel', () => {
  it.each([
    ['1P', '1'],
    ['2M', '2'],
    ['3m', 'b3'],
    ['3M', '3'],
    ['4P', '4'],
    ['4A', '#4'],
    ['5d', 'b5'],
    ['5P', '5'],
    ['6m', 'b6'],
    ['7m', 'b7'],
    ['7M', '7'],
    ['7d', 'bb7'],
    ['9M', '2'],
  ])('maps %s to %s', (interval, label) => {
    expect(intervalToDegreeLabel(interval)).toBe(label)
  })

  it('returns an empty string for invalid intervals', () => {
    expect(intervalToDegreeLabel('nope')).toBe('')
  })
})

describe('chordIntervalLabel', () => {
  it('labels the root as R', () => {
    expect(chordIntervalLabel('E', 'E')).toBe('R')
  })

  it('labels dominant seventh tones', () => {
    expect(['E', 'G#', 'B', 'D'].map((t) => chordIntervalLabel('E', t))).toEqual([
      'R',
      '3',
      '5',
      'b7',
    ])
  })

  it('labels half-diminished tones', () => {
    expect(['B', 'D', 'F', 'A'].map((t) => chordIntervalLabel('B', t))).toEqual([
      'R',
      'b3',
      'b5',
      'b7',
    ])
  })
})

describe('normalizeRiffWeights', () => {
  it('scales weights so the max is 1', () => {
    const weights = [0, 0, 0, 0, 0, 0, 0, 0, 0, 4, 0, 2] as PitchClassWeights
    const result = normalizeRiffWeights(weights)
    expect(result[9]).toBe(1)
    expect(result[11]).toBe(0.5)
  })

  it('returns zeros for missing or empty weights', () => {
    expect(normalizeRiffWeights(null)).toEqual(new Array(12).fill(0))
    expect(normalizeRiffWeights(new Array(12).fill(0))).toEqual(new Array(12).fill(0))
  })
})

describe('mapFretboard', () => {
  it('only returns scale notes when there is no chord or riff', () => {
    const notes = mapFretboard({ scaleNotes: A_MINOR, fretCount: 12 })
    expect(notes.every((n) => n.inScale)).toBe(true)
    // 7 of 12 pitch classes, across 6 strings x 13 frets
    expect(notes.length).toBeGreaterThan(40)
    expect(notes.find((n) => n.string === 0 && n.fret === 2)).toBeUndefined() // F# is not
  })

  it('assigns degrees and intervals relative to the tonic', () => {
    const notes = mapFretboard({ scaleNotes: A_MINOR, fretCount: 12 })
    const lowA = notes.find((n) => n.string === 0 && n.fret === 5)
    expect(lowA).toMatchObject({ name: 'A', degree: 1, interval: '1' })
    const openG = notes.find((n) => n.string === 3 && n.fret === 0)
    expect(openG).toMatchObject({ name: 'G', degree: 7, interval: 'b7' })
    const c = notes.find((n) => n.string === 1 && n.fret === 3)
    expect(c).toMatchObject({ name: 'C', degree: 3, interval: 'b3' })
  })

  it('spells notes from the scale, so flat keys show flats', () => {
    const notes = mapFretboard({ scaleNotes: F_MAJOR, fretCount: 12 })
    const bFlat = notes.find((n) => n.string === 1 && n.fret === 1)
    expect(bFlat).toMatchObject({ name: 'Bb', degree: 4, interval: '4' })
  })

  it('marks chord tones with intervals from the chord root', () => {
    const notes = mapFretboard({
      scaleNotes: A_MINOR,
      chordTones: ['E', 'G#', 'B', 'D'],
      fretCount: 12,
    })
    const gSharp = notes.find((n) => n.string === 3 && n.fret === 1)
    expect(gSharp).toMatchObject({
      name: 'G#',
      inScale: false,
      isChordTone: true,
      chordInterval: '3',
      interval: '7',
    })
    const openE = notes.find((n) => n.string === 5 && n.fret === 0)
    expect(openE).toMatchObject({ isChordTone: true, chordInterval: 'R', degree: 5 })
    const openA = notes.find((n) => n.string === 1 && n.fret === 0)
    expect(openA).toMatchObject({ isChordTone: false, inScale: true, chordInterval: '4' })
  })

  it('includes riff notes, even outside the scale, with their weight', () => {
    const weights = new Array(12).fill(0) as PitchClassWeights
    weights[9] = 10 // A
    weights[3] = 5 // D#, outside A minor
    const notes = mapFretboard({ scaleNotes: A_MINOR, riffWeights: weights, fretCount: 12 })
    const dSharp = notes.find((n) => n.string === 2 && n.fret === 1)
    expect(dSharp).toMatchObject({ name: 'D#', inScale: false, riffWeight: 0.5, interval: '#4' })
    const a = notes.find((n) => n.string === 0 && n.fret === 5)
    expect(a?.riffWeight).toBe(1)
    const b = notes.find((n) => n.string === 0 && n.fret === 7)
    expect(b?.riffWeight).toBe(0)
  })

  it('spells out-of-scale riff notes with flats in flat keys', () => {
    const weights = new Array(12).fill(0) as PitchClassWeights
    weights[8] = 1 // G#/Ab, outside F major
    const notes = mapFretboard({ scaleNotes: F_MAJOR, riffWeights: weights, fretCount: 5 })
    const ab = notes.find((n) => n.pc === 8)
    expect(ab?.name).toBe('Ab')
    expect(ab?.interval).toBe('b3')
  })
})

describe('diatonicChords', () => {
  it('builds the triads of a major key', () => {
    const chords = diatonicChords(['C', 'D', 'E', 'F', 'G', 'A', 'B'])
    expect(chords.map((c) => c.symbol)).toEqual(['C', 'Dm', 'Em', 'F', 'G', 'Am', 'Bdim'])
    expect(chords.map((c) => c.roman)).toEqual(['I', 'ii', 'iii', 'IV', 'V', 'vi', 'vii°'])
    expect(chords[4].tones).toEqual(['G', 'B', 'D'])
  })

  it('builds seventh chords of a minor key', () => {
    const chords = diatonicChords(A_MINOR, true)
    expect(chords.map((c) => c.symbol)).toEqual([
      'Am7',
      'Bm7b5',
      'Cmaj7',
      'Dm7',
      'Em7',
      'Fmaj7',
      'G7',
    ])
    expect(chords.map((c) => c.roman)).toEqual([
      'i7',
      'iiø7',
      'bIIImaj7',
      'iv7',
      'v7',
      'bVImaj7',
      'bVII7',
    ])
  })

  it('handles harmonic minor (augmented III and diminished vii)', () => {
    const chords = diatonicChords(['A', 'B', 'C', 'D', 'E', 'F', 'G#'], true)
    expect(chords[2]).toMatchObject({ symbol: 'Cmaj7#5', roman: 'bIII+maj7' })
    expect(chords[4]).toMatchObject({ symbol: 'E7', roman: 'V7' })
    expect(chords[6]).toMatchObject({ symbol: 'G#dim7', roman: 'vii°7' })
  })

  it('marks modal degrees that sit off the major scale', () => {
    const mixolydian = diatonicChords(['G', 'A', 'B', 'C', 'D', 'E', 'F'])
    expect(mixolydian[6]).toMatchObject({ symbol: 'F', roman: 'bVII' })
    const lydian = diatonicChords(['F', 'G', 'A', 'B', 'C', 'D', 'E'])
    expect(lydian[3]).toMatchObject({ symbol: 'Bdim', roman: '#iv°' })
  })

  it('keeps flat spelling', () => {
    const chords = diatonicChords(F_MAJOR)
    expect(chords[3]).toMatchObject({ symbol: 'Bb', tones: ['Bb', 'D', 'F'] })
  })

  it('returns nothing for scales that are not seven notes', () => {
    expect(diatonicChords(['A', 'C', 'D', 'E', 'G'])).toEqual([])
  })
})
