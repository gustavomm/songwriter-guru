// ─────────────────────────────────────────────────────────────────────────────
// Note Utilities: Pure functions for MIDI/frequency/note name conversions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert MIDI note number to frequency in Hz
 * A4 (MIDI 69) = 440 Hz
 */
export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/**
 * Convert note name to MIDI number (e.g., "C4" -> 60, "A#3" -> 58)
 * Default octave is 4 if not specified
 */
export function noteNameToMidi(noteName: string): number {
  const noteMap: Record<string, number> = {
    C: 0,
    'C#': 1,
    Db: 1,
    D: 2,
    'D#': 3,
    Eb: 3,
    E: 4,
    Fb: 4,
    'E#': 5,
    F: 5,
    'F#': 6,
    Gb: 6,
    G: 7,
    'G#': 8,
    Ab: 8,
    A: 9,
    'A#': 10,
    Bb: 10,
    B: 11,
    Cb: 11,
    'B#': 0,
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
 * Convert MIDI number to note name (e.g., 60 -> "C4")
 */
export function midiToNoteName(midi: number): string {
  const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const octave = Math.floor(midi / 12) - 1
  const noteName = noteNames[midi % 12]
  return `${noteName}${octave}`
}
