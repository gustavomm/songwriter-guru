/**
 * Chord utility functions for parsing and transposing chords
 */

/**
 * Extract chord tones from a chord symbol for playback.
 * Simple parsing - extracts root and basic quality.
 */
export function getChordTones(chordSymbol: string): string[] {
  // Parse common chord patterns
  const match = chordSymbol.match(/^([A-G][#b]?)(.*)$/)
  if (!match) return ['C', 'E', 'G'] // Fallback

  const root = match[1]
  const quality = match[2]

  // Get intervals based on quality
  const intervals = getIntervalsForQuality(quality)

  // Convert intervals to note names (simplified - just returns chord tones)
  return intervals.map((semitones) => transposeNote(root, semitones))
}

/**
 * Get semitone intervals for a chord quality.
 */
export function getIntervalsForQuality(quality: string): number[] {
  // Major triad
  if (!quality || quality === 'M' || quality === 'maj') {
    return [0, 4, 7]
  }
  // Minor triad
  if (quality === 'm' || quality === 'min') {
    return [0, 3, 7]
  }
  // Dominant 7
  if (quality === '7') {
    return [0, 4, 7, 10]
  }
  // Major 7
  if (quality === 'maj7' || quality === 'M7') {
    return [0, 4, 7, 11]
  }
  // Minor 7
  if (quality === 'm7' || quality === 'min7') {
    return [0, 3, 7, 10]
  }
  // Diminished
  if (quality === 'dim' || quality === '°') {
    return [0, 3, 6]
  }
  // Half-diminished
  if (quality === 'm7b5' || quality === 'ø7' || quality === 'ø') {
    return [0, 3, 6, 10]
  }
  // Augmented
  if (quality === 'aug' || quality === '+') {
    return [0, 4, 8]
  }
  // sus4
  if (quality === 'sus4') {
    return [0, 5, 7]
  }
  // sus2
  if (quality === 'sus2') {
    return [0, 2, 7]
  }

  // Default to major triad
  return [0, 4, 7]
}

/**
 * Transpose a note by semitones (simplified).
 */
export function transposeNote(note: string, semitones: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const flatToSharp: Record<string, string> = {
    Db: 'C#',
    Eb: 'D#',
    Fb: 'E',
    Gb: 'F#',
    Ab: 'G#',
    Bb: 'A#',
    Cb: 'B',
  }

  // Normalize flats to sharps for lookup
  const normalizedNote = flatToSharp[note] || note
  const noteIndex = notes.indexOf(normalizedNote)

  if (noteIndex === -1) return note // Fallback

  const newIndex = (noteIndex + semitones + 12) % 12
  return notes[newIndex]
}
