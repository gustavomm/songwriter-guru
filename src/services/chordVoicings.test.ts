import { describe, it, expect } from 'vitest'
import { Chord, Note } from 'tonal'
import {
  assignFingers,
  describeVoicing,
  findVoicings,
  searchVoicings,
  type ChordVoicing,
} from './chordVoicings'

const tab = (v: ChordVoicing) => v.frets.map((f) => (f === null ? 'x' : f)).join(' ')
const shapesFor = (symbol: string) => findVoicings(Chord.get(symbol).notes)
const tabsFor = (symbol: string) => shapesFor(symbol).map(tab)

describe('findVoicings', () => {
  it.each([
    ['C', 'x 3 2 0 1 0'],
    ['G', '3 2 0 0 0 3'],
    ['E', '0 2 2 1 0 0'],
    ['A', 'x 0 2 2 2 0'],
    ['D', 'x x 0 2 3 2'],
    ['Am', 'x 0 2 2 1 0'],
    ['Em', '0 2 2 0 0 0'],
    ['Dm', 'x x 0 2 3 1'],
    ['Am7', 'x 0 2 0 1 0'],
    ['E7', '0 2 0 1 0 0'],
    ['G7', '3 2 0 0 0 1'],
    ['Cmaj7', 'x 3 2 0 0 0'],
    ['Cadd9', 'x 3 2 0 3 0'],
  ])('puts the open %s chord first', (symbol, expected) => {
    const [first] = shapesFor(symbol)
    expect(tab(first)).toBe(expected)
    expect(first.label).toBe('Open')
  })

  it.each([
    ['F', '1 3 3 2 1 1'],
    ['Bb', 'x 1 3 3 3 1'],
    ['Bm', 'x 2 4 4 3 2'],
    ['F#m', '2 4 4 2 2 2'],
    ['Bm7b5', 'x 2 3 2 3 x'],
    ['C', 'x 3 5 5 5 3'],
    ['G', '3 5 5 4 3 3'],
    ['Gm6', 'x 10 12 9 11 x'],
    ['F', 'x x 3 5 6 5'],
  ])('finds the movable %s shape %s', (symbol, expected) => {
    expect(tabsFor(symbol)).toContain(expected)
  })

  it('labels movable shapes by their CAGED shape', () => {
    const shapes = shapesFor('C')
    expect(shapes.map((s) => s.label)).toEqual(['Open', 'A shape', 'E shape', 'D shape'])
    expect(shapes[1]).toMatchObject({ shape: 'A', baseFret: 3, rootString: 1 })
  })

  it('lists the open chord first, then goes up the neck', () => {
    const frets = shapesFor('Am').map((s) => s.baseFret)
    expect(frets.slice(1)).toEqual([...frets.slice(1)].sort((a, b) => a - b))
  })

  it('returns at most `limit` shapes', () => {
    expect(findVoicings(Chord.get('Am7').notes, { limit: 2 })).toHaveLength(2)
  })

  it('works with flat spellings', () => {
    expect(tabsFor('Ebmaj7')).toContain('x 6 8 7 8 6')
  })

  it('gives MIDI notes from low to high for strumming', () => {
    const [open] = shapesFor('C')
    expect(open.midi).toEqual([48, 52, 55, 60, 64]) // C3 E3 G3 C4 E4
  })

  it('every shape plays exactly the chord tones with the root in the bass', () => {
    for (const symbol of ['C', 'Am', 'G7', 'Fmaj7', 'Bm7b5', 'Bdim7', 'Caug', 'Dsus2', 'A9']) {
      const notes = Chord.get(symbol).notes
      const chordPcs = new Set(notes.map((n) => Note.chroma(n)))
      const shapes = shapesFor(symbol)
      expect(shapes.length).toBeGreaterThan(0)
      for (const shape of shapes) {
        expect(new Set(shape.midi.map((m) => m % 12))).toEqual(chordPcs)
        expect(shape.midi[0] % 12).toBe(Note.chroma(notes[0]))
      }
    }
  })

  it('falls back to a search for chords outside the shape library', () => {
    const shapes = shapesFor('Dadd9')
    expect(shapes.length).toBeGreaterThan(0)
    expect(shapes.every((s) => s.shape === undefined)).toBe(true)
    expect(findVoicings(['C', 'G'])).toEqual([]) // power chords have only two tones
  })
})

describe('searchVoicings', () => {
  it('finds compact root-position shapes that play every chord tone', () => {
    const shapes = searchVoicings(['C', 'E', 'G', 'D'])
    expect(shapes.length).toBeGreaterThan(0)
    for (const shape of shapes) {
      const pcs = new Set(shape.midi.map((m) => m % 12))
      expect(pcs).toEqual(new Set([0, 4, 7, 2]))
      expect(shape.midi[0] % 12).toBe(0)
      const sounded = shape.frets.flatMap((f, s) => (f === null ? [] : [s]))
      // Sounded strings are adjacent
      expect(sounded[sounded.length - 1] - sounded[0] + 1).toBe(sounded.length)
    }
  })
})

describe('assignFingers', () => {
  it('uses one finger per note when four are enough', () => {
    expect(assignFingers([null, 3, 2, 0, 1, 0])).toEqual({
      fingers: [null, 3, 2, null, 1, null],
    })
    expect(assignFingers([0, 2, 2, 1, 0, 0])?.fingers).toEqual([null, 2, 3, 1, null, null])
  })

  it('barres with the index finger for E-shape barre chords', () => {
    expect(assignFingers([1, 3, 3, 2, 1, 1])).toEqual({
      fingers: [1, 3, 4, 2, 1, 1],
      barre: { fret: 1, fromString: 0, toString: 5 },
    })
  })

  it('flattens the ring finger across strings for A-shape barre chords', () => {
    expect(assignFingers([null, 1, 3, 3, 3, 1])).toEqual({
      fingers: [null, 1, 3, 3, 3, 1],
      barre: { fret: 1, fromString: 1, toString: 5 },
    })
  })

  it('lets a finger reach one fret further for the D shape', () => {
    expect(assignFingers([null, null, 3, 5, 6, 5])?.fingers).toEqual([null, null, 1, 2, 4, 3])
  })

  it('does not barre over an open string', () => {
    expect(assignFingers([1, 0, 3, 2, 1, null])?.barre).toBeUndefined()
  })

  it('rejects shapes that need more than four fingers', () => {
    expect(assignFingers([1, 2, 3, 4, 5, null])).toBeNull()
  })

  it('handles all-open shapes', () => {
    expect(assignFingers([0, 0, 0, 0, 0, 0])).toEqual({
      fingers: [null, null, null, null, null, null],
    })
  })
})

describe('describeVoicing', () => {
  it('describes an open chord', () => {
    const [open] = findVoicings(Chord.get('C').notes)
    expect(describeVoicing(open)).toBe(
      'Root on the 5th string. Skip the 6th string. Let the 3rd and 1st strings ring open.'
    )
  })

  it('describes a full barre', () => {
    const f = findVoicings(Chord.get('F').notes).find((v) => v.baseFret === 1)!
    expect(describeVoicing(f)).toBe(
      'Root on the 6th string. Barre fret 1 across all six strings with your index finger.'
    )
  })

  it('describes a partial barre with muted strings', () => {
    const bb = findVoicings(Chord.get('Bb').notes).find((v) => v.shape === 'A')!
    expect(describeVoicing(bb)).toBe(
      'Root on the 5th string. Barre fret 1 across the 5th to the 1st string with your index finger. Skip the 6th string.'
    )
  })
})
