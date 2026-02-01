import { useState, useCallback } from 'react'
import { useAppState, useAppDispatch } from '../../domain/state'
import { useAudioRecorder } from '../../services/audioRecorder'
import { transcriptionService, TranscriptionCancelledError } from '../../services/transcriptionService'
import { extractFeatures } from '../../services/featureExtraction'
import { analyzeHarmony } from '../../services/harmonyAnalysis'
import { generateChordSuggestions } from '../../services/chordSuggestion'
import { generateProgressions } from '../../services/progressionService'
import { midiPlayer } from '../../services/midiPlayer'
import { NotesTimeline } from '../NotesTimeline'
import type { RecordingStatus, TranscriptionPreset } from '../../domain/types'

// Sub-components
import { RecorderHeader } from './RecorderHeader'
import { WaveformDisplay } from './WaveformDisplay'
import { RecorderTimer } from './RecorderTimer'
import { RecorderSettings } from './RecorderSettings'
import { AudioPlayback } from './AudioPlayback'
import { RecorderControls } from './RecorderControls'
import { HelpSection } from './HelpSection'

export function RecorderCard() {
  const {
    status,
    error: appError,
    transcription,
    transcriptionProgress,
    transcriptionMessage,
  } = useAppState()
  const dispatch = useAppDispatch()

  // Music mode: disables speech processing for cleaner pitch detection
  const [musicMode, setMusicMode] = useState(true)

  // Transcription preset: 'lead' for single notes/riffs, 'chord' for strumming
  const [preset, setPreset] = useState<TranscriptionPreset>('lead')

  const {
    isRecording,
    elapsedMs,
    recordingAsset,
    error: recordError,
    isHQCapture,
    startRecording,
    stopRecording,
    reset: resetRecorder,
  } = useAudioRecorder({ musicMode })

  // Determine effective status for UI
  const effectiveStatus: RecordingStatus = isRecording
    ? 'recording'
    : status === 'transcribing'
      ? 'transcribing'
      : recordingAsset && status !== 'analyzed'
        ? 'recorded'
        : status

  const isProcessing = ['decoding', 'transcribing'].includes(effectiveStatus)
  const isTranscribing = effectiveStatus === 'transcribing'
  const hasRecording = !!recordingAsset
  const hasAnalysis = status === 'analyzed' && !!transcription
  const currentError = recordError || appError

  // Playback state
  const [isPlayingSequence, setIsPlayingSequence] = useState(false)
  const [playingNoteIndex, setPlayingNoteIndex] = useState<number | null>(null)

  // Play all notes in sequence
  const handlePlayAll = useCallback(() => {
    if (!transcription?.notes.length) return

    setIsPlayingSequence(true)
    midiPlayer.playSequence(
      transcription.notes,
      (index) => setPlayingNoteIndex(index),
      () => {
        setIsPlayingSequence(false)
        setPlayingNoteIndex(null)
      }
    )
  }, [transcription])

  // Stop playback
  const handleStopPlayback = useCallback(() => {
    midiPlayer.stopSequence()
    setIsPlayingSequence(false)
    setPlayingNoteIndex(null)
  }, [])

  // Handle record button click
  const handleRecordClick = async () => {
    if (isRecording) {
      stopRecording()
    } else {
      dispatch({ type: 'START_RECORDING' })
      await startRecording()
    }
  }

  // Handle transcribe button click
  const handleTranscribe = async () => {
    if (!recordingAsset?.blob) return

    dispatch({ type: 'START_TRANSCRIBE' })

    try {
      // Step 1: Transcribe audio to notes
      const transcriptionResult = await transcriptionService.transcribe(
        recordingAsset,
        preset,
        (percent, message) => {
          dispatch({
            type: 'SET_TRANSCRIPTION_PROGRESS',
            payload: { percent: percent * 0.8, message },
          })
        }
      )

      // Step 2: Extract pitch class features
      dispatch({
        type: 'SET_TRANSCRIPTION_PROGRESS',
        payload: { percent: 85, message: 'Analyzing pitch classes...' },
      })
      const features = extractFeatures(transcriptionResult.notes)

      // Step 3: Analyze harmony (rank keys/modes)
      dispatch({
        type: 'SET_TRANSCRIPTION_PROGRESS',
        payload: { percent: 90, message: 'Detecting keys and modes...' },
      })
      const harmony = analyzeHarmony(features)

      // Step 4: Generate chord suggestions for the top candidate
      dispatch({
        type: 'SET_TRANSCRIPTION_PROGRESS',
        payload: { percent: 92, message: 'Generating chord suggestions...' },
      })
      const selectedCandidate = harmony.candidates[0]
      const chords = selectedCandidate
        ? generateChordSuggestions(selectedCandidate, features)
        : null

      // Step 5: Generate progression suggestions
      dispatch({
        type: 'SET_TRANSCRIPTION_PROGRESS',
        payload: { percent: 97, message: 'Generating progressions...' },
      })
      const progressions = selectedCandidate && chords
        ? generateProgressions(selectedCandidate, chords, features)
        : []

      // Complete - dispatch full analysis result
      dispatch({
        type: 'ANALYSIS_COMPLETE',
        payload: {
          transcription: transcriptionResult,
          features,
          harmony,
          chords,
          progressions,
        },
      })
    } catch (err) {
      // Handle cancellation gracefully - just reset to recorded state
      if (err instanceof TranscriptionCancelledError) {
        dispatch({ type: 'STOP_RECORDING', payload: recordingAsset })
        return
      }

      // Handle real errors
      console.error('Transcription error:', err)
      dispatch({
        type: 'SET_ERROR',
        payload: {
          stage: 'transcribe',
          message:
            err instanceof Error
              ? err.message
              : 'Failed to transcribe audio. Please try again.',
        },
      })
    }
  }

  // Handle cancel transcription
  const handleCancelTranscription = () => {
    transcriptionService.cancel()
  }

  // Handle reset
  const handleReset = () => {
    transcriptionService.cancel()
    resetRecorder()
    dispatch({ type: 'RESET' })
  }

  // Helper text based on state
  const getHelpText = () => {
    if (hasAnalysis && transcription) {
      return `${transcription.noteCount} notes • MIDI ${transcription.range.minMidi}-${transcription.range.maxMidi}`
    }
    if (hasRecording && !isTranscribing) {
      return 'Click Analyze to detect notes'
    }
    if (isTranscribing) {
      return 'Analyzing audio...'
    }
    return 'Click to record a short guitar riff (max 20 seconds)'
  }

  return (
    <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-4 shadow-xl shadow-black/20 sm:p-6">
      <RecorderHeader
        isRecording={isRecording}
        isProcessing={isProcessing}
        hasAnalysis={hasAnalysis}
        hasRecording={hasRecording}
        transcription={transcription}
        recordingAsset={recordingAsset}
        isTranscribing={isTranscribing}
      />

      <WaveformDisplay
        isRecording={isRecording}
        isTranscribing={isTranscribing}
        hasAnalysis={hasAnalysis}
        transcription={transcription}
        transcriptionProgress={transcriptionProgress}
        transcriptionMessage={transcriptionMessage}
      />

      <RecorderTimer
        isRecording={isRecording}
        elapsedMs={elapsedMs}
        isHQCapture={isHQCapture}
        error={currentError}
        effectiveStatus={effectiveStatus}
      />

      {/* Settings Toggles - only show when not recording/transcribing */}
      {!isRecording && !isTranscribing && (
        <RecorderSettings
          musicMode={musicMode}
          onMusicModeChange={() => setMusicMode(!musicMode)}
          preset={preset}
          onPresetChange={() => setPreset(p => p === 'lead' ? 'chord' : 'lead')}
        />
      )}

      {/* Audio Playback */}
      {hasRecording && !isRecording && !isTranscribing && recordingAsset && (
        <AudioPlayback recordingAsset={recordingAsset} />
      )}

      {/* Notes Timeline (after transcription) */}
      {hasAnalysis && transcription && transcription.notes.length > 0 && (
        <NotesTimeline
          notes={transcription.notes}
          isPlaying={isPlayingSequence}
          currentNoteIndex={playingNoteIndex ?? -1}
          onPlayAll={handlePlayAll}
          onStop={handleStopPlayback}
        />
      )}

      <RecorderControls
        isRecording={isRecording}
        isProcessing={isProcessing}
        isTranscribing={isTranscribing}
        hasRecording={hasRecording}
        hasAnalysis={hasAnalysis}
        hasError={!!currentError}
        onRecordClick={handleRecordClick}
        onTranscribe={handleTranscribe}
        onCancelTranscription={handleCancelTranscription}
        onReset={handleReset}
      />

      {/* Help Text */}
      <p className="mt-10 text-center text-[10px] text-stone-600 sm:mt-12 sm:text-xs">
        {getHelpText()}
      </p>

      <HelpSection />

      {/* CSS for recording animation */}
      <style>{`
        @keyframes pulse {
          0% { transform: scaleY(0.3); }
          100% { transform: scaleY(1); }
        }
      `}</style>
    </div>
  )
}
