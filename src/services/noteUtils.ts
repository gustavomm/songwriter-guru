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

/**
 * Convert a note name (without octave) to its pitch class (0-11).
 * C = 0, C# = 1, D = 2, ..., B = 11
 * Handles flats by converting to sharp equivalents.
 */
export function noteToPitchClass(note: string): number {
  const flatToSharp: Record<string, string> = {
    Db: 'C#',
    Eb: 'D#',
    Fb: 'E',
    Gb: 'F#',
    Ab: 'G#',
    Bb: 'A#',
    Cb: 'B',
  }
  const normalized = flatToSharp[note] || note
  const noteMap: Record<string, number> = {
    C: 0,
    'C#': 1,
    D: 2,
    'D#': 3,
    E: 4,
    F: 5,
    'F#': 6,
    G: 7,
    'G#': 8,
    A: 9,
    'A#': 10,
    B: 11,
  }
  return noteMap[normalized] ?? 0
}

/**
 * Convert chord notes to MIDI values with consistent voicing.
 *
 * This function ensures all chords are voiced in a similar register regardless
 * of root note. It dynamically adjusts the octave based on the root pitch class:
 * - Roots C-F (pitch class 0-5): use baseOctave + 1 (roots around C4-F4)
 * - Roots F#-B (pitch class 6-11): use baseOctave (roots around F#3-B3)
 *
 * This keeps all chord roots within roughly an octave range (F3 to F4),
 * preventing chords with high roots (A, B) from sounding much brighter
 * than chords with low roots (C, D).
 *
 * @param notes - Array of note names (e.g., ["C", "E", "G"])
 * @param baseOctave - Base octave for voicing (default 3)
 * @returns Array of MIDI note numbers
 */
export function chordNotesToMidi(notes: string[], baseOctave: number = 3): number[] {
  if (notes.length === 0) return []

  const rootPitchClass = noteToPitchClass(notes[0])

  // Adjust octave based on root pitch class to keep chords in consistent range:
  // - Roots C-F (pitch class 0-5): use octave 4 (C4=60 to F4=65)
  // - Roots F#-B (pitch class 6-11): use octave 3 (F#3=54 to B3=59)
  // This ensures all root notes fall within the range MIDI 54-65 (~F3 to F4)
  const effectiveOctave = rootPitchClass <= 5 ? baseOctave + 1 : baseOctave
  const rootMidi = noteNameToMidi(notes[0] + effectiveOctave)

  // Calculate MIDI for each note based on interval from root
  return notes.map((note) => {
    const pitchClass = noteToPitchClass(note)
    // Calculate interval (0-11) from root, always positive
    let interval = pitchClass - rootPitchClass
    if (interval < 0) interval += 12
    return rootMidi + interval
  })
}
