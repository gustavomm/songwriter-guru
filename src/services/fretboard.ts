// ─────────────────────────────────────────────────────────────────────────────
// Fretboard: Pure functions mapping scales, chords and riff notes onto the neck
// ─────────────────────────────────────────────────────────────────────────────

import { Interval, Note } from 'tonal'
import type { PitchClassWeights } from '../domain/types'

/** Open-string MIDI notes, lowest string first (E2 A2 D3 G3 B3 E4) */
export const STANDARD_TUNING = [40, 45, 50, 55, 59, 64] as const

/** Frets that get an inlay dot (12 and 24 get a double dot) */
export const INLAY_FRETS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24] as const

export type ScaleDegree = 1 | 2 | 3 | 4 | 5 | 6 | 7

export interface FretPosition {
  /** String index, 0 = lowest (low E) */
  string: number
  fret: number
  midi: number
  /** Pitch class 0-11 */
  pc: number
}

export interface FretNote extends FretPosition {
  /** Note name spelled from the scale or chord (e.g. "Bb", not "A#") */
  name: string
  /** Position in the scale, 1-7 (undefined if the note is outside the scale) */
  degree?: ScaleDegree
  /** Interval from the tonic as a degree label (e.g. "1", "b3", "#4") */
  interval?: string
  inScale: boolean
  /**
   * Interval from the chord root (e.g. "R", "3", "b7") whenever a chord is given,
   * so non-chord tones read as tensions ("2", "4", "6")
   */
  chordInterval?: string
  isChordTone: boolean
  /** How prominent this pitch class is in the riff, 0-1 (0 = not played) */
  riffWeight: number
}

/** Every position on the neck from the open string up to `fretCount` */
export function buildPositions(
  fretCount: number,
  tuning: readonly number[] = STANDARD_TUNING
): FretPosition[] {
  const positions: FretPosition[] = []
  tuning.forEach((openMidi, string) => {
    for (let fret = 0; fret <= fretCount; fret++) {
      const midi = openMidi + fret
      positions.push({ string, fret, midi, pc: midi % 12 })
    }
  })
  return positions
}

/**
 * Turn a Tonal interval ("3m", "5P", "4A") into a degree label ("b3", "5", "#4").
 * Major and perfect intervals have no accidental; minor and diminished are flattened
 * relative to major, augmented are sharpened.
 */
export function intervalToDegreeLabel(interval: string): string {
  const { num, q } = Interval.get(interval)
  if (num === undefined || Number.isNaN(num) || !q) return ''
  const simple = ((Math.abs(num) - 1) % 7) + 1
  const isPerfectClass = simple === 1 || simple === 4 || simple === 5
  let accidental = ''
  if (q === 'm') accidental = 'b'
  else if (q === 'd') accidental = isPerfectClass ? 'b' : 'bb'
  else if (q.startsWith('A')) accidental = '#'.repeat(q.length)
  else if (q.startsWith('d')) accidental = 'b'.repeat(q.length + (isPerfectClass ? 0 : 1))
  return `${accidental}${simple}`
}

/** Label for a chord tone relative to its root ("R", "3", "b7", ...) */
export function chordIntervalLabel(root: string, tone: string): string {
  const label = intervalToDegreeLabel(Interval.distance(root, tone))
  return label === '1' ? 'R' : label
}

/** Normalize riff pitch-class weights so the strongest pitch class is 1 */
export function normalizeRiffWeights(weights: PitchClassWeights | number[] | null | undefined) {
  if (!weights) return new Array<number>(12).fill(0)
  const max = Math.max(...weights)
  if (!(max > 0)) return new Array<number>(12).fill(0)
  return weights.map((w) => Math.max(0, w) / max)
}

interface FretboardOptions {
  /** Scale notes, tonic first (e.g. ["A", "B", "C", "D", "E", "F", "G"]) */
  scaleNotes: string[]
  /** Tones of the chord to highlight, root first */
  chordTones?: string[]
  /** Riff pitch-class weights (indexed C=0 ... B=11) */
  riffWeights?: PitchClassWeights | number[] | null
  fretCount?: number
  tuning?: readonly number[]
}

/**
 * Lay a scale (and optionally a chord and the riff) onto the fretboard.
 * Returns only the positions worth drawing: scale notes, chord tones and riff notes.
 */
export function mapFretboard({
  scaleNotes,
  chordTones = [],
  riffWeights,
  fretCount = 15,
  tuning = STANDARD_TUNING,
}: FretboardOptions): FretNote[] {
  const tonic = scaleNotes[0]
  const scaleByPc = new Map<number, { name: string; degree: ScaleDegree; interval: string }>()
  scaleNotes.forEach((name, i) => {
    const pc = Note.chroma(name)
    if (pc === undefined || scaleByPc.has(pc)) return
    scaleByPc.set(pc, {
      name: Note.pitchClass(name),
      degree: (i + 1) as ScaleDegree,
      interval: intervalToDegreeLabel(Interval.distance(tonic, name)),
    })
  })

  const chordRoot = chordTones[0]
  const chordByPc = new Map<number, { name: string; label: string }>()
  chordTones.forEach((tone) => {
    const pc = Note.chroma(tone)
    if (pc === undefined || chordByPc.has(pc)) return
    chordByPc.set(pc, { name: Note.pitchClass(tone), label: chordIntervalLabel(chordRoot, tone) })
  })

  const riff = normalizeRiffWeights(riffWeights)

  return buildPositions(fretCount, tuning).flatMap((pos): FretNote[] => {
    const scale = scaleByPc.get(pos.pc)
    const chord = chordByPc.get(pos.pc)
    const riffWeight = riff[pos.pc] ?? 0
    if (!scale && !chord && riffWeight === 0) return []

    let interval = scale?.interval
    // Spell out-of-scale notes against the tonic so they still get an interval label
    const name = chord?.name ?? scale?.name ?? (tonic ? spellAgainst(tonic, pos.pc) : '')
    if (!interval && tonic && name) {
      interval = intervalToDegreeLabel(Interval.distance(tonic, name))
    }

    return [
      {
        ...pos,
        name,
        degree: scale?.degree,
        interval,
        inScale: Boolean(scale),
        chordInterval:
          chord?.label ?? (chordRoot && name ? chordIntervalLabel(chordRoot, name) : undefined),
        isChordTone: Boolean(chord),
        riffWeight,
      },
    ]
  })
}

// Prefer flats for chromatic notes in flat keys and sharps otherwise
function spellAgainst(tonic: string, pc: number): string {
  const sharp = Note.pitchClass(Note.fromMidiSharps(60 + pc))
  const flat = Note.pitchClass(Note.fromMidi(60 + pc))
  if (sharp === flat) return sharp
  const useFlats = tonic.includes('b') || tonic === 'F'
  return useFlats ? flat : sharp
}

// ─────────────────────────────────────────────────────────────────────────────
// Diatonic chords: stack thirds on each degree of a seven-note scale
// ─────────────────────────────────────────────────────────────────────────────

export interface DiatonicChord {
  symbol: string
  roman: string
  /** Chord tones, root first */
  tones: string[]
}

const ROMANS = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII']

/**
 * Build the triads (or seventh chords) of a seven-note scale by stacking thirds.
 * Returns an empty list for scales that are not seven notes long (e.g. pentatonics).
 */
export function diatonicChords(scaleNotes: string[], sevenths = false): DiatonicChord[] {
  if (scaleNotes.length !== 7) return []
  return scaleNotes.map((root, i) => {
    const tones = [0, 2, 4, ...(sevenths ? [6] : [])].map((step) =>
      Note.pitchClass(scaleNotes[(i + step) % 7])
    )
    const [third, fifth, seventh] = tones.slice(1).map((t) => Interval.distance(root, t))
    return {
      symbol: chordSymbol(root, third, fifth, seventh),
      roman: degreeAccidental(scaleNotes[0], root) + romanNumeral(i, third, fifth, seventh),
      tones,
    }
  })
}

function chordSymbol(root: string, third: string, fifth: string, seventh?: string): string {
  const minor = third === '3m'
  const triad =
    fifth === '5d' && minor ? 'dim' : fifth === '5A' && !minor ? 'aug' : minor ? 'm' : ''
  if (!seventh) return root + triad
  if (triad === 'dim') return root + (seventh === '7d' ? 'dim7' : 'm7b5')
  if (triad === 'aug') return root + (seventh === '7M' ? 'maj7#5' : '7#5')
  if (minor) return root + (seventh === '7M' ? 'mMaj7' : 'm7')
  return root + (seventh === '7M' ? 'maj7' : '7')
}

/** "b" or "#" when a degree sits off the major scale (bIII, bVII, #iv°), like Nashville/Berklee numerals */
function degreeAccidental(tonic: string, root: string): string {
  return intervalToDegreeLabel(Interval.distance(tonic, root)).replace(/[0-9]/g, '')
}

function romanNumeral(index: number, third: string, fifth: string, seventh?: string): string {
  const base = third === '3m' ? ROMANS[index].toLowerCase() : ROMANS[index]
  if (fifth === '5d') {
    if (!seventh) return `${base}°`
    return seventh === '7d' ? `${base}°7` : `${base}ø7`
  }
  const aug = fifth === '5A' ? '+' : ''
  if (!seventh) return base + aug
  return base + aug + (seventh === '7M' ? 'maj7' : '7')
}
