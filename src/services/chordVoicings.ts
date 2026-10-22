// ─────────────────────────────────────────────────────────────────────────────
// Chord voicings: find chord shapes a hand can actually play
// ─────────────────────────────────────────────────────────────────────────────

import { Note } from 'tonal'
import { STANDARD_TUNING } from './fretboard'

export interface Barre {
  fret: number
  /** Lowest and highest string the barre covers (0 = low E) */
  fromString: number
  toString: number
}

export interface ChordVoicing {
  /** Fret per string, low E first; null = muted, 0 = open */
  frets: (number | null)[]
  /** Finger per string (1 = index ... 4 = pinky); null for muted or open strings */
  fingers: (number | null)[]
  barre?: Barre
  /** Lowest fretted fret (1 for open shapes), where a diagram starts */
  baseFret: number
  /** Short name, e.g. "Open", "E shape" or "Fret 5" */
  label: string
  /** CAGED shape this voicing comes from, when it comes from the shape library */
  shape?: 'E' | 'A' | 'D' | 'C' | 'G'
  /** Which string carries the root in the bass, 0 = low E */
  rootString: number
  /** MIDI notes from low to high, for strumming */
  midi: number[]
  score: number
}

interface VoicingOptions {
  tuning?: readonly number[]
  maxFret?: number
  /** Most frets one hand position may cover (fretted notes only) */
  maxSpan?: number
  /** How many shapes to return */
  limit?: number
}

const MIN_STRINGS = 4

// ─────────────────────────────────────────────────────────────────────────────
// Shape library: the CAGED shapes guitarists actually use, as fret offsets from
// the root's fret on the root string (null = muted). Any template whose notes
// match the chord's notes is a candidate, so qualities need no names here.
// ─────────────────────────────────────────────────────────────────────────────

interface ShapeTemplate {
  shape: 'E' | 'A' | 'D' | 'C' | 'G'
  offsets: (number | null)[]
  /** Only playable as an open chord (the C and G shapes stretch too far when moved) */
  openOnly?: boolean
}

const _ = null
const SHAPES: ShapeTemplate[] = [
  // E shape: root on the low E string
  { shape: 'E', offsets: [0, 2, 2, 1, 0, 0] }, // major
  { shape: 'E', offsets: [0, 2, 2, 0, 0, 0] }, // minor
  { shape: 'E', offsets: [0, 2, 0, 1, 0, 0] }, // 7
  { shape: 'E', offsets: [0, 2, 0, 0, 0, 0] }, // m7
  { shape: 'E', offsets: [0, _, 1, 1, 0, _] }, // maj7
  { shape: 'E', offsets: [0, 2, 1, 0, 0, 0] }, // m(maj7)
  { shape: 'E', offsets: [0, _, 0, 0, -1, _] }, // m7b5
  { shape: 'E', offsets: [0, _, -1, 0, -1, _] }, // dim7
  { shape: 'E', offsets: [0, 1, 2, 0, _, _] }, // dim
  { shape: 'E', offsets: [0, _, 2, 1, 1, 0] }, // aug
  { shape: 'E', offsets: [0, 2, 2, 2, 0, 0] }, // sus4
  { shape: 'E', offsets: [0, 2, 0, 2, 0, 0] }, // 7sus4
  // A shape: root on the A string
  { shape: 'A', offsets: [_, 0, 2, 2, 2, 0] }, // major
  { shape: 'A', offsets: [_, 0, 2, 2, 1, 0] }, // minor
  { shape: 'A', offsets: [_, 0, 2, 0, 2, 0] }, // 7
  { shape: 'A', offsets: [_, 0, 2, 0, 1, 0] }, // m7
  { shape: 'A', offsets: [_, 0, 2, 1, 2, 0] }, // maj7
  { shape: 'A', offsets: [_, 0, 2, 1, 1, 0] }, // m(maj7)
  { shape: 'A', offsets: [_, 0, 1, 0, 1, _] }, // m7b5
  { shape: 'A', offsets: [_, 0, 1, -1, 1, _] }, // dim7
  { shape: 'A', offsets: [_, 0, 1, 2, 1, _] }, // dim
  { shape: 'A', offsets: [_, 0, -1, -2, -2, _] }, // aug
  { shape: 'A', offsets: [_, 0, 2, 2, 3, 0] }, // sus4
  { shape: 'A', offsets: [_, 0, 2, 2, 0, 0] }, // sus2
  { shape: 'A', offsets: [_, 0, 2, 2, 2, 2] }, // 6
  { shape: 'A', offsets: [_, 0, 2, -1, 1, _] }, // m6
  { shape: 'A', offsets: [_, 0, -1, 0, 0, 0] }, // 9
  { shape: 'A', offsets: [_, 0, 2, 0, 3, 0] }, // 7sus4
  // D shape: root on the D string
  { shape: 'D', offsets: [_, _, 0, 2, 3, 2] }, // major
  { shape: 'D', offsets: [_, _, 0, 2, 3, 1] }, // minor
  { shape: 'D', offsets: [_, _, 0, 2, 1, 2] }, // 7
  { shape: 'D', offsets: [_, _, 0, 2, 1, 1] }, // m7
  { shape: 'D', offsets: [_, _, 0, 2, 2, 2] }, // maj7
  { shape: 'D', offsets: [_, _, 0, 1, 1, 1] }, // m7b5
  { shape: 'D', offsets: [_, _, 0, 1, 0, 1] }, // dim7
  { shape: 'D', offsets: [_, _, 0, 2, 3, 3] }, // sus4
  { shape: 'D', offsets: [_, _, 0, 2, 3, 0] }, // sus2
  // C and G shapes: the classic open C and G chords
  { shape: 'C', offsets: [_, 0, -1, -3, -2, -3], openOnly: true }, // major
  { shape: 'C', offsets: [_, 0, -1, 0, -2, -3], openOnly: true }, // 7
  { shape: 'C', offsets: [_, 0, -1, -3, -3, -3], openOnly: true }, // maj7
  { shape: 'C', offsets: [_, 0, -1, -3, 0, -3], openOnly: true }, // add9
  { shape: 'G', offsets: [0, -1, -3, -3, -3, 0], openOnly: true }, // major
  { shape: 'G', offsets: [0, -1, -3, -3, -3, -2], openOnly: true }, // 7
]

/**
 * Find playable voicings for a chord, best first: the open chord if there is one,
 * then the movable CAGED shapes (E, A and D shapes) up the neck.
 *
 * Chords the shape library does not cover (9ths, add chords, ...) fall back to a search
 * for compact root-position shapes.
 */
export function findVoicings(chordTones: string[], options: VoicingOptions = {}): ChordVoicing[] {
  const { tuning = STANDARD_TUNING, maxFret = 15, limit = 4 } = options
  const chordPcs = uniquePcs(chordTones)
  if (chordPcs.length < 2) return []
  const rootPc = chordPcs[0]
  const target = relativeSet(chordPcs, rootPc)

  const voicings: ChordVoicing[] = []
  const seen = new Set<string>()
  for (const template of SHAPES) {
    const rootString = template.offsets.findIndex((o) => o === 0)
    if (template.offsets.length !== tuning.length || rootString < 0) continue
    // The notes this template plays, relative to its root
    const notes = template.offsets.flatMap((o, s) =>
      o === null ? [] : [(tuning[s] + o - tuning[rootString] + 120) % 12]
    )
    if (relativeSet(notes, 0) !== target) continue

    const firstRootFret = (rootPc - tuning[rootString] + 120) % 12
    for (let rootFret = firstRootFret; rootFret <= maxFret; rootFret += 12) {
      const frets = template.offsets.map((o) => (o === null ? null : rootFret + o))
      if (frets.some((f) => f !== null && (f < 0 || f > maxFret))) continue
      const isOpen = frets.some((f) => f === 0)
      if (template.openOnly && !isOpen) continue
      const voicing = evaluate(frets, tuning, chordPcs, new Set())
      if (!voicing) continue
      const key = frets.join(',')
      if (seen.has(key)) continue
      seen.add(key)
      voicings.push({
        ...voicing,
        shape: template.shape,
        label: isOpen ? 'Open' : `${template.shape} shape`,
      })
    }
  }

  if (voicings.length === 0) return searchVoicings(chordTones, options)

  // Open chords first, then up the neck; prefer the fuller shape where two overlap
  const sorted = voicings.sort(
    (a, b) =>
      Number(b.label === 'Open') - Number(a.label === 'Open') ||
      a.baseFret - b.baseFret ||
      b.score - a.score
  )
  const picked: ChordVoicing[] = []
  for (const v of sorted) {
    if (picked.length >= limit) break
    if (v.label === 'Open' && picked.some((p) => p.label === 'Open')) continue
    picked.push(v)
  }
  return picked
}

function uniquePcs(tones: string[]): number[] {
  return [
    ...new Set(
      tones.map((t) => Note.chroma(t)).filter((pc): pc is number => typeof pc === 'number')
    ),
  ]
}

function relativeSet(pcs: number[], rootPc: number): string {
  return [...new Set(pcs.map((pc) => (pc - rootPc + 12) % 12))].sort((a, b) => a - b).join(',')
}

/**
 * Fallback search for compact root-position shapes.
 *
 * A voicing is playable when: the strings it sounds are adjacent (muted strings only
 * at the edges), the lowest note is the root, every chord tone is there (a 7th chord
 * may drop its 5th), the fretted notes fit in a four-fret hand position, and it needs
 * at most four fingers (the index can barre the lowest fret).
 */
export function searchVoicings(chordTones: string[], options: VoicingOptions = {}): ChordVoicing[] {
  const { tuning = STANDARD_TUNING, maxFret = 15, maxSpan = 3, limit = 4 } = options
  const chordPcs = uniquePcs(chordTones)
  if (chordPcs.length < 2) return []
  const rootPc = chordPcs[0]
  // The 5th is the tone most safely left out of a 4+ note chord
  const fifthPc = (rootPc + 7) % 12
  const optionalPcs = new Set(chordPcs.length >= 4 && chordPcs.includes(fifthPc) ? [fifthPc] : [])
  const chordSet = new Set(chordPcs)
  const stringCount = tuning.length

  const found = new Map<string, ChordVoicing>()

  for (let start = 1; start <= maxFret - maxSpan; start++) {
    const windowEnd = start + maxSpan
    const allowOpen = start <= 4

    // Notes each string can play in this hand position
    const choices = tuning.map((open) => {
      const frets: number[] = []
      if (allowOpen && chordSet.has(open % 12)) frets.push(0)
      for (let f = start; f <= windowEnd; f++) {
        if (chordSet.has((open + f) % 12)) frets.push(f)
      }
      return frets
    })

    const current: (number | null)[] = new Array(stringCount).fill(null)

    const visit = (string: number, started: boolean, ended: boolean) => {
      if (string === stringCount) {
        const voicing = evaluate(current, tuning, chordPcs, optionalPcs)
        if (voicing) {
          const key = voicing.frets.map((f) => (f === null ? 'x' : f)).join('-')
          const existing = found.get(key)
          if (!existing || existing.score < voicing.score) found.set(key, voicing)
        }
        return
      }
      // Mute this string: before the bass note, or after the shape has ended
      current[string] = null
      visit(string + 1, started, started)
      if (ended) return
      for (const fret of choices[string]) {
        // The first sounded string must be the root
        if (!started && (tuning[string] + fret) % 12 !== rootPc) continue
        current[string] = fret
        visit(string + 1, true, false)
      }
      current[string] = null
    }

    visit(0, false, false)
  }

  return pickSpread([...found.values()], limit)
}

function evaluate(
  frets: (number | null)[],
  tuning: readonly number[],
  chordPcs: number[],
  optionalPcs: Set<number>
): ChordVoicing | null {
  const sounded = frets.flatMap((f, s) => (f === null ? [] : [s]))
  if (sounded.length < Math.min(MIN_STRINGS, frets.length)) return null

  const midi = sounded.map((s) => tuning[s] + (frets[s] as number))
  const present = new Set(midi.map((m) => m % 12))
  const missing = chordPcs.filter((pc) => !present.has(pc))
  if (missing.some((pc) => !optionalPcs.has(pc))) return null

  const fingering = assignFingers(frets)
  if (!fingering) return null

  const fretted = sounded.map((s) => frets[s] as number).filter((f) => f > 0)
  const openCount = sounded.length - fretted.length
  const minFret = fretted.length ? Math.min(...fretted) : 0
  const maxFret = fretted.length ? Math.max(...fretted) : 0
  const fingersUsed = new Set(fingering.fingers.filter((f) => f !== null)).size
  const isOpen = openCount > 0 && maxFret <= 4

  let score = sounded.length * 2
  score += openCount * (isOpen ? 1.5 : -1) // Open strings ring nicely low down, clash higher up
  score -= fingersUsed * 0.5
  score -= (maxFret - minFret) * 0.5
  score -= minFret * 0.12
  score -= missing.length * 1.5
  if (fingering.barre) score -= 0.75
  // Same note doubled at the same pitch adds nothing
  score -= (midi.length - new Set(midi).size) * 2

  return {
    frets: [...frets],
    fingers: fingering.fingers,
    barre: fingering.barre,
    baseFret: minFret || 1,
    label: isOpen ? 'Open' : fingering.barre ? `Barre ${minFret}` : `Fret ${minFret}`,
    rootString: sounded[0],
    midi,
    score,
  }
}

/**
 * Assign fingers to a shape, the way a guitarist would: one finger per fretted note
 * when four are enough; otherwise the index barres the lowest fret, and a finger may
 * flatten across neighbouring strings at the same fret (the A-shape ring-finger barre).
 * Fingers follow the frets, so a note two frets above the index gets at least the ring
 * finger. Returns null when the shape needs more than four fingers.
 */
export function assignFingers(
  frets: (number | null)[]
): { fingers: (number | null)[]; barre?: Barre } | null {
  const frettedStrings = frets.flatMap((f, s) => (f !== null && f > 0 ? [s] : []))
  if (frettedStrings.length === 0) return { fingers: frets.map(() => null) }

  const minFret = Math.min(...frettedStrings.map((s) => frets[s] as number))

  // Simplest first: one finger per note, then allowing a finger to reach one fret further
  const plain =
    placeFingers(frets, frettedStrings, minFret, 1, false) ??
    (frettedStrings.length <= 4 ? placeFingers(frets, frettedStrings, minFret, 1, false, 1) : null)
  if (plain) return { fingers: plain }

  const atMin = frettedStrings.filter((s) => frets[s] === minFret)
  let barre: Barre | undefined
  if (atMin.length >= 2) {
    const from = atMin[0]
    const to = atMin[atMin.length - 1]
    // Every string under the barre must be fretted at or above it (no open strings)
    const coverable = frets.slice(from, to + 1).every((f) => f !== null && f >= minFret)
    if (coverable) barre = { fret: minFret, fromString: from, toString: to }
  }

  const rest = barre
    ? frettedStrings.filter(
        (s) => !(frets[s] === minFret && s >= barre.fromString && s <= barre.toString)
      )
    : frettedStrings
  const first = barre ? 2 : 1
  const fingers =
    placeFingers(frets, rest, minFret, first, false) ??
    placeFingers(frets, rest, minFret, first, true) ??
    placeFingers(frets, rest, minFret, first, true, 1)
  if (!fingers) return null
  if (barre) {
    for (let s = barre.fromString; s <= barre.toString; s++) {
      if (frets[s] === minFret) fingers[s] = 1
    }
  }
  return { fingers, barre }
}

/**
 * Give fingers to `strings` in fret order, starting at `firstFinger`.
 * With `flatten`, neighbouring strings at the same fret share one finger.
 * `reach` lets a finger stretch that many frets past its home fret (the middle finger
 * on the D shape's 3rd string, for example).
 */
function placeFingers(
  frets: (number | null)[],
  strings: number[],
  minFret: number,
  firstFinger: number,
  flatten: boolean,
  reach = 0
): (number | null)[] | null {
  const fingers: (number | null)[] = frets.map(() => null)
  const sorted = [...strings].sort((a, b) => (frets[a] as number) - (frets[b] as number) || a - b)
  let next = firstFinger
  let prev: number | null = null
  for (const s of sorted) {
    const fret = frets[s] as number
    if (flatten && prev !== null && frets[prev] === fret && s === prev + 1) {
      fingers[s] = fingers[prev]
      prev = s
      continue
    }
    const finger = Math.max(next, fret - minFret + 1 - reach)
    if (finger > 4) return null
    fingers[s] = finger
    next = finger + 1
    prev = s
  }
  return fingers
}

/** Best shapes, at most one per hand position and bass string, sorted up the neck */
function pickSpread(voicings: ChordVoicing[], limit: number): ChordVoicing[] {
  const sorted = [...voicings].sort((a, b) => b.score - a.score)
  const picked: ChordVoicing[] = []
  for (const v of sorted) {
    if (picked.length >= limit) break
    const crowded = picked.some(
      (p) =>
        (p.rootString === v.rootString && Math.abs(p.baseFret - v.baseFret) < 3) ||
        (p.label === 'Open' && v.label === 'Open')
    )
    if (!crowded) picked.push(v)
  }
  return picked.sort((a, b) => a.baseFret - b.baseFret || a.rootString - b.rootString)
}

const STRING_NAMES = ['6th', '5th', '4th', '3rd', '2nd', '1st']

function listStrings(strings: number[]): string {
  const names = strings.map((s) => STRING_NAMES[s] ?? `${s + 1}`)
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** One or two plain sentences on how to play a shape, for people learning it */
export function describeVoicing(voicing: ChordVoicing): string {
  const parts: string[] = [`Root on the ${STRING_NAMES[voicing.rootString]} string.`]
  if (voicing.barre) {
    const { fret, fromString, toString } = voicing.barre
    const span =
      fromString === 0 && toString === voicing.frets.length - 1
        ? 'all six strings'
        : `the ${STRING_NAMES[fromString]} to the ${STRING_NAMES[toString]} string`
    parts.push(`Barre fret ${fret} across ${span} with your index finger.`)
  }
  const muted = voicing.frets.flatMap((f, s) => (f === null ? [s] : []))
  const open = voicing.frets.flatMap((f, s) => (f === 0 ? [s] : []))
  if (muted.length) {
    parts.push(`Skip the ${listStrings(muted)} string${muted.length > 1 ? 's' : ''}.`)
  }
  if (open.length) {
    parts.push(`Let the ${listStrings(open)} string${open.length > 1 ? 's' : ''} ring open.`)
  }
  return parts.join(' ')
}
