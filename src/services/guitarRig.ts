// ─────────────────────────────────────────────────────────────────────────────
// Guitar rig: recorded electric guitar samples through a Jubilee-style amp
// Signal path: samples -> pickup EQ -> single-coil resonance -> amp (two preamp stages,
// bass/middle/treble, power stage, presence, 4x12 cab) or bypass -> room -> limiter
// ─────────────────────────────────────────────────────────────────────────────

import {
  GUITAR_SAMPLES,
  PICKUP_EQ,
  driveToGain,
  knobTo,
  makeupGain,
  nearestSample,
  playbackRate,
  tubeCurve,
  type ToneSettings,
} from './guitarTone'

const SAMPLE_PATH = `${import.meta.env.BASE_URL}samples/guitar-electric/`

/**
 * A 4x12-style cabinet impulse: a click rendered through speaker-shaped filters, plus a few
 * tiny reflections for the mic and cone smear.
 */
async function renderCabinetIR(sampleRate: number): Promise<AudioBuffer> {
  const length = 2048
  const off = new OfflineAudioContext(1, length, sampleRate)
  const impulse = off.createBuffer(1, length, sampleRate)
  const d = impulse.getChannelData(0)
  d[0] = 1
  d[Math.round(sampleRate * 0.0007)] = 0.28
  d[Math.round(sampleRate * 0.0019)] = -0.14
  d[Math.round(sampleRate * 0.0031)] = 0.06

  const src = off.createBufferSource()
  src.buffer = impulse
  const filter = (type: BiquadFilterType, freq: number, q: number, gain = 0) => {
    const b = off.createBiquadFilter()
    b.type = type
    b.frequency.value = freq
    b.Q.value = q
    b.gain.value = gain
    return b
  }
  const filters = [
    filter('highpass', 75, 0.9),
    filter('highpass', 75, 0.6),
    filter('peaking', 115, 2.2, 4), // cab thump
    filter('peaking', 420, 1.0, -3), // less boxy
    filter('peaking', 1900, 1.2, 2.5),
    filter('peaking', 3300, 2.5, 5), // speaker cone peak
    filter('peaking', 5200, 2.0, -4),
    filter('lowpass', 5600, 0.8),
    filter('lowpass', 6200, 0.6),
  ]
  let prev: AudioNode = src
  for (const f of filters) {
    prev.connect(f)
    prev = f
  }
  prev.connect(off.destination)
  src.start()

  const ir = await off.startRendering()
  const ch = ir.getChannelData(0)
  let energy = 0
  for (const v of ch) energy += v * v
  const norm = 0.5 / Math.sqrt(energy)
  for (let i = 0; i < ch.length; i++) ch[i] *= norm
  return ir
}

/** A short, dark stereo room so the guitar doesn't sound like it's in a closet */
function makeRoomIR(ctx: BaseAudioContext): AudioBuffer {
  const rate = ctx.sampleRate
  const length = Math.round(rate * 0.9)
  const buf = ctx.createBuffer(2, length, rate)
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c)
    let lp = 0
    for (let i = 0; i < length; i++) {
      lp += 0.35 * (Math.random() * 2 - 1 - lp)
      d[i] = i < rate * 0.008 ? 0 : lp * Math.exp(-i / (rate * 0.16))
    }
  }
  return buf
}

export class GuitarRig {
  private samples = new Map<number, AudioBuffer>()
  private loading: Promise<void> | null = null
  private readonly input: GainNode
  private readonly pickupLow: BiquadFilterNode
  private readonly pickupMid: BiquadFilterNode
  private readonly pickupHigh: BiquadFilterNode
  private readonly preamp: WaveShaperNode
  private readonly bass: BiquadFilterNode
  private readonly mid: BiquadFilterNode
  private readonly treble: BiquadFilterNode
  private readonly presence: BiquadFilterNode
  private readonly makeup: GainNode
  private readonly ampSend: GainNode
  private readonly bypass: GainNode
  private readonly roomSend: GainNode

  constructor(private readonly ctx: AudioContext) {
    const gain = (v: number) => {
      const g = ctx.createGain()
      g.gain.value = v
      return g
    }
    const filter = (type: BiquadFilterType, freq: number, q = 0.707, g = 0) => {
      const b = ctx.createBiquadFilter()
      b.type = type
      b.frequency.value = freq
      b.Q.value = q
      b.gain.value = g
      return b
    }
    const shaper = (curve?: Float32Array<ArrayBuffer>) => {
      const s = ctx.createWaveShaper()
      s.oversample = '4x'
      if (curve) s.curve = curve
      return s
    }
    const chain = (...nodes: AudioNode[]) => {
      for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1])
    }

    // Output: level-matched to the old synth, with a gentle limiter for chords
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -10
    limiter.knee.value = 6
    limiter.ratio.value = 8
    limiter.attack.value = 0.003
    limiter.release.value = 0.2
    const master = gain(0.65)
    chain(master, limiter, ctx.destination)

    // Guitar: pickup position EQ, then single-coil resonance and cable load
    this.input = gain(1)
    this.pickupLow = filter('lowshelf', 250)
    this.pickupMid = filter('peaking', 1000, 0.9)
    this.pickupHigh = filter('highshelf', 2500)
    const coil = filter('peaking', 3600, 1.6, 4)
    const cable = filter('lowpass', 7500, 0.6)
    chain(this.input, this.pickupLow, this.pickupMid, this.pickupHigh, coil, cable)

    // Amp
    this.preamp = shaper()
    this.bass = filter('lowshelf', 110)
    this.mid = filter('peaking', 650, 0.7)
    this.treble = filter('highshelf', 2400)
    this.presence = filter('highshelf', 4200)
    this.makeup = gain(1)
    this.ampSend = gain(1)
    const cab = ctx.createConvolver()
    cab.normalize = false
    chain(
      cable,
      this.ampSend,
      filter('highpass', 60),
      gain(0.25), // scale into the curve's -4..4 input range
      this.preamp,
      filter('highpass', 110, 0.6), // tighten the lows before the second stage
      filter('highshelf', 1800, 0.7, 2),
      gain(0.25),
      shaper(tubeCurve(1.8, 0.15)),
      this.bass,
      this.mid,
      this.treble,
      gain(0.25),
      shaper(tubeCurve(1.3, 0.05)), // power amp
      this.presence,
      cab,
      this.makeup
    )
    renderCabinetIR(ctx.sampleRate)
      .then((ir) => (cab.buffer = ir))
      .catch(() => {
        // Without a cab IR the convolver is silent: fall back to the amp's raw output
        this.presence.disconnect()
        this.presence.connect(this.makeup)
      })

    this.bypass = gain(0)
    cable.connect(this.bypass)

    const dry = gain(1)
    this.makeup.connect(dry)
    this.bypass.connect(dry)
    dry.connect(master)
    this.roomSend = gain(0.1)
    const room = ctx.createConvolver()
    room.buffer = makeRoomIR(ctx)
    chain(dry, this.roomSend, room, master)
  }

  /** Fetch and decode the samples once; safe to call repeatedly */
  load(): Promise<void> {
    if (!this.loading) {
      this.loading = Promise.all(
        Object.entries(GUITAR_SAMPLES).map(async ([midi, name]) => {
          const res = await fetch(`${SAMPLE_PATH}${name}.mp3`)
          if (!res.ok) throw new Error(`Couldn't load guitar sample ${name}`)
          const buf = await this.ctx.decodeAudioData(await res.arrayBuffer())
          this.samples.set(Number(midi), normalize(buf))
        })
      ).then(
        () => undefined,
        (err) => {
          this.loading = null // let a later play retry
          throw err
        }
      )
    }
    return this.loading
  }

  get isLoaded(): boolean {
    return this.samples.size === Object.keys(GUITAR_SAMPLES).length
  }

  apply(tone: ToneSettings): void {
    const t = this.ctx.currentTime
    const set = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.02)
    const preGain = driveToGain(tone.drive)
    this.preamp.curve = tubeCurve(preGain, 0.22)
    set(this.makeup.gain, makeupGain(preGain))
    set(this.bass.gain, knobTo(tone.bass, -10, 8))
    set(this.mid.gain, knobTo(tone.mid, -12, 6))
    set(this.treble.gain, knobTo(tone.treble, -12, 8))
    set(this.presence.gain, knobTo(tone.presence, -6, 8))
    set(this.roomSend.gain, knobTo(tone.room, 0, 0.35))
    set(this.ampSend.gain, tone.amp ? 1 : 0)
    set(this.bypass.gain, tone.amp ? 0 : 0.9)
    const eq = PICKUP_EQ[tone.pickup]
    set(this.pickupLow.gain, eq.low)
    this.pickupMid.frequency.setValueAtTime(eq.midHz, t)
    set(this.pickupMid.gain, eq.mid)
    set(this.pickupHigh.gain, eq.high)
  }

  /**
   * Play one note. Returns false if the samples aren't loaded yet, so the caller can fall back.
   */
  playNote(
    midi: number,
    durationMs: number,
    velocity: number,
    when = this.ctx.currentTime
  ): boolean {
    const sampleMidi = nearestSample(midi, this.samples.keys())
    if (sampleMidi === null) return false

    const src = this.ctx.createBufferSource()
    src.buffer = this.samples.get(sampleMidi)!
    src.playbackRate.value = playbackRate(midi, sampleMidi)

    const env = this.ctx.createGain()
    const level = 0.35 + velocity * 0.9
    const end = when + durationMs / 1000
    env.gain.setValueAtTime(level, when)
    env.gain.setValueAtTime(level, end)
    env.gain.setTargetAtTime(0, end, 0.04) // let go of the string

    src.connect(env)
    env.connect(this.input)
    src.start(when)
    src.stop(end + 0.4)
    src.onended = () => env.disconnect()
    return true
  }
}

/** Peak-normalize a note so the set plays evenly */
function normalize(buf: AudioBuffer): AudioBuffer {
  let peak = 0
  for (let c = 0; c < buf.numberOfChannels; c++) {
    for (const v of buf.getChannelData(c)) peak = Math.max(peak, Math.abs(v))
  }
  const k = 0.45 / (peak || 1)
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c)
    for (let i = 0; i < ch.length; i++) ch[i] *= k
  }
  return buf
}
