import { midiPlayer } from '../../services/midiPlayer'

/**
 * Strum a voicing low string to high, like a downstroke, so a chord shape sounds the way
 * it would on a guitar instead of as a block chord.
 */
export function strum(midiNotes: number[], { staggerMs = 28, durationMs = 1400 } = {}) {
  midiNotes.forEach((midi, i) => {
    window.setTimeout(
      () => midiPlayer.playNote(midi, durationMs - i * staggerMs, 0.55 - i * 0.03),
      i * staggerMs
    )
  })
}
