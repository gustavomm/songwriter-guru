// ─────────────────────────────────────────────────────────────────────────────
// Simple MIDI Note Player using Web Audio API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert MIDI note number to frequency in Hz
 * A4 (MIDI 69) = 440 Hz
 */
function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Convert note name to MIDI number (e.g., "C4" -> 60, "A#3" -> 58)
 * Default octave is 4 if not specified
 */
function noteNameToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    'C': 0, 'C#': 1, 'Db': 1,
    'D': 2, 'D#': 3, 'Eb': 3,
    'E': 4, 'Fb': 4, 'E#': 5,
    'F': 5, 'F#': 6, 'Gb': 6,
    'G': 7, 'G#': 8, 'Ab': 8,
    'A': 9, 'A#': 10, 'Bb': 10,
    'B': 11, 'Cb': 11, 'B#': 0,
  }

  // Parse note name and octave
  const match = noteName.match(/^([A-Ga-g][#b]?)(\d)?$/)
  if (!match) return 60 // Default to middle C

  const note = match[1].charAt(0).toUpperCase() + match[1].slice(1)
  const octave = match[2] ? parseInt(match[2]) : 4

  const semitone = noteMap[note] ?? 0
  return (octave + 1) * 12 + semitone
}

/**
 * Simple synth using Web Audio API oscillator + envelope
 */
class MidiPlayer {
  private audioContext: AudioContext | null = null
  private masterGain: GainNode | null = null
  private compressor: DynamicsCompressorNode | null = null
  private activeOscillators: Map<number, { osc: OscillatorNode; gain: GainNode }> = new Map()
  private isPlayingSequence = false
  private sequenceAbortController: AbortController | null = null
  private droneOscillators: { osc: OscillatorNode; osc2: OscillatorNode; gain: GainNode } | null = null
  private isPlayingScale = false
  private scaleAbortController: AbortController | null = null

  private getContext(): AudioContext {
    if (!this.audioContext) {
      this.audioContext = new AudioContext()
      
      // Create master gain to control overall volume
      this.masterGain = this.audioContext.createGain()
      this.masterGain.gain.value = 0.7
      
      // Create compressor to prevent clipping when multiple notes play
      this.compressor = this.audioContext.createDynamicsCompressor()
      this.compressor.threshold.value = -24
      this.compressor.knee.value = 30
      this.compressor.ratio.value = 12
      this.compressor.attack.value = 0.003
      this.compressor.release.value = 0.25
      
      // Chain: sources -> masterGain -> compressor -> destination
      this.masterGain.connect(this.compressor)
      this.compressor.connect(this.audioContext.destination)
    }
    return this.audioContext
  }

  /**
   * Get the master output node (for connecting oscillators)
   */
  private getMasterOutput(): AudioNode {
    this.getContext() // Ensure context is initialized
    return this.masterGain!
  }

  /**
   * Play a single MIDI note
   */
  playNote(midi: number, durationMs: number = 300, velocity: number = 0.5): void {
    const ctx = this.getContext()
    const masterOutput = this.getMasterOutput()
    const freq = midiToFrequency(midi)

    // Create oscillator (guitar-like tone using triangle wave)
    const osc = ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(freq, ctx.currentTime)

    // Create gain for envelope - reduced velocity for better mixing
    const gain = ctx.createGain()
    const now = ctx.currentTime
    const attackTime = 0.01
    const decayTime = 0.1
    const adjustedVelocity = velocity * 0.6 // Reduce to prevent clipping
    const sustainLevel = adjustedVelocity * 0.3
    const releaseTime = 0.2

    // ADSR envelope
    gain.gain.setValueAtTime(0, now)
    gain.gain.linearRampToValueAtTime(adjustedVelocity * 0.7, now + attackTime)
    gain.gain.linearRampToValueAtTime(sustainLevel, now + attackTime + decayTime)
    
    const releaseStart = now + durationMs / 1000
    gain.gain.setValueAtTime(sustainLevel, releaseStart)
    gain.gain.linearRampToValueAtTime(0, releaseStart + releaseTime)

    // Add a subtle second harmonic for warmth
    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(freq * 2, ctx.currentTime)
    
    const gain2 = ctx.createGain()
    gain2.gain.setValueAtTime(0, now)
    gain2.gain.linearRampToValueAtTime(adjustedVelocity * 0.15, now + attackTime)
    gain2.gain.linearRampToValueAtTime(adjustedVelocity * 0.05, now + attackTime + decayTime)
    gain2.gain.setValueAtTime(adjustedVelocity * 0.05, releaseStart)
    gain2.gain.linearRampToValueAtTime(0, releaseStart + releaseTime)

    // Connect nodes to master output (through compressor)
    osc.connect(gain)
    osc2.connect(gain2)
    gain.connect(masterOutput)
    gain2.connect(masterOutput)

    // Start and stop
    osc.start(now)
    osc2.start(now)
    
    const stopTime = releaseStart + releaseTime + 0.1
    osc.stop(stopTime)
    osc2.stop(stopTime)
  }

  /**
   * Play a sequence of notes with timing
   */
  async playSequence(
    notes: Array<{ midi: number; startSec: number; endSec: number; velocity?: number }>,
    onNoteStart?: (index: number) => void,
    onComplete?: () => void
  ): Promise<void> {
    if (this.isPlayingSequence) {
      this.stopSequence()
      return
    }

    if (notes.length === 0) {
      onComplete?.()
      return
    }

    this.isPlayingSequence = true
    this.sequenceAbortController = new AbortController()

    // Sort notes by start time
    const sortedNotes = [...notes].sort((a, b) => a.startSec - b.startSec)
    const startTime = sortedNotes[0].startSec

    try {
      for (let i = 0; i < sortedNotes.length; i++) {
        if (this.sequenceAbortController.signal.aborted) break

        const note = sortedNotes[i]
        const delay = (note.startSec - startTime) * 1000
        const duration = (note.endSec - note.startSec) * 1000

        // Wait until it's time to play this note
        if (i === 0) {
          // First note plays immediately
        } else {
          const prevNote = sortedNotes[i - 1]
          const waitTime = (note.startSec - prevNote.startSec) * 1000
          await this.sleep(waitTime, this.sequenceAbortController.signal)
        }

        if (this.sequenceAbortController.signal.aborted) break

        onNoteStart?.(i)
        this.playNote(note.midi, Math.max(duration, 100), note.velocity ?? 0.5)
      }

      // Wait for last note to finish
      if (!this.sequenceAbortController.signal.aborted) {
        const lastNote = sortedNotes[sortedNotes.length - 1]
        const lastDuration = (lastNote.endSec - lastNote.startSec) * 1000
        await this.sleep(Math.max(lastDuration, 300), this.sequenceAbortController.signal)
      }
    } finally {
      this.isPlayingSequence = false
      this.sequenceAbortController = null
      onComplete?.()
    }
  }

  /**
   * Stop the currently playing sequence
   */
  stopSequence(): void {
    if (this.sequenceAbortController) {
      this.sequenceAbortController.abort()
    }
    this.isPlayingSequence = false
  }

  /**
   * Check if a sequence is currently playing
   */
  get isPlaying(): boolean {
    return this.isPlayingSequence
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, ms)
      signal?.addEventListener('abort', () => {
        clearTimeout(timeout)
        resolve()
      })
    })
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Scale Playback
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Convert scale notes to MIDI numbers, ensuring they are ascending.
   * Handles octave wrapping (e.g., A-B-C-D-E-F-G needs C-G to be in the next octave)
   */
  private scaleNotesToMidi(notes: string[], startOctave: number): number[] {
    if (notes.length === 0) return []

    const midiNotes: number[] = []
    let currentOctave = startOctave
    let prevMidi = -1

    for (const note of notes) {
      let midi = noteNameToMidi(note + currentOctave)

      // If this note is lower than the previous, bump up the octave
      if (prevMidi !== -1 && midi <= prevMidi) {
        currentOctave++
        midi = noteNameToMidi(note + currentOctave)
      }

      midiNotes.push(midi)
      prevMidi = midi
    }

    return midiNotes
  }

  /**
   * Play a musical scale (array of note names like ["A", "B", "C", "D", "E", "F", "G"])
   * Automatically handles octave wrapping to ensure ascending pitch
   */
  async playScale(
    notes: string[],
    octave: number = 4,
    noteDurationMs: number = 300,
    onComplete?: () => void
  ): Promise<void> {
    if (this.isPlayingScale) {
      this.stopScale()
      return
    }

    if (notes.length === 0) {
      onComplete?.()
      return
    }

    this.isPlayingScale = true
    this.scaleAbortController = new AbortController()

    // Convert notes to MIDI with proper octave handling
    const midiNotes = this.scaleNotesToMidi(notes, octave)

    try {
      for (const midi of midiNotes) {
        if (this.scaleAbortController.signal.aborted) break

        this.playNote(midi, noteDurationMs, 0.4)
        await this.sleep(noteDurationMs * 0.8, this.scaleAbortController.signal)
      }

      // Play root an octave higher to complete the scale
      if (!this.scaleAbortController.signal.aborted && midiNotes.length > 0) {
        const rootMidiHigher = midiNotes[0] + 12
        this.playNote(rootMidiHigher, noteDurationMs * 1.5, 0.4)
        await this.sleep(noteDurationMs * 1.5, this.scaleAbortController.signal)
      }
    } finally {
      this.isPlayingScale = false
      this.scaleAbortController = null
      onComplete?.()
    }
  }

  /**
   * Stop the currently playing scale
   */
  stopScale(): void {
    if (this.scaleAbortController) {
      this.scaleAbortController.abort()
    }
    this.isPlayingScale = false
  }

  /**
   * Check if a scale is currently playing
   */
  get isScalePlaying(): boolean {
    return this.isPlayingScale
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Chord Playback (simultaneous notes)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Play a chord (multiple notes simultaneously).
   * Notes are played with staggered timing for a more natural strummed feel.
   */
  playChord(
    notes: string[],
    octave: number = 3,
    durationMs: number = 800,
    velocity: number = 0.35
  ): void {
    if (notes.length === 0) return

    // Convert notes to MIDI with proper ascending order
    const midiNotes = this.scaleNotesToMidi(notes, octave)

    // Play each note with slight stagger for strummed effect
    const staggerMs = 20 // 20ms between notes for natural feel
    midiNotes.forEach((midi, index) => {
      setTimeout(() => {
        this.playNote(midi, durationMs, velocity)
      }, index * staggerMs)
    })
  }

  /**
   * Play a chord by symbol (e.g., "Cmaj7", "Am", "G7").
   * Uses Tonal to get chord notes, then plays them.
   */
  playChordBySymbol(
    symbol: string,
    octave: number = 3,
    durationMs: number = 800,
    velocity: number = 0.35
  ): void {
    // This is a convenience method - the actual chord lookup
    // should be done in the component using Tonal.Chord.get()
    // Method exists for future use
    void symbol
  }

  // ─────────────────────────────────────────────────────────────────────────────
  // Drone Playback (sustained bass note)
  // ─────────────────────────────────────────────────────────────────────────────

  /**
   * Start a sustained drone on the given tonic note
   * Uses a warm, low tone that sits nicely under melodies
   */
  startDrone(tonic: string, octave: number = 2, volume: number = 0.25): void {
    // Stop any existing drone first
    this.stopDrone()

    const ctx = this.getContext()
    const masterOutput = this.getMasterOutput()
    const midi = noteNameToMidi(tonic + octave)
    const freq = midiToFrequency(midi)

    // Main oscillator - sine wave for warm bass
    const osc = ctx.createOscillator()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(freq, ctx.currentTime)

    // Second oscillator - octave higher, quieter for presence
    const osc2 = ctx.createOscillator()
    osc2.type = 'sine'
    osc2.frequency.setValueAtTime(freq * 2, ctx.currentTime)

    // Gain node with slow fade-in
    const gain = ctx.createGain()
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.5)

    // Connect: oscillators -> gain -> master output
    osc.connect(gain)
    osc2.connect(gain)
    // Make the second oscillator quieter
    const gain2 = ctx.createGain()
    gain2.gain.value = 0.3
    osc2.disconnect()
    osc2.connect(gain2)
    gain2.connect(gain)

    gain.connect(masterOutput)

    // Start oscillators
    osc.start()
    osc2.start()

    this.droneOscillators = { osc, osc2, gain }
  }

  /**
   * Stop the drone with a fade-out
   */
  stopDrone(): void {
    if (!this.droneOscillators) return

    const { osc, osc2, gain } = this.droneOscillators
    const ctx = this.getContext()

    // Fade out over 0.3 seconds
    gain.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.3)

    // Stop oscillators after fade
    setTimeout(() => {
      try {
        osc.stop()
        osc2.stop()
      } catch {
        // Already stopped
      }
    }, 350)

    this.droneOscillators = null
  }

  /**
   * Check if drone is currently playing
   */
  get isDronePlaying(): boolean {
    return this.droneOscillators !== null
  }

  /**
   * Toggle drone on/off
   */
  toggleDrone(tonic: string, octave: number = 2, volume: number = 0.25): boolean {
    if (this.isDronePlaying) {
      this.stopDrone()
      return false
    } else {
      this.startDrone(tonic, octave, volume)
      return true
    }
  }
}

// Export singleton instance
export const midiPlayer = new MidiPlayer()
