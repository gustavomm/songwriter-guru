import type {
  TranscribedNote,
  PitchClassWeights,
  RiffTiming,
  RiffSegment,
  RiffBar,
  RiffSegmentation,
} from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Riff segmentation: TranscribedNote[] → beat grid → bars (and half-bars)
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. Onsets: note starts within ONSET_MERGE_SEC are one onset, weighted by the
//    notes' duration × amplitude.
// 2. Tempo: every tempo from MIN_BPM to MAX_BPM is tried against a beat grid
//    anchored on one of the first onsets. Each onset scores how close it lands
//    to a beat (1), an eighth (0.5) or a sixteenth (0.2); the weighted mean is
//    the grid alignment. A broad prior around PRIOR_BPM settles the usual
//    half/double-time ambiguity. A poor alignment (or too few onsets) falls
//    back to equal bars of about FALLBACK_BAR_SEC.
// 3. Downbeat: the beat grid point at the first onset is beat 1 unless another
//    of the four beats clearly carries more low / long notes (a pickup).
// 4. Bars: 4 beats each. Each bar (and each half-bar) gets a pitch-class
//    histogram weighted by duration × amplitude × metric strength
//    (downbeat > beat 3 > beats 2 and 4 > offbeats).

/** Time signature: beats per bar (4/4 assumed) */
export const BEATS_PER_BAR = 4

const MIN_BPM = 60
const MAX_BPM = 180
const BPM_STEP = 0.5
/** Centre of the tempo prior (guitar riffs mostly sit around 80-130 bpm) */
const PRIOR_BPM = 105
/** Width of the tempo prior, in octaves */
const PRIOR_OCTAVES = 0.6

/** Notes starting this close together are one onset (a strummed chord) */
const ONSET_MERGE_SEC = 0.05
/** Timing spread (s) of the soft grid match */
const GRID_SIGMA_SEC = 0.03
/** Below this grid alignment the tempo is unclear: equal ~2 s bars instead */
const MIN_GRID_ALIGNMENT = 0.6
const MIN_ONSETS_FOR_TEMPO = 4
/** Grid anchors tried: the phases of the first few onsets */
const PHASE_CANDIDATES = 16
/** Fallback bar length when the tempo is unclear */
export const FALLBACK_BAR_SEC = 2

/** A non-first downbeat must carry this much more weight to be chosen */
const DOWNBEAT_SWITCH_RATIO = 1.3

/** Metric strength by position in the bar (see metricStrength) */
export const METRIC_WEIGHTS = {
  downbeat: 1,
  beat3: 0.8,
  beat: 0.65,
  offbeat: 0.45,
  other: 0.35,
  /** A note held over from the previous segment */
  heldOver: 0.3,
} as const
/** A note within this fraction of a beat of a grid point is on it */
const METRIC_TOLERANCE_BEATS = 0.12

/** A note counts for at most this many beats (let-ring / sustain cap) */
const MAX_NOTE_BEATS = 2
/** Notes within this many semitones of the segment's lowest note are its bass */
const BASS_REGISTER_SEMITONES = 5
/** Trailing sustain shorter than this many beats doesn't open a new bar */
const MIN_TRAILING_BEATS = 0.25

interface Onset {
  time: number
  weight: number
}

function emptyWeights(): PitchClassWeights {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
}

function noteWeight(note: TranscribedNote, maxDuration = Infinity): number {
  return Math.max(0, Math.min(note.endSec - note.startSec, maxDuration)) * (note.velocity ?? 0.5)
}

/** Merge near-simultaneous note starts into weighted onsets, in time order */
export function collectOnsets(notes: readonly TranscribedNote[]): Onset[] {
  const sorted = [...notes].sort((a, b) => a.startSec - b.startSec || a.midi - b.midi)
  const onsets: Onset[] = []
  for (const note of sorted) {
    // Short floor weight so very short notes still count as onsets
    const weight = 0.05 + noteWeight(note, 1)
    const last = onsets[onsets.length - 1]
    if (last && note.startSec - last.time <= ONSET_MERGE_SEC) {
      last.weight += weight
    } else {
      onsets.push({ time: note.startSec, weight })
    }
  }
  return onsets
}

/** Soft grid match of an onset time to a beat grid (1 beat, 0.5 eighth, 0.2 sixteenth) */
function gridHit(time: number, phase: number, period: number): number {
  const gauss = (subdivision: number) => {
    const step = period / subdivision
    const x = (time - phase) / step
    const dist = Math.abs(x - Math.round(x)) * step
    return Math.exp(-0.5 * (dist / GRID_SIGMA_SEC) ** 2)
  }
  return Math.max(gauss(1), 0.5 * gauss(2), 0.2 * gauss(4))
}

function tempoPrior(bpm: number): number {
  return Math.exp(-0.5 * (Math.log2(bpm / PRIOR_BPM) / PRIOR_OCTAVES) ** 2)
}

/**
 * Estimate the beat period and phase from onsets. Returns null when there
 * are too few onsets or no tempo lines them up well.
 */
export function estimateBeatGrid(
  onsets: readonly Onset[]
): { bpm: number; phase: number; alignment: number } | null {
  if (onsets.length < MIN_ONSETS_FOR_TEMPO) return null
  const totalWeight = onsets.reduce((sum, o) => sum + o.weight, 0)
  if (totalWeight <= 0) return null

  const anchors = onsets.slice(0, PHASE_CANDIDATES).map((o) => o.time)
  let best: { bpm: number; phase: number; alignment: number; score: number } | null = null

  for (let bpm = MIN_BPM; bpm <= MAX_BPM + 1e-9; bpm += BPM_STEP) {
    const period = 60 / bpm
    const prior = tempoPrior(bpm)
    for (const phase of anchors) {
      let hits = 0
      for (const onset of onsets) hits += onset.weight * gridHit(onset.time, phase, period)
      const alignment = hits / totalWeight
      const score = alignment * prior
      if (!best || score > best.score + 1e-9) best = { bpm, phase, alignment, score }
    }
  }

  if (!best || best.alignment < MIN_GRID_ALIGNMENT) return null
  return { bpm: best.bpm, phase: best.phase, alignment: best.alignment }
}

/**
 * Metric strength of a note starting `beatPos` beats into its bar:
 * downbeat 1, beat 3 0.8, beats 2/4 0.65, eighth offbeats 0.45, other 0.35.
 */
export function metricStrength(beatPos: number): number {
  const nearest = Math.round(beatPos)
  if (Math.abs(beatPos - nearest) <= METRIC_TOLERANCE_BEATS) {
    const beat = ((nearest % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR
    if (beat === 0) return METRIC_WEIGHTS.downbeat
    if (beat === 2) return METRIC_WEIGHTS.beat3
    return METRIC_WEIGHTS.beat
  }
  const eighth = Math.round(beatPos * 2) / 2
  if (Math.abs(beatPos - eighth) <= METRIC_TOLERANCE_BEATS) return METRIC_WEIGHTS.offbeat
  return METRIC_WEIGHTS.other
}

/** Whether a note at `beatPos` (beats into the bar) falls on beat 1 or 3 */
function isStrongBeat(beatPos: number): boolean {
  const nearest = Math.round(beatPos)
  if (Math.abs(beatPos - nearest) > METRIC_TOLERANCE_BEATS) return false
  const beat = ((nearest % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR
  return beat === 0 || beat === 2
}

/**
 * Choose which beat of the grid is the downbeat: the grid beat at the first
 * onset, unless another of the four beats carries clearly more weight from
 * long and low notes (e.g. the riff starts with a pickup).
 */
function chooseDownbeat(
  notes: readonly TranscribedNote[],
  phase: number,
  beatSec: number,
  firstOnset: number
): number {
  const firstBeat = Math.round((firstOnset - phase) / beatSec)
  const lowest = Math.min(...notes.map((n) => n.midi))
  const scores = [0, 0, 0, 0]
  for (const note of notes) {
    const x = (note.startSec - phase) / beatSec
    const beat = Math.round(x)
    if (Math.abs(x - beat) > METRIC_TOLERANCE_BEATS) continue
    const lowness = note.midi - lowest <= BASS_REGISTER_SEMITONES ? 2 : 1
    const w = noteWeight(note, MAX_NOTE_BEATS * beatSec) * lowness
    for (let k = 0; k < BEATS_PER_BAR; k++) {
      const rel = (((beat - firstBeat - k) % BEATS_PER_BAR) + BEATS_PER_BAR) % BEATS_PER_BAR
      if (rel === 0) scores[k] += w
      else if (rel === 2) scores[k] += 0.5 * w
    }
  }
  let chosen = 0
  for (let k = 1; k < BEATS_PER_BAR; k++) {
    if (scores[k] > scores[0] * DOWNBEAT_SWITCH_RATIO && scores[k] > scores[chosen]) chosen = k
  }
  return phase + (firstBeat + chosen) * beatSec
}

/** Estimate the riff's beat grid (or the fallback equal-bar grid) */
export function estimateTiming(notes: readonly TranscribedNote[]): RiffTiming {
  const onsets = collectOnsets(notes)
  const firstOnset = onsets[0]?.time ?? 0
  const grid = estimateBeatGrid(onsets)

  if (grid) {
    const beatSec = 60 / grid.bpm
    return {
      bpm: grid.bpm,
      beatSec,
      barSec: beatSec * BEATS_PER_BAR,
      downbeatSec: chooseDownbeat(notes, grid.phase, beatSec, firstOnset),
      source: 'tempo',
      confidence: grid.alignment,
    }
  }

  // Fallback: equal bars of about FALLBACK_BAR_SEC across the riff
  const end = riffEnd(notes, FALLBACK_BAR_SEC / 2)
  const length = Math.max(0, end - firstOnset)
  const barCount = Math.max(1, Math.round(length / FALLBACK_BAR_SEC))
  const barSec = length > 0 ? length / barCount : FALLBACK_BAR_SEC
  return {
    bpm: null,
    beatSec: barSec / BEATS_PER_BAR,
    barSec,
    downbeatSec: firstOnset,
    source: 'fallback',
    confidence: 0,
  }
}

/** End of the riff: the last note end, with let-ring capped at `maxSustain` */
function riffEnd(notes: readonly TranscribedNote[], maxSustain: number): number {
  return notes.reduce(
    (end, n) => Math.max(end, Math.min(n.endSec, n.startSec + maxSustain)),
    -Infinity
  )
}

/**
 * Weighted pitch-class content of the notes sounding in [startSec, endSec).
 * Notes starting in the segment are weighted by metric strength; notes held
 * over from before it count at METRIC_WEIGHTS.heldOver.
 */
export function analyseSegment(
  notes: readonly TranscribedNote[],
  timing: Pick<RiffTiming, 'beatSec' | 'downbeatSec' | 'source'>,
  bar: number,
  half: 0 | 1 | 2,
  startSec: number,
  endSec: number,
  /** Notes starting at or after this time count as starting in the segment */
  onsetFromSec: number = startSec
): RiffSegment {
  const { beatSec, downbeatSec } = timing
  const metricReliable = timing.source === 'tempo'
  const maxDuration = MAX_NOTE_BEATS * beatSec
  const weights = emptyWeights()
  const strong = emptyWeights()
  let noteCount = 0
  const contributions: { midi: number; weight: number }[] = []

  for (const note of notes) {
    const noteEnd = Math.min(note.endSec, note.startSec + maxDuration)
    const startsHere = note.startSec >= onsetFromSec - 1e-6 && note.startSec < endSec - 1e-6
    const overlap = Math.min(noteEnd, endSec) - Math.max(note.startSec, startSec)
    if (!startsHere && (overlap <= 1e-6 || note.startSec >= endSec)) continue
    const duration = startsHere
      ? Math.max(0, Math.min(noteEnd, endSec) - note.startSec)
      : Math.max(0, overlap)
    if (duration <= 0 && !startsHere) continue

    const beatPos = (note.startSec - downbeatSec) / beatSec
    const metric = !startsHere
      ? METRIC_WEIGHTS.heldOver
      : metricReliable
        ? metricStrength(beatPos)
        : METRIC_WEIGHTS.beat
    // Very short notes still register a little
    const weight = Math.max(duration, 0.05 * beatSec) * (note.velocity ?? 0.5) * metric
    const pc = ((note.midi % 12) + 12) % 12
    weights[pc] += weight
    contributions.push({ midi: note.midi, weight })
    if (startsHere) {
      noteCount++
      const sustained = noteEnd - note.startSec >= beatSec * 0.95
      if (sustained || (metricReliable && isStrongBeat(beatPos))) strong[pc] += weight
    }
  }

  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total > 0) {
    for (let pc = 0; pc < 12; pc++) {
      weights[pc] /= total
      strong[pc] /= total
    }
  }

  const segment: RiffSegment = {
    bar,
    half,
    startSec,
    endSec,
    pcWeights: weights,
    strongPcWeights: strong,
    noteCount,
  }

  if (contributions.length > 0) {
    const lowest = Math.min(...contributions.map((c) => c.midi))
    const low = new Array<number>(12).fill(0)
    for (const c of contributions) {
      const above = c.midi - lowest
      // The lowest notes count most: a note 4 semitones up counts a third
      if (above <= BASS_REGISTER_SEMITONES) {
        low[((c.midi % 12) + 12) % 12] += c.weight / (1 + above / 2)
      }
    }
    const lowTotal = low.reduce((sum, w) => sum + w, 0)
    let bassPc = ((lowest % 12) + 12) % 12
    for (let pc = 0; pc < 12; pc++) if (low[pc] > low[bassPc]) bassPc = pc
    segment.bassPc = bassPc
    segment.bassStrength = lowTotal > 0 ? low[bassPc] / lowTotal : 0
  }

  return segment
}

/**
 * Cut a riff into bars along its estimated beat grid.
 *
 * Bar 1 starts at the first downbeat; notes before it (a pickup) are folded
 * into bar 1. Trailing bars that only hold let-ring sustain are dropped.
 * Each bar with notes in both halves also carries its two half-bar segments,
 * so the harmonizer can split a bar with two harmonic areas.
 */
export function segmentRiff(notes: readonly TranscribedNote[]): RiffSegmentation {
  const timing = estimateTiming(notes)
  if (notes.length === 0) return { timing, bars: [], noteCount: 0 }

  const { barSec, beatSec, downbeatSec } = timing
  const firstStart = Math.min(...notes.map((n) => n.startSec))
  const lastStart = Math.max(...notes.map((n) => n.startSec))
  const end = riffEnd(notes, MAX_NOTE_BEATS * beatSec)

  // Bar 1 starts at the downbeat, or one bar earlier if a long pickup (more
  // than half a bar) comes before it
  let barStart = downbeatSec
  while (barStart - firstStart > barSec / 2 + 1e-6) barStart -= barSec

  const bars: RiffBar[] = []
  for (let i = 0; ; i++) {
    const start = barStart + i * barSec
    const isLastNeeded = start > lastStart + 1e-6
    if (isLastNeeded) break
    if (i > 0 && start >= end - MIN_TRAILING_BEATS * beatSec) break
    const stop = start + barSec
    // Pickup notes before bar 1 belong to bar 1
    const segStart = i === 0 ? Math.min(start, firstStart) : start
    const onsetFrom = i === 0 ? -Infinity : start
    const whole = analyseSegment(notes, timing, i + 1, 0, segStart, stop, onsetFrom)
    const bar: RiffBar = { ...whole, half: 0 }

    const mid = start + barSec / 2
    const first = analyseSegment(notes, timing, i + 1, 1, segStart, mid, onsetFrom)
    const second = analyseSegment(notes, timing, i + 1, 2, mid, stop)
    if (first.noteCount > 0 && second.noteCount > 0) bar.halves = [first, second]

    bars.push(bar)
  }

  // Trailing bars with no note starts are pure let-ring: drop them
  while (bars.length > 1 && bars[bars.length - 1].noteCount === 0) bars.pop()

  return { timing, bars, noteCount: notes.length }
}
