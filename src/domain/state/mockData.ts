import type {
  TranscriptionResult,
  RiffFeatures,
  HarmonyAnalysisResult,
  ChordSuggestionResult,
  ChordSuggestion,
  HarmonicFunction,
  ProgressionSuggestion,
  ProgressionSlot,
} from '../types'
import type { AppState } from './AppState'

// ─────────────────────────────────────────────────────────────────────────────
// Mock Transcription (A minor pentatonic riff)
// ─────────────────────────────────────────────────────────────────────────────

export const mockTranscription: TranscriptionResult = {
  notes: [
    { startSec: 0.0, endSec: 0.3, midi: 57, velocity: 0.8 }, // A3
    { startSec: 0.3, endSec: 0.5, midi: 60, velocity: 0.7 }, // C4
    { startSec: 0.5, endSec: 0.8, midi: 62, velocity: 0.9 }, // D4
    { startSec: 0.8, endSec: 1.1, midi: 64, velocity: 0.85 }, // E4
    { startSec: 1.1, endSec: 1.5, midi: 67, velocity: 0.75 }, // G4
    { startSec: 1.5, endSec: 2.0, midi: 69, velocity: 0.9 }, // A4
  ],
  noteCount: 6,
  range: { minMidi: 57, maxMidi: 69 },
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Features
// ─────────────────────────────────────────────────────────────────────────────

export const mockFeatures: RiffFeatures = {
  // C=0, C#=1, D=2, D#=3, E=4, F=5, F#=6, G=7, G#=8, A=9, A#=10, B=11
  // A minor pentatonic: A(9), C(0), D(2), E(4), G(7)
  pcWeights: [0.15, 0, 0.12, 0, 0.18, 0, 0, 0.14, 0, 0.25, 0, 0],
  topPitchClasses: [9, 4, 0, 7, 2], // A, E, C, G, D
  lastNotePc: 9, // A
  bassPc: 9, // A
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Harmony Analysis
// ─────────────────────────────────────────────────────────────────────────────

export const mockHarmony: HarmonyAnalysisResult = {
  candidates: [
    {
      id: 'a-minor',
      tonic: 'A',
      mode: 'Minor',
      scaleNotes: ['A', 'B', 'C', 'D', 'E', 'F', 'G'],
      fitScore: 0.95,
      outOfScale: [],
    },
    {
      id: 'c-major',
      tonic: 'C',
      mode: 'Major',
      scaleNotes: ['C', 'D', 'E', 'F', 'G', 'A', 'B'],
      fitScore: 0.82,
      outOfScale: [],
    },
  ],
  selectedCandidateId: 'a-minor',
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Chord Suggestions (for A Aeolian)
// ─────────────────────────────────────────────────────────────────────────────

// Helper to build indexes
function buildMockIndexes(chords: ChordSuggestion[]): {
  byId: Map<string, ChordSuggestion>
  byRoman: Map<string, ChordSuggestion[]>
  byFunction: Map<HarmonicFunction, ChordSuggestion[]>
  byResolvesTo: Map<string, ChordSuggestion[]>
} {
  const byId = new Map<string, ChordSuggestion>()
  const byRoman = new Map<string, ChordSuggestion[]>()
  const byFunction = new Map<HarmonicFunction, ChordSuggestion[]>()
  const byResolvesTo = new Map<string, ChordSuggestion[]>()

  for (const chord of chords) {
    byId.set(chord.id, chord)

    if (chord.roman) {
      const existing = byRoman.get(chord.roman) || []
      existing.push(chord)
      byRoman.set(chord.roman, existing)
    }

    if (chord.function) {
      const existing = byFunction.get(chord.function) || []
      existing.push(chord)
      byFunction.set(chord.function, existing)
    }

    if (chord.resolvesToRoman) {
      const existing = byResolvesTo.get(chord.resolvesToRoman) || []
      existing.push(chord)
      byResolvesTo.set(chord.resolvesToRoman, existing)
    }
  }

  return { byId, byRoman, byFunction, byResolvesTo }
}

const mockDiatonic: ChordSuggestion[] = [
  {
    id: 'Am',
    symbol: 'Am',
    roman: 'i',
    function: 'T',
    degree: 0,
    source: 'diatonic',
    chordTones: ['A', 'C', 'E'],
    supportScore: 0.95,
    colorScore: 0.1,
  },
  {
    id: 'Dm',
    symbol: 'Dm',
    roman: 'iv',
    function: 'SD',
    degree: 3,
    source: 'diatonic',
    chordTones: ['D', 'F', 'A'],
    supportScore: 0.82,
    colorScore: 0.15,
  },
  {
    id: 'Em',
    symbol: 'Em',
    roman: 'v',
    function: 'D',
    degree: 4,
    source: 'diatonic',
    chordTones: ['E', 'G', 'B'],
    supportScore: 0.78,
    colorScore: 0.12,
  },
  {
    id: 'G',
    symbol: 'G',
    roman: 'VII',
    function: 'D',
    degree: 6,
    source: 'diatonic',
    chordTones: ['G', 'B', 'D'],
    supportScore: 0.75,
    colorScore: 0.18,
  },
  {
    id: 'C',
    symbol: 'C',
    roman: 'III',
    function: 'T',
    degree: 2,
    source: 'diatonic',
    chordTones: ['C', 'E', 'G'],
    supportScore: 0.72,
    colorScore: 0.2,
  },
  {
    id: 'F',
    symbol: 'F',
    roman: 'VI',
    function: 'SD',
    degree: 5,
    source: 'diatonic',
    chordTones: ['F', 'A', 'C'],
    supportScore: 0.68,
    colorScore: 0.22,
  },
]

const mockSecondary: ChordSuggestion[] = [
  {
    id: 'E7',
    symbol: 'E7',
    roman: 'V/i',
    function: 'D',
    resolvesToRoman: 'i',
    source: 'secondary_dominant',
    sourceDetail: 'dominant of Am',
    chordTones: ['E', 'G#', 'B', 'D'],
    supportScore: 0.7,
    colorScore: 0.45,
  },
  {
    id: 'A7',
    symbol: 'A7',
    roman: 'V/iv',
    function: 'D',
    resolvesToRoman: 'iv',
    source: 'secondary_dominant',
    sourceDetail: 'dominant of Dm',
    chordTones: ['A', 'C#', 'E', 'G'],
    supportScore: 0.65,
    colorScore: 0.5,
  },
  {
    id: 'B7',
    symbol: 'B7',
    roman: 'V/v',
    function: 'D',
    resolvesToRoman: 'v',
    source: 'secondary_dominant',
    sourceDetail: 'dominant of Em',
    chordTones: ['B', 'D#', 'F#', 'A'],
    supportScore: 0.55,
    colorScore: 0.55,
  },
]

const mockBorrowed: ChordSuggestion[] = [
  {
    id: 'D',
    symbol: 'D',
    roman: 'IV',
    function: 'SD',
    source: 'borrowed',
    sourceDetail: 'from A Dorian',
    chordTones: ['D', 'F#', 'A'],
    supportScore: 0.6,
    colorScore: 0.65,
  },
  {
    id: 'Fm',
    symbol: 'Fm',
    roman: 'iv',
    function: 'SD',
    source: 'borrowed',
    sourceDetail: 'from A Phrygian',
    chordTones: ['F', 'Ab', 'C'],
    supportScore: 0.45,
    colorScore: 0.75,
  },
  {
    id: 'Bb',
    symbol: 'Bb',
    roman: 'bII',
    function: 'SD',
    source: 'borrowed',
    sourceDetail: 'Neapolitan',
    chordTones: ['Bb', 'D', 'F'],
    supportScore: 0.4,
    colorScore: 0.85,
  },
]

// Combine and sort for ranked list
const allMockChords = [...mockDiatonic, ...mockSecondary, ...mockBorrowed]
const mockRanked = allMockChords.toSorted((a, b) => {
  const scoreA = a.supportScore * 0.7 + a.colorScore * 0.3
  const scoreB = b.supportScore * 0.7 + b.colorScore * 0.3
  return scoreB - scoreA
})

// Build indexes
const mockIndexes = buildMockIndexes(allMockChords)

export const mockChords: ChordSuggestionResult = {
  diatonic: mockDiatonic,
  secondary: mockSecondary,
  borrowed: mockBorrowed,
  ranked: mockRanked,
  byId: mockIndexes.byId,
  byRoman: mockIndexes.byRoman,
  byFunction: mockIndexes.byFunction,
  byResolvesTo: mockIndexes.byResolvesTo,
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock Progressions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper to create minimal slots for mock progressions.
 */
function createMockSlots(chords: string[], romans: string[]): ProgressionSlot[] {
  return chords.map((symbol, i) => {
    const roman = romans[i]
    // Find a chord from mockChords catalog if available
    const catalogChord = allMockChords.find((c) => c.symbol === symbol)
    const chosen: ChordSuggestion = catalogChord || {
      id: symbol,
      symbol,
      roman,
      source: 'diatonic',
      chordTones: [],
      supportScore: 0.5,
      colorScore: 0.3,
    }
    return {
      role: roman,
      chosen,
      alternatives: [], // Empty alternatives for mock data
    }
  })
}

export const mockProgressions: ProgressionSuggestion[] = [
  {
    chords: ['Am', 'G', 'F', 'E7'],
    romans: ['i', 'VII', 'VI', 'V/i'],
    slots: createMockSlots(['Am', 'G', 'F', 'E7'], ['i', 'VII', 'VI', 'V/i']),
    containsColorChord: true,
    containsSecondaryDominant: true,
    containsBorrowedChord: false,
    score: 0.92,
  },
  {
    chords: ['Am', 'Dm', 'G', 'C'],
    romans: ['i', 'iv', 'VII', 'III'],
    slots: createMockSlots(['Am', 'Dm', 'G', 'C'], ['i', 'iv', 'VII', 'III']),
    containsColorChord: false,
    containsSecondaryDominant: false,
    containsBorrowedChord: false,
    score: 0.88,
  },
  {
    chords: ['Am', 'F', 'C', 'G'],
    romans: ['i', 'VI', 'III', 'VII'],
    slots: createMockSlots(['Am', 'F', 'C', 'G'], ['i', 'VI', 'III', 'VII']),
    containsColorChord: false,
    containsSecondaryDominant: false,
    containsBorrowedChord: false,
    score: 0.85,
  },
  {
    chords: ['Am', 'D', 'F', 'E7'],
    romans: ['i', 'IV', 'VI', 'V/i'],
    slots: createMockSlots(['Am', 'D', 'F', 'E7'], ['i', 'IV', 'VI', 'V/i']),
    containsColorChord: true,
    containsSecondaryDominant: true,
    containsBorrowedChord: true,
    score: 0.82,
  },
  {
    chords: ['Am', 'Em', 'Dm', 'Am'],
    romans: ['i', 'v', 'iv', 'i'],
    slots: createMockSlots(['Am', 'Em', 'Dm', 'Am'], ['i', 'v', 'iv', 'i']),
    containsColorChord: false,
    containsSecondaryDominant: false,
    containsBorrowedChord: false,
    score: 0.78,
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// Complete Mock State (analyzed)
// ─────────────────────────────────────────────────────────────────────────────

export const mockAnalyzedState: AppState = {
  status: 'analyzed',
  recording: null, // Would have blob/url in real scenario
  error: null,
  transcription: mockTranscription,
  transcriptionProgress: 100,
  transcriptionMessage: 'Complete',
  features: mockFeatures,
  harmony: mockHarmony,
  chords: mockChords,
  progressions: mockProgressions,
}
