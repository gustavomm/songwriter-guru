// ─────────────────────────────────────────────────────────────────────────────
// Guitar tone settings: a Strat into a Silver Jubilee-style amp
// Pure helpers shared by the audio graph (guitarRig.ts) and the tone controls UI.
// ─────────────────────────────────────────────────────────────────────────────

export type PickupPosition = 1 | 2 | 3 | 4 | 5
export type ToneKnob = 'drive' | 'bass' | 'mid' | 'treble' | 'presence' | 'room'

export interface ToneSettings {
  /** false plays the guitar straight into the desk (no amp, no cab) */
  amp: boolean
  /** Strat 5-way selector: 1 = neck … 5 = bridge */
  pickup: PickupPosition
  drive: number
  bass: number
  mid: number
  treble: number
  presence: number
  room: number
}

export const DEFAULT_TONE: ToneSettings = {
  amp: true,
  pickup: 5,
  drive: 2,
  bass: 6,
  mid: 4.5,
  treble: 6,
  presence: 6,
  room: 4,
}

/**
 * Knobs use amp-style 0–10 numbers, but each one only turns as far as it still sounds
 * like a usable guitar tone. Outside these windows it gets fizzy, boomy or honky.
 */
export const KNOB_RANGES: Record<ToneKnob, { label: string; min: number; max: number }> = {
  drive: { label: 'Drive', min: 0, max: 5 },
  bass: { label: 'Bass', min: 3, max: 7.5 },
  mid: { label: 'Middle', min: 3, max: 7 },
  treble: { label: 'Treble', min: 4, max: 8 },
  presence: { label: 'Presence', min: 4, max: 8 },
  room: { label: 'Room', min: 0, max: 6 },
}

export const PICKUPS: { position: PickupPosition; name: string }[] = [
  { position: 1, name: 'Neck' },
  { position: 2, name: 'Neck + middle' },
  { position: 3, name: 'Middle' },
  { position: 4, name: 'Middle + bridge' },
  { position: 5, name: 'Bridge' },
]

/**
 * Rough tonal stand-ins for each pickup position, applied as EQ to the recorded samples:
 * low shelf at 250 Hz, a peak/dip in the mids, high shelf at 2.5 kHz (all in dB).
 */
export const PICKUP_EQ: Record<
  PickupPosition,
  { low: number; midHz: number; mid: number; high: number }
> = {
  1: { low: 2, midHz: 900, mid: 0, high: -6 },
  2: { low: 0, midHz: 1100, mid: -4, high: -1 },
  3: { low: 0, midHz: 1000, mid: 0, high: 0 },
  4: { low: -2, midHz: 900, mid: -4, high: 2 },
  5: { low: -5, midHz: 1500, mid: 2, high: 3 },
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Bring any stored or partial settings back inside the usable ranges */
export function sanitizeTone(input: Partial<ToneSettings> | null | undefined): ToneSettings {
  const out: ToneSettings = { ...DEFAULT_TONE }
  if (!input || typeof input !== 'object') return out
  if (typeof input.amp === 'boolean') out.amp = input.amp
  if ([1, 2, 3, 4, 5].includes(input.pickup as number)) out.pickup = input.pickup as PickupPosition
  for (const knob of Object.keys(KNOB_RANGES) as ToneKnob[]) {
    const v = input[knob]
    if (typeof v === 'number' && Number.isFinite(v)) {
      out[knob] = clamp(v, KNOB_RANGES[knob].min, KNOB_RANGES[knob].max)
    }
  }
  return out
}

/** Map a 0–10 knob onto a range in dB (or any linear unit) */
export const knobTo = (value: number, lo: number, hi: number) => lo + (value / 10) * (hi - lo)

/** Gain of the first preamp stage for a drive setting */
export const driveToGain = (drive: number) => 1 + drive * drive * 0.55

/** Output trim so turning up the drive adds grit without getting much louder */
export const makeupGain = (preampGain: number) => 1.4 / Math.pow(preampGain, 0.64)

/**
 * A tube-like transfer curve: tanh with a bias offset so the two halves clip differently,
 * which adds the even harmonics a triode stage has. Covers input -4..4 so chords don't hit
 * the WaveShaper's hard edge (feed it through a 0.25 gain).
 */
export function tubeCurve(gain: number, bias: number, size = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(size)
  const offset = Math.tanh(bias)
  for (let i = 0; i < size; i++) {
    const x = ((i / (size - 1)) * 2 - 1) * 4
    curve[i] = Math.tanh(gain * x + bias) - offset
  }
  return curve
}

// ─────────────────────────────────────────────────────────────────────────────
// Samples
// ─────────────────────────────────────────────────────────────────────────────

/** Recorded notes in public/samples/guitar-electric, by MIDI number */
export const GUITAR_SAMPLES: Record<number, string> = {
  37: 'Cs2',
  40: 'E2',
  42: 'Fs2',
  45: 'A2',
  48: 'C3',
  51: 'Ds3',
  54: 'Fs3',
  57: 'A3',
  60: 'C4',
  63: 'Ds4',
  66: 'Fs4',
  69: 'A4',
  72: 'C5',
  75: 'Ds5',
  78: 'Fs5',
  81: 'A5',
  84: 'C6',
}

/** The recorded note closest to `midi`; ties go to the lower sample (repitching up sounds better) */
export function nearestSample(midi: number, available: Iterable<number>): number | null {
  let best: number | null = null
  for (const m of available) {
    if (
      best === null ||
      Math.abs(m - midi) < Math.abs(best - midi) ||
      (Math.abs(m - midi) === Math.abs(best - midi) && m < best)
    ) {
      best = m
    }
  }
  return best
}

/** Playback rate that shifts a sample recorded at `sampleMidi` to `midi` */
export const playbackRate = (midi: number, sampleMidi: number) =>
  Math.pow(2, (midi - sampleMidi) / 12)

// ─────────────────────────────────────────────────────────────────────────────
// Persistence
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'riff-harmonics:tone'

export function loadTone(): ToneSettings {
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY)
    return sanitizeTone(raw ? JSON.parse(raw) : null)
  } catch {
    return { ...DEFAULT_TONE }
  }
}

export function saveTone(settings: ToneSettings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch {
    // Storage blocked (private mode etc.): settings just won't persist
  }
}
