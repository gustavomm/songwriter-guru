import type {
  RecordingStatus,
  RecordingAsset,
  RecordingError,
  TranscriptionResult,
  RiffFeatures,
  HarmonyAnalysisResult,
  ChordSuggestionResult,
  ProgressionSuggestion,
} from '../types'

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────

export interface AppState {
  status: RecordingStatus
  recording: RecordingAsset | null
  error: RecordingError | null
  transcription: TranscriptionResult | null
  transcriptionProgress: number // 0-100
  transcriptionMessage: string | null
  features: RiffFeatures | null
  harmony: HarmonyAnalysisResult | null
  chords: ChordSuggestionResult | null
  progressions: ProgressionSuggestion[] | null
}

export const initialAppState: AppState = {
  status: 'idle',
  recording: null,
  error: null,
  transcription: null,
  transcriptionProgress: 0,
  transcriptionMessage: null,
  features: null,
  harmony: null,
  chords: null,
  progressions: null,
}

// ─────────────────────────────────────────────────────────────────────────────
// Actions
// ─────────────────────────────────────────────────────────────────────────────

export type AppAction =
  | { type: 'START_RECORDING' }
  | { type: 'STOP_RECORDING'; payload: RecordingAsset }
  | { type: 'START_DECODE' }
  | { type: 'START_TRANSCRIBE' }
  | { type: 'SET_TRANSCRIPTION_PROGRESS'; payload: { percent: number; message?: string } }
  | { type: 'TRANSCRIPTION_COMPLETE'; payload: TranscriptionResult }
  | {
      type: 'ANALYSIS_COMPLETE'
      payload: {
        transcription: TranscriptionResult
        features: RiffFeatures
        harmony: HarmonyAnalysisResult
        chords: ChordSuggestionResult | null
        progressions: ProgressionSuggestion[]
      }
    }
  | {
      type: 'SELECT_HARMONIC_FIELD'
      payload: {
        candidateId: string
        chords: ChordSuggestionResult
        progressions: ProgressionSuggestion[]
      }
    }
  | { type: 'SET_ERROR'; payload: RecordingError }
  | { type: 'RESET' }

// ─────────────────────────────────────────────────────────────────────────────
// Reducer
// ─────────────────────────────────────────────────────────────────────────────

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case 'START_RECORDING':
      return {
        ...initialAppState,
        status: 'recording',
      }

    case 'STOP_RECORDING':
      return {
        ...state,
        status: 'recorded',
        recording: action.payload,
      }

    case 'START_DECODE':
      return {
        ...state,
        status: 'decoding',
      }

    case 'START_TRANSCRIBE':
      return {
        ...state,
        status: 'transcribing',
        transcriptionProgress: 0,
        transcriptionMessage: 'Starting...',
      }

    case 'SET_TRANSCRIPTION_PROGRESS':
      return {
        ...state,
        transcriptionProgress: action.payload.percent,
        transcriptionMessage: action.payload.message ?? state.transcriptionMessage,
      }

    case 'TRANSCRIPTION_COMPLETE':
      return {
        ...state,
        status: 'analyzed',
        transcription: action.payload,
        transcriptionProgress: 100,
        transcriptionMessage: 'Complete',
      }

    case 'ANALYSIS_COMPLETE':
      return {
        ...state,
        status: 'analyzed',
        transcription: action.payload.transcription,
        features: action.payload.features,
        harmony: action.payload.harmony,
        chords: action.payload.chords,
        progressions: action.payload.progressions,
      }

    case 'SELECT_HARMONIC_FIELD':
      if (!state.harmony) return state
      return {
        ...state,
        harmony: {
          ...state.harmony,
          selectedCandidateId: action.payload.candidateId,
        },
        chords: action.payload.chords,
        progressions: action.payload.progressions,
      }

    case 'SET_ERROR':
      return {
        ...state,
        status: 'error',
        error: action.payload,
      }

    case 'RESET':
      return initialAppState

    default:
      return state
  }
}
