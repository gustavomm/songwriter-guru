import { Chord, Note } from 'tonal'
import type {
  ChordSuggestion,
  ChordSuggestionResult,
  HarmonicFieldCandidate,
  HarmonizationResult,
  HarmonizedChord,
  RiffFeatures,
  RiffHarmonization,
  RiffSegment,
} from '../domain/types'
import {
  getDominantApproach,
  getResolutionTarget,
  getRootChroma,
  isValidTransition,
} from './progressionService'
import { colorBudget, colorDistanceOf, colorPreference, isWithinReach } from './weirdness'

// ─────────────────────────────────────────────────────────────────────────────
// Riff harmonizer: one chord per bar (or half-bar) that follows the riff
// ─────────────────────────────────────────────────────────────────────────────
//
// 1. Per-segment fit (scoreSegmentFit): each candidate chord is scored against
//    the bar's metric-weighted pitch classes: chord tones are rewarded (root
//    and third most), other notes cost a little, avoid notes (a strong or
//    sustained note a semitone above a chord tone, e.g. F over C) cost a lot,
//    unplayed chord tones cost a little (so a 7th chord only beats its triad
//    when the 7th is played), and the bar's bass note on the root helps.
// 2. Viterbi over segments: maximise Σ fit + colour preference + transitions
//    (functional motion T → SD → D → T, root motion by 4th/5th or step) with
//    second-order penalties for staying static or flipping back and forth,
//    hard rules for applied chords (they must resolve), a colour budget and
//    at most one colour-variant tonic, plus a tonic start and a cadence on the
//    tonic at the end. The state is (previous chord, chord, colour chords
//    used, colour-variant tonic used).
// 3. Alternatives: the search is re-run with a penalty on the chord roots the
//    earlier results used in each segment, keeping new root sequences only.

/** Minimum notes / bars to harmonize a riff */
export const MIN_HARMONIZE_NOTES = 4
const MIN_HARMONIZE_BARS = 2
/** Most options returned (the best plus alternatives) */
const MAX_OPTIONS = 4
/** Extra searches allowed to find new alternatives */
const MAX_SEARCHES = 7
/** Penalty per earlier option that used the same root in a segment */
const DIVERSITY_PENALTY = 0.2
/** Alternatives may lose at most this much score per segment against the best */
const MAX_ALTERNATIVE_LOSS_PER_SEGMENT = 0.45

// Per-segment fit weights
export const FIT_WEIGHTS = {
  root: 1,
  third: 0.9,
  fifth: 0.65,
  extension: 0.6,
  /** Cost per unit weight of non-chord tones */
  nonChordTone: 0.35,
  /** Extra cost per unit strong-beat / sustained weight of avoid notes */
  avoidNote: 0.8,
  /** Cost per chord tone the segment never plays (a fifth costs half) */
  missingTone: 0.06,
  /** A chord tone below this weight counts as (partly) missing */
  missingThreshold: 0.04,
  /** Bonus × bass strength when the segment's bass is the root */
  bassRoot: 0.2,
  /** Bonus × bass strength when the bass is another chord tone */
  bassChordTone: 0.05,
  /** Cost × bass strength when the bass is not a chord tone */
  bassNonChordTone: 0.15,
} as const

/** Candidate chords kept per segment besides the plain diatonic triads */
const CANDIDATES_PER_SEGMENT = 5
/** Upper bound on the candidate pool (keeps the search fast on long riffs) */
const MAX_CANDIDATES = 26
/** Colour chords tracked by the search (the budget is capped here) */
const MAX_TRACKED_BUDGET = 4
/**
 * A bar splits into halves only when no single chord explains it well (best
 * whole-bar fit below SPLIT_MAX_WHOLE_FIT), each half has a few notes, and
 * splitting raises the mean fit by SPLIT_GAIN
 */
const SPLIT_GAIN = 0.25
const SPLIT_MAX_WHOLE_FIT = 0.6
const SPLIT_MIN_HALF_NOTES = 2

// Transition rewards
const FUNCTION_MOTION: Record<string, Record<string, number>> = {
  T: { T: 0.02, SD: 0.12, D: 0.06 },
  SD: { T: 0.04, SD: 0.03, D: 0.15 },
  D: { T: 0.2, SD: -0.06, D: 0 },
}
/** Reward by root motion in semitones upward (5 = down a fifth) */
const ROOT_MOTION = [0, 0.02, 0.06, 0.03, 0.03, 0.12, -0.06, 0.06, 0.03, 0.03, 0.06, 0.03]
const APPLIED_RESOLUTION_BONUS = 0.1
/** Cost of keeping the same chord root into the next segment */
const REPEAT_COST = 0.03
/** Cost of a third (and each further) segment on the same root */
const STATIC_COST = 0.2
/** Cost of going straight back to the chord before (A → B → A) */
const BACK_AND_FORTH_COST = 0.12
const START_TONIC_BONUS = 0.25
const START_TONIC_FUNCTION_BONUS = 0.05
const END_TONIC_BONUS = 0.35
/** End bonus for a colour-variant tonic (i(maj7), i6): a plain tonic ends better */
const END_COLOR_TONIC_BONUS = 0.05
const CADENCE_AUTHENTIC_BONUS = 0.15
const CADENCE_SOFT_BONUS = 0.12
const CADENCE_PLAGAL_BONUS = 0.06

// ─────────────────────────────────────────────────────────────────────────────
// Per-segment fit
// ─────────────────────────────────────────────────────────────────────────────

type ToneRole = 'root' | 'third' | 'fifth' | 'extension'

interface ChordShape {
  root: number
  tones: { pc: number; role: ToneRole; name: string }[]
  pcs: Set<number>
}

const shapeCache = new Map<string, ChordShape>()

function chordShape(chord: ChordSuggestion): ChordShape {
  const key = `${chord.id}|${chord.chordTones.join(',')}`
  const cached = shapeCache.get(key)
  if (cached) return cached
  const intervals = Chord.get(chord.id).intervals
  const roleFor = (i: number): ToneRole => {
    const ivl = intervals[i]
    const number = ivl ? parseInt(ivl, 10) : [1, 3, 5][i]
    if (number === 1) return 'root'
    if (number === 3) return 'third'
    if (number === 5) return 'fifth'
    return 'extension'
  }
  const tones = chord.chordTones
    .map((name, i) => ({ pc: Note.chroma(name), role: roleFor(i), name }))
    .filter((t): t is { pc: number; role: ToneRole; name: string } => t.pc !== undefined)
  const shape: ChordShape = {
    root: tones[0]?.pc ?? 0,
    tones,
    pcs: new Set(tones.map((t) => t.pc)),
  }
  shapeCache.set(key, shape)
  return shape
}

export interface SegmentFit {
  /** Fit score (roughly -1 to 1.2; 0 for an empty segment) */
  score: number
  /** Share (0-1) of the segment's weight on chord tones */
  chordToneShare: number
  /** Chord tones by weight in the segment, heaviest first (names) */
  leaning: string[]
  /** Share of the segment's weight on non-chord tones */
  nonChordShare: number
}

/**
 * Score how well a chord fits one segment of the riff (see FIT_WEIGHTS).
 */
export function scoreSegmentFit(segment: RiffSegment, chord: ChordSuggestion): SegmentFit {
  const shape = chordShape(chord)
  const w = segment.pcWeights
  const total = w.reduce((sum, x) => sum + x, 0)
  if (total <= 0 || shape.tones.length === 0) {
    return { score: 0, chordToneShare: 0, leaning: [], nonChordShare: 0 }
  }

  let score = 0
  let chordToneShare = 0
  let missing = 0
  for (const tone of shape.tones) {
    const weight = w[tone.pc]
    score += weight * FIT_WEIGHTS[tone.role]
    chordToneShare += weight
    const absent = Math.max(0, 1 - weight / FIT_WEIGHTS.missingThreshold)
    missing += tone.role === 'fifth' ? absent / 2 : absent
  }
  score -= FIT_WEIGHTS.missingTone * missing

  let nonChordShare = 0
  for (let pc = 0; pc < 12; pc++) {
    if (shape.pcs.has(pc) || w[pc] <= 0) continue
    nonChordShare += w[pc]
    score -= FIT_WEIGHTS.nonChordTone * w[pc]
    // Avoid note: a semitone above a chord tone, on a strong beat or sustained
    if (shape.pcs.has((pc + 11) % 12)) {
      score -= FIT_WEIGHTS.avoidNote * segment.strongPcWeights[pc]
    }
  }

  if (segment.bassPc !== undefined) {
    const strength = segment.bassStrength ?? 0
    if (segment.bassPc === shape.root) score += FIT_WEIGHTS.bassRoot * strength
    else if (shape.pcs.has(segment.bassPc)) score += FIT_WEIGHTS.bassChordTone * strength
    else score -= FIT_WEIGHTS.bassNonChordTone * strength
  }

  const leaning = shape.tones
    .filter((t) => w[t.pc] >= 0.12)
    .sort((a, b) => w[b.pc] - w[a.pc])
    .map((t) => t.name)

  return { score, chordToneShare, leaning, nonChordShare }
}

// ─────────────────────────────────────────────────────────────────────────────
// Segments
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The segments to harmonize: one per bar, or the bar's two halves when they
 * clearly want different chords (their best chords have different roots and
 * splitting raises the mean fit by SPLIT_GAIN).
 */
function planSegments(
  features: RiffFeatures,
  candidates: readonly ChordSuggestion[]
): RiffSegment[] {
  const bars = features.segmentation?.bars ?? []
  const best = (segment: RiffSegment) => {
    let top: { chord: ChordSuggestion; score: number } | null = null
    for (const chord of candidates) {
      const score = scoreSegmentFit(segment, chord).score
      if (!top || score > top.score) top = { chord, score }
    }
    return top
  }

  const segments: RiffSegment[] = []
  for (const bar of bars) {
    if (bar.halves) {
      const whole = best(bar)
      const first = best(bar.halves[0])
      const second = best(bar.halves[1])
      if (
        whole &&
        first &&
        second &&
        whole.score < SPLIT_MAX_WHOLE_FIT &&
        bar.halves.every((h) => h.noteCount >= SPLIT_MIN_HALF_NOTES) &&
        getRootChroma(first.chord) !== getRootChroma(second.chord) &&
        (first.score + second.score) / 2 - whole.score > SPLIT_GAIN
      ) {
        segments.push(bar.halves[0], bar.halves[1])
        continue
      }
    }
    segments.push(bar)
  }
  return segments
}

// ─────────────────────────────────────────────────────────────────────────────
// Path scoring (shared by the Viterbi search and path evaluation)
// ─────────────────────────────────────────────────────────────────────────────

interface Context {
  candidates: ChordSuggestion[]
  segments: RiffSegment[]
  /** fit[s][c] */
  fit: SegmentFit[][]
  roots: (number | null)[]
  tonicPc: number
  weirdness: number
  budget: number
  /** Precomputed per-chord flags */
  isColor: boolean[]
  isColorTonic: boolean[]
  isPlainTonic: boolean[]
  /** Chord on the tonic root that can open a progression (I, I7 = V/IV, i7...) */
  isTonicRoot: boolean[]
  isApplied: boolean[]
  /** Precomputed scores, filled by precompute() */
  unary: number[][]
  /** Transition scores a → b (index a * N + b) into a middle / the last segment */
  transition: Float64Array
  transitionLast: Float64Array
  /** 1 when chords a and b share a root (index a * N + b) */
  same: Uint8Array
}

function unaryScore(ctx: Context, s: number, c: number): number {
  return ctx.unary[s][c]
}

function computeUnary(ctx: Context, s: number, c: number): number {
  const chord = ctx.candidates[c]
  let score = ctx.fit[s][c].score + colorPreference(chord, ctx.weirdness)
  const last = ctx.segments.length - 1
  if (s === 0) {
    if (ctx.isTonicRoot[c]) score += START_TONIC_BONUS
    else if (chord.function === 'T') score += START_TONIC_FUNCTION_BONUS
  }
  if (s === last) {
    if (ctx.isApplied[c]) return -Infinity
    if (ctx.isPlainTonic[c]) score += END_TONIC_BONUS
    else if (ctx.isColorTonic[c]) score += END_COLOR_TONIC_BONUS
  }
  return score
}

function computeSameRoot(ctx: Context, a: number, b: number): boolean {
  return a === b || (ctx.roots[a] !== null && ctx.roots[a] === ctx.roots[b])
}

function sameRoot(ctx: Context, a: number, b: number): boolean {
  return ctx.same[a * ctx.candidates.length + b] === 1
}

/** Score of moving from chord a (segment s-1) to chord b (segment s) */
function transitionScore(ctx: Context, s: number, a: number, b: number): number {
  const i = a * ctx.candidates.length + b
  return s === ctx.segments.length - 1 ? ctx.transitionLast[i] : ctx.transition[i]
}

function computeTransition(ctx: Context, last: boolean, a: number, b: number): number {
  const from = ctx.candidates[a]
  const to = ctx.candidates[b]

  // Applied chords (V/x, subV/x, bII) must move to their target; they may be
  // held across segments first
  if (ctx.isApplied[a] && a !== b && !isValidTransition(from, to)) return -Infinity

  if (sameRoot(ctx, a, b)) return -REPEAT_COST

  let score = 0
  // An applied chord resolving to its target replaces the function motion
  if (ctx.isApplied[a]) score += APPLIED_RESOLUTION_BONUS
  else if (from.function && to.function) {
    score += FUNCTION_MOTION[from.function]?.[to.function] ?? 0
  }
  const ra = ctx.roots[a]
  const rb = ctx.roots[b]
  if (ra !== null && rb !== null) score += ROOT_MOTION[(rb - ra + 12) % 12]

  // Cadence into the final tonic
  if (last && (ctx.isPlainTonic[b] || ctx.isColorTonic[b])) {
    const approach = getDominantApproach(from, ctx.tonicPc)
    if (approach === 'authentic') score += CADENCE_AUTHENTIC_BONUS
    else if (approach) score += CADENCE_SOFT_BONUS
    else if (from.function === 'SD') score += CADENCE_PLAGAL_BONUS
  }
  return score
}

/** Second-order cost of chord c after p → a (segment s) */
function tripleScore(ctx: Context, s: number, p: number, a: number, c: number): number {
  if (sameRoot(ctx, p, a) && sameRoot(ctx, a, c)) {
    // A silent segment just lets the chord ring on
    return ctx.segments[s].noteCount === 0 ? 0 : -STATIC_COST
  }
  if (sameRoot(ctx, p, c) && !sameRoot(ctx, p, a)) return -BACK_AND_FORTH_COST
  return 0
}

/** Fill the precomputed unary and transition tables */
function precompute(ctx: Context): void {
  const N = ctx.candidates.length
  ctx.unary = ctx.segments.map((_, s) => ctx.candidates.map((_c, c) => computeUnary(ctx, s, c)))
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      ctx.same[a * N + b] = computeSameRoot(ctx, a, b) ? 1 : 0
    }
  }
  for (let a = 0; a < N; a++) {
    for (let b = 0; b < N; b++) {
      ctx.transition[a * N + b] = computeTransition(ctx, false, a, b)
      ctx.transitionLast[a * N + b] = computeTransition(ctx, true, a, b)
    }
  }
}

/** Total score of a path (without diversity penalties) */
function evaluatePath(ctx: Context, path: number[]): number {
  let score = 0
  for (let s = 0; s < path.length; s++) {
    score += unaryScore(ctx, s, path[s])
    if (s > 0) score += transitionScore(ctx, s, path[s - 1], path[s])
    if (s > 1) score += tripleScore(ctx, s, path[s - 2], path[s - 1], path[s])
  }
  return score
}

// ─────────────────────────────────────────────────────────────────────────────
// Viterbi search
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Best path through the segments. State: (previous chord, chord, colour
 * chords used, colour-variant tonic used). `penalty[s][c]` is subtracted
 * from the unary score (used to push alternatives away from earlier ones).
 */
function viterbi(ctx: Context, penalty: number[][]): number[] | null {
  const S = ctx.segments.length
  const N = ctx.candidates.length
  const B = Math.min(ctx.budget, MAX_TRACKED_BUDGET)
  const NONE = N // "no previous chord" at the first segment
  const P = N + 1
  const size = P * N * (B + 1) * 2
  const index = (p: number, c: number, k: number, v: number) => ((p * N + c) * (B + 1) + k) * 2 + v

  const unary = (s: number, c: number) => unaryScore(ctx, s, c) - penalty[s][c]

  let scores = new Float64Array(size).fill(-Infinity)
  const back: Int32Array[] = []

  for (let c = 0; c < N; c++) {
    const u = unary(0, c)
    if (u === -Infinity) continue
    const k = ctx.isColor[c] ? 1 : 0
    const v = ctx.isColorTonic[c] ? 1 : 0
    if (k > B) continue
    scores[index(NONE, c, k, v)] = u
  }
  back.push(new Int32Array(size).fill(-1))

  for (let s = 1; s < S; s++) {
    const next = new Float64Array(size).fill(-Infinity)
    const ptr = new Int32Array(size).fill(-1)
    const unaryRow = Array.from({ length: N }, (_, c) => unary(s, c))
    for (let p = 0; p < P; p++) {
      for (let a = 0; a < N; a++) {
        for (let k = 0; k <= B; k++) {
          for (let v = 0; v < 2; v++) {
            const from = index(p, a, k, v)
            const base = scores[from]
            if (base === -Infinity) continue
            for (let c = 0; c < N; c++) {
              const u = unaryRow[c]
              if (u === -Infinity) continue
              const nk = k + (ctx.isColor[c] ? 1 : 0)
              if (nk > B) continue
              if (v === 1 && ctx.isColorTonic[c] && c !== a) continue
              const nv = v === 1 || ctx.isColorTonic[c] ? 1 : 0
              const t = transitionScore(ctx, s, a, c)
              if (t === -Infinity) continue
              const triple = p === NONE ? 0 : tripleScore(ctx, s, p, a, c)
              const total = base + u + t + triple
              const to = index(a, c, nk, nv)
              if (total > next[to] + 1e-12) {
                next[to] = total
                ptr[to] = from
              }
            }
          }
        }
      }
    }
    scores = next
    back.push(ptr)
  }

  let bestState = -1
  for (let i = 0; i < size; i++) {
    if (scores[i] > -Infinity && (bestState < 0 || scores[i] > scores[bestState] + 1e-12)) {
      bestState = i
    }
  }
  if (bestState < 0) return null

  const path: number[] = new Array(S)
  let state = bestState
  for (let s = S - 1; s >= 0; s--) {
    path[s] = Math.floor(state / ((B + 1) * 2)) % N
    state = back[s][state]
  }
  return path
}

// ─────────────────────────────────────────────────────────────────────────────
// Reasons
// ─────────────────────────────────────────────────────────────────────────────

function segmentLabel(segment: RiffSegment): string {
  if (segment.half === 1) return `Bar ${segment.bar} (1st half)`
  if (segment.half === 2) return `Bar ${segment.bar} (2nd half)`
  return `Bar ${segment.bar}`
}

function joinNames(names: string[]): string {
  return names.length > 1
    ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
    : names[0]
}

function describeChord(
  ctx: Context,
  s: number,
  c: number,
  nextChord: ChordSuggestion | null
): string {
  const segment = ctx.segments[s]
  const chord = ctx.candidates[c]
  const fit = ctx.fit[s][c]
  const label = segmentLabel(segment)

  let lead: string
  if (segment.noteCount === 0 && fit.leaning.length === 0) {
    lead = `${label} rests, so ${chord.symbol} rings on`
  } else {
    const shape = chordShape(chord)
    const rootName = shape.tones[0]?.name
    const bassIsRoot =
      segment.bassPc === shape.root && (segment.bassStrength ?? 0) >= 0.5 && rootName
    const leaning = fit.leaning.slice(0, 2)
    if (bassIsRoot) {
      const others = leaning.filter((n) => n !== rootName)
      lead = others.length
        ? `${label}: ${rootName} in the bass, with ${joinNames(others)}`
        : `${label} sits on ${rootName}`
    } else if (leaning.length > 0) {
      lead = `${label} leans on ${joinNames(leaning)}`
    } else {
      lead = `${label} is ambiguous; ${chord.symbol} keeps things moving`
    }
  }

  const extras: string[] = []
  const target = getResolutionTarget(chord)
  if (target && nextChord && ctx.isApplied[c]) {
    extras.push(`pulls to ${nextChord.symbol}`)
  } else if (chord.source === 'borrowed' && chord.sourceDetail) {
    extras.push(chord.sourceDetail.charAt(0).toLowerCase() + chord.sourceDetail.slice(1))
  } else if (ctx.isColor[c] && chord.roman) {
    extras.push(`${chord.roman} adds colour`)
  }
  if (s === ctx.segments.length - 1 && ctx.isPlainTonic[c]) extras.push('resolves home')
  if (fit.nonChordShare >= 0.3 && segment.noteCount > 0) extras.push('other notes pass through')

  return extras.length ? `${lead}; ${extras.join(', ')}` : lead
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

/** Whether features carry a riff long enough to harmonize bar by bar */
export function canHarmonize(features: RiffFeatures | null | undefined): boolean {
  const seg = features?.segmentation
  return !!seg && seg.noteCount >= MIN_HARMONIZE_NOTES && seg.bars.length >= MIN_HARMONIZE_BARS
}

/**
 * Harmonize the riff bar by bar in the selected key.
 *
 * Candidate chords are the key's chord suggestions within reach of the
 * weirdness knob. Returns the best progression plus up to three diverse
 * alternatives, each chord aligned to its bar (or half-bar), or null when
 * the riff is too short (fewer than MIN_HARMONIZE_NOTES notes or 2 bars).
 * Deterministic for the same input.
 */
export function harmonizeRiff(
  field: HarmonicFieldCandidate,
  chords: ChordSuggestionResult,
  features: RiffFeatures,
  weirdness: number
): HarmonizationResult | null {
  if (!canHarmonize(features) || !features.segmentation) return null
  const tonicPc = Note.chroma(field.tonic)
  if (tonicPc === undefined) return null

  // Candidate chords within reach (unique by symbol, in catalog order)
  const seen = new Set<string>()
  const pool: ChordSuggestion[] = []
  for (const chord of chords.byId.values()) {
    if (seen.has(chord.symbol) || chord.chordTones.length < 3) continue
    if (!isWithinReach(chord, weirdness)) continue
    seen.add(chord.symbol)
    pool.push(chord)
  }
  if (pool.length === 0) return null

  const segments = planSegments(features, pool)
  if (segments.length === 0) return null

  // Keep the plain diatonic triads plus each segment's best few chords
  const isPlainTriad = (c: ChordSuggestion) => colorDistanceOf(c) === 0 && c.chordTones.length === 3
  // Priority (lower is better): plain triads first, then by best rank in any segment
  const priority = new Map<ChordSuggestion, number>()
  for (const chord of pool) if (isPlainTriad(chord)) priority.set(chord, -1)
  for (const segment of segments) {
    const ranked = pool
      .map((chord, i) => ({
        chord,
        i,
        score: scoreSegmentFit(segment, chord).score + colorPreference(chord, weirdness),
      }))
      .sort((a, b) => b.score - a.score || a.i - b.i)
    ranked.slice(0, CANDIDATES_PER_SEGMENT).forEach(({ chord }, rank) => {
      priority.set(chord, Math.min(priority.get(chord) ?? Infinity, rank))
    })
  }
  // Applied chords need their resolution target available
  for (const chord of [...priority.keys()]) {
    if (!getResolutionTarget(chord)) continue
    const target = pool.find((t) => isValidTransition(chord, t) && colorDistanceOf(t) === 0)
    if (target && !priority.has(target)) priority.set(target, priority.get(chord) ?? 0)
  }
  const kept = new Set(
    [...priority.entries()]
      .map(([chord, p]) => ({ chord, p, i: pool.indexOf(chord) }))
      .sort((a, b) => a.p - b.p || a.i - b.i)
      .slice(0, MAX_CANDIDATES)
      .map(({ chord }) => chord)
  )
  const candidates = pool.filter((c) => kept.has(c))
  const N = candidates.length

  const roots = candidates.map(getRootChroma)
  const ctx: Context = {
    candidates,
    segments,
    fit: segments.map((segment) => candidates.map((c) => scoreSegmentFit(segment, c))),
    roots,
    tonicPc,
    weirdness,
    budget: colorBudget(weirdness, segments.length),
    isColor: candidates.map((c) => colorDistanceOf(c) > 0),
    isColorTonic: candidates.map(
      (c, i) => roots[i] === tonicPc && !!c.colorVariant && c.function === 'T'
    ),
    isPlainTonic: candidates.map(
      (c, i) => roots[i] === tonicPc && c.function === 'T' && colorDistanceOf(c) === 0
    ),
    isTonicRoot: candidates.map(
      (c, i) => roots[i] === tonicPc && c.source !== 'borrowed' && !c.colorVariant
    ),
    isApplied: candidates.map((c) => getResolutionTarget(c) !== null),
    unary: [],
    transition: new Float64Array(N * N),
    transitionLast: new Float64Array(N * N),
    same: new Uint8Array(N * N),
  }
  precompute(ctx)

  // Best path, then alternatives pushed away from the roots already used
  const penalty = segments.map(() => new Array<number>(candidates.length).fill(0))
  const found: { path: number[]; score: number }[] = []
  const keys = new Set<string>()
  for (let search = 0; search < MAX_SEARCHES && found.length < MAX_OPTIONS; search++) {
    const path = viterbi(ctx, penalty)
    if (!path) break
    const key = path.map((c) => roots[c] ?? candidates[c].symbol).join('-')
    if (!keys.has(key)) {
      keys.add(key)
      const score = evaluatePath(ctx, path)
      const loss = found.length > 0 ? (found[0].score - score) / segments.length : 0
      if (loss <= MAX_ALTERNATIVE_LOSS_PER_SEGMENT) {
        found.push({ path, score })
      }
    }
    path.forEach((c, s) => {
      for (let other = 0; other < candidates.length; other++) {
        if (sameRoot(ctx, c, other)) penalty[s][other] += DIVERSITY_PENALTY
      }
    })
  }

  // Best first, then the alternatives by score
  const ordered = [found[0], ...found.slice(1).sort((x, y) => y.score - x.score)].filter(Boolean)
  const options: RiffHarmonization[] = ordered.map(({ path, score }) => {
    const harmonized: HarmonizedChord[] = path.map((c, s) => {
      const segment = segments[s]
      const fit = ctx.fit[s][c]
      return {
        chord: candidates[c],
        bar: segment.bar,
        half: segment.half,
        startSec: segment.startSec,
        endSec: segment.endSec,
        fit: Math.max(0, Math.min(1, fit.chordToneShare)),
        reason: describeChord(ctx, s, c, s + 1 < path.length ? candidates[path[s + 1]] : null),
        empty: segment.noteCount === 0,
        isColor: ctx.isColor[c],
      }
    })
    const filled = harmonized.filter((h) => !h.empty)
    return {
      chords: harmonized,
      fit: filled.length ? filled.reduce((sum, h) => sum + h.fit, 0) / filled.length : 0,
      colorCount: harmonized.filter((h) => h.isColor).length,
      score,
    }
  })

  return { timing: features.segmentation.timing, options }
}
