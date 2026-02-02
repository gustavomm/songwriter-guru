export type ChordSource =
  | 'diatonic'
  | 'secondary_dominant'
  | 'secondary_leading_tone'
  | 'substitute_dominant'
  | 'secondary_supertonic' // ii of temporary key
  | 'substitute_supertonic' // supertonic of tritone sub
  | 'borrowed'

export type HarmonicFunction = 'T' | 'SD' | 'D'

export interface ChordSuggestion {
  // Identification
  /** Canonical symbol (e.g., "Bm7b5") - stable for lookup */
  id: string
  /** Display symbol (e.g., "Bø7") - for UI */
  symbol: string

  // Harmonic metadata
  roman?: string
  /** Harmonic function: Tonic, Subdominant/Predominant, or Dominant */
  function?: HarmonicFunction
  /** Scale degree (0-6 for diatonic chords) */
  degree?: number
  /** For applied chords, the target chord they resolve to (e.g., V/ii -> "ii") */
  resolvesToRoman?: string

  // Source classification
  source: ChordSource
  /** Additional sources if chord belongs to multiple categories */
  sources?: ChordSource[]
  sourceDetail?: string
  /** Additional source details if chord belongs to multiple categories */
  sourceDetails?: string[]

  // Chord data
  chordTones: string[]

  // Scores
  /** How well the riff notes align with this chord (0-1) */
  supportScore: number
  /** "Weirdness" or color score for adventurous suggestions (0-1) */
  colorScore: number
}

export interface ChordSuggestionResult {
  // Categorized arrays
  diatonic: ChordSuggestion[]
  secondary: ChordSuggestion[]
  borrowed: ChordSuggestion[]
  /** All suggestions sorted by combined score */
  ranked: ChordSuggestion[]

  // Indexes for progression building
  /** Canonical symbol lookup */
  byId: Map<string, ChordSuggestion>
  /** Roman numeral -> chords (e.g., "V/vi" -> [A7, ...]) */
  byRoman: Map<string, ChordSuggestion[]>
  /** Harmonic function -> chords */
  byFunction: Map<HarmonicFunction, ChordSuggestion[]>
  /** Target roman -> applied chords that resolve to it */
  byResolvesTo: Map<string, ChordSuggestion[]>
}
