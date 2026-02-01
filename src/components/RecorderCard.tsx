import { useState, useCallback } from 'react'
import { useAppState, useAppDispatch } from '../domain/state'
import { useAudioRecorder, formatTime } from '../services/audioRecorder'
import { transcriptionService, TranscriptionCancelledError } from '../services/transcriptionService'
import { extractFeatures } from '../services/featureExtraction'
import { analyzeHarmony } from '../services/harmonyAnalysis'
import { generateChordSuggestions } from '../services/chordSuggestion'
import { generateProgressions } from '../services/progressionService'
import { midiPlayer } from '../services/midiPlayer'
import { NotesTimeline } from './NotesTimeline'
import type { RecordingStatus, TranscriptionPreset } from '../domain/types'

const statusMessages: Record<RecordingStatus, string> = {
  idle: 'Ready to record',
  recording: 'Recording...',
  recorded: 'Recording complete',
  decoding: 'Decoding audio...',
  transcribing: 'Transcribing notes...',
  analyzed: 'Analysis complete',
  error: 'An error occurred',
}

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

  // Help section state
  const [isHelpOpen, setIsHelpOpen] = useState(false)

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
      // Pass full recordingAsset to use HQ PCM data when available
      const transcriptionResult = await transcriptionService.transcribe(
        recordingAsset,
        preset, // 'lead' for single notes/riffs, 'chord' for strumming
        (percent, message) => {
          // Scale transcription progress to 0-80%
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
    transcriptionService.cancel() // Cancel any ongoing transcription
    resetRecorder()
    dispatch({ type: 'RESET' })
  }

  return (
    <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-4 shadow-xl shadow-black/20 sm:p-6">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2 sm:mb-4">
        <div
          className={`h-2 w-2 shrink-0 rounded-full transition-colors ${isRecording
            ? 'animate-pulse bg-red-500'
            : isProcessing
              ? 'animate-pulse bg-amber-500'
              : hasAnalysis
                ? 'bg-emerald-500'
                : hasRecording
                  ? 'bg-blue-500'
                  : 'bg-stone-600'
            }`}
        />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
          Recorder
        </h2>
        {hasAnalysis && transcription && (
          <span className="ml-auto text-xs text-stone-500 tabular-nums">
            {transcription.noteCount} notes detected
          </span>
        )}
        {hasRecording && !hasAnalysis && !isTranscribing && (
          <span className="ml-auto text-xs text-stone-500 tabular-nums">
            {formatTime(recordingAsset.durationMs)} recorded
          </span>
        )}
      </div>

      {/* Waveform / Visualization Area */}
      <div className="mb-4 flex h-24 items-center justify-center rounded-xl border border-dashed border-stone-700 bg-stone-950/50 sm:mb-6 sm:h-32">
        {isRecording ? (
          // Recording animation
          <div className="flex items-end gap-0.5 sm:gap-1">
            {Array.from({ length: 12 }).map((_, i) => (
              <div
                key={i}
                className="w-1.5 rounded-t bg-gradient-to-t from-red-600 to-red-400 sm:w-2"
                style={{
                  height: `${20 + Math.random() * 60}%`,
                  animation: `pulse 0.5s ease-in-out ${i * 0.05}s infinite alternate`,
                }}
              />
            ))}
          </div>
        ) : isTranscribing ? (
          <div className="flex w-full flex-col items-center gap-2 px-4 sm:gap-3 sm:px-8">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-500 sm:h-6 sm:w-6" />
            <div className="w-full max-w-sm">
              <div className="mb-1 flex justify-between text-[10px] text-stone-500 sm:text-xs">
                <span className="truncate pr-2">{transcriptionMessage || 'Processing...'}</span>
                <span className="tabular-nums">{Math.round(transcriptionProgress)}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-800 sm:h-2">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-300"
                  style={{ width: `${transcriptionProgress}%` }}
                />
              </div>
            </div>
          </div>
        ) : hasAnalysis && transcription ? (
          <div className="flex w-full items-end justify-center gap-0.5 px-3 sm:gap-1 sm:px-4">
            {Array.from({ length: 20 }).map((_, i) => {
              const height = Math.random() * 60 + 20
              return (
                <div
                  key={i}
                  className="w-1.5 rounded-t bg-gradient-to-t from-emerald-600 to-emerald-400 sm:w-2"
                  style={{ height: `${height}%` }}
                />
              )
            })}
          </div>
        ) : (
          <div className="flex flex-col items-center gap-1.5 px-4 text-center text-stone-600 sm:gap-2">
            <svg
              className="h-6 w-6 sm:h-8 sm:w-8"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 1 1 6 0v8.25a3 3 0 0 1-3 3Z"
              />
            </svg>
            <span className="text-[11px] sm:text-xs">Click record to start</span>
          </div>
        )}
      </div>

      {/* Timer / Status */}
      <div className="mb-3 text-center sm:mb-4">
        {isRecording ? (
          <div className="flex flex-col items-center gap-0.5 sm:gap-1">
            <span className="font-mono text-xl font-bold tabular-nums text-red-400 sm:text-2xl">
              {formatTime(elapsedMs)}
            </span>
            <div className="flex items-center gap-2 text-[10px] text-stone-500 sm:text-xs">
              <span>Max 20 seconds</span>
              {isHQCapture && (
                <span className="inline-flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-400">
                  HQ
                </span>
              )}
            </div>
          </div>
        ) : currentError ? (
          <p className="text-xs text-red-400 sm:text-sm">{currentError.message}</p>
        ) : (
          <p className="text-xs text-stone-500 sm:text-sm">{statusMessages[effectiveStatus]}</p>
        )}
      </div>

      {/* Settings Toggles - only show when not recording/transcribing */}
      {!isRecording && !isTranscribing && (
        <div className="mb-4 grid grid-cols-2 gap-2 sm:mb-6 sm:flex sm:flex-wrap sm:items-center sm:justify-center sm:gap-4">
          {/* Music Mode Toggle */}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => setMusicMode(!musicMode)}
              className="group flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-stone-700 bg-stone-900/50 px-2 py-1.5 text-[11px] transition-all hover:border-stone-600 hover:bg-stone-800/50 sm:w-auto sm:gap-2 sm:px-3 sm:text-xs"
            >
              {musicMode ? (
                <>
                  <span className="text-sm leading-none sm:text-base">🎸</span>
                  <span className="text-amber-400">Music</span>
                </>
              ) : (
                <>
                  <span className="text-sm leading-none sm:text-base">🎙️</span>
                  <span className="text-blue-400">Noisy</span>
                </>
              )}
              <div className="ml-0.5 flex h-3.5 w-6 items-center rounded-full bg-stone-700 p-0.5 transition-colors sm:ml-1 sm:h-4 sm:w-7">
                <div
                  className={`h-2.5 w-2.5 rounded-full transition-all sm:h-3 sm:w-3 ${musicMode
                    ? 'translate-x-0 bg-amber-500'
                    : 'translate-x-2.5 bg-blue-500 sm:translate-x-3'
                    }`}
                />
              </div>
            </button>
            <span className="text-[9px] text-stone-500 sm:text-[10px]">
              {musicMode ? 'Clean audio' : 'Noise filtering'}
            </span>
          </div>

          {/* Preset Toggle */}
          <div className="flex flex-col items-center gap-1">
            <button
              onClick={() => setPreset(p => p === 'lead' ? 'chord' : 'lead')}
              className="group flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-stone-700 bg-stone-900/50 px-2 py-1.5 text-[11px] transition-all hover:border-stone-600 hover:bg-stone-800/50 sm:w-auto sm:gap-2 sm:px-3 sm:text-xs"
            >
              {preset === 'lead' ? (
                <>
                  <span className="text-sm leading-none sm:text-base">🎵</span>
                  <span className="text-purple-400">Lead</span>
                </>
              ) : (
                <>
                  <span className="text-sm leading-none sm:text-base">🎶</span>
                  <span className="text-teal-400">Chord</span>
                </>
              )}
              <div className="ml-0.5 flex h-3.5 w-6 items-center rounded-full bg-stone-700 p-0.5 transition-colors sm:ml-1 sm:h-4 sm:w-7">
                <div
                  className={`h-2.5 w-2.5 rounded-full transition-all sm:h-3 sm:w-3 ${preset === 'lead'
                    ? 'translate-x-0 bg-purple-500'
                    : 'translate-x-2.5 bg-teal-500 sm:translate-x-3'
                    }`}
                />
              </div>
            </button>
            <span className="text-[9px] text-stone-500 sm:text-[10px]">
              {preset === 'lead' ? 'Single notes & riffs' : 'Strumming & chords'}
            </span>
          </div>
        </div>
      )}

      {/* Audio Playback */}
      {hasRecording && !isRecording && !isTranscribing && (
        <div className="mb-4 sm:mb-6">
          {/* HQ Capture indicator */}
          {recordingAsset.pcmData && (
            <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5 text-[10px] sm:text-xs">
              <span className="inline-flex h-4 items-center gap-1 rounded bg-emerald-900/40 px-1.5 text-emerald-400">
                <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                HQ
              </span>
              <span className="text-stone-500">Better transcription accuracy</span>
            </div>
          )}
          <audio
            controls
            src={recordingAsset.audioUrl}
            className="h-10 w-full rounded-lg sm:h-12"
            style={{
              filter: 'invert(1) hue-rotate(180deg)',
              opacity: 0.7,
            }}
          />
        </div>
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

      {/* Controls */}
      <div className="flex justify-center gap-3 sm:gap-4">
        {/* Record / Stop Button */}
        <button
          onClick={handleRecordClick}
          disabled={isProcessing}
          className={`group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full shadow-lg ring-4 transition-all sm:h-16 sm:w-16 ${isRecording
            ? 'bg-gradient-to-b from-red-600 to-red-700 ring-red-900/50 hover:ring-red-800/50'
            : 'bg-gradient-to-b from-stone-700 to-stone-800 ring-stone-800 hover:ring-amber-900/50'
            } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {isRecording ? (
            <div className="h-4 w-4 rounded bg-white sm:h-5 sm:w-5" />
          ) : (
            <div className="h-5 w-5 rounded-full bg-red-500 shadow-inner shadow-red-400/50 sm:h-6 sm:w-6" />
          )}
          <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">
            {isRecording ? 'Stop' : 'Record'}
          </span>
        </button>

        {/* Transcribe Button - shown when we have a recording but not analyzing */}
        {hasRecording && !hasAnalysis && !isRecording && !isTranscribing && (
          <button
            onClick={handleTranscribe}
            className="group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-amber-600 to-amber-700 shadow-lg ring-4 ring-amber-900/50 transition-all hover:ring-amber-800/50 sm:h-16 sm:w-16"
          >
            <svg
              className="h-5 w-5 text-white sm:h-6 sm:w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z"
              />
            </svg>
            <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">
              Analyze
            </span>
          </button>
        )}

        {/* Cancel Button - shown during transcription */}
        {isTranscribing && (
          <button
            onClick={handleCancelTranscription}
            className="group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-red-600 to-red-700 shadow-lg ring-4 ring-red-900/50 transition-all hover:ring-red-800/50 sm:h-16 sm:w-16"
          >
            <svg
              className="h-5 w-5 text-white sm:h-6 sm:w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
            <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">
              Cancel
            </span>
          </button>
        )}

        {/* Reset Button */}
        {(hasRecording || hasAnalysis || currentError) && !isRecording && !isTranscribing && (
          <button
            onClick={handleReset}
            className="group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-stone-700 to-stone-800 shadow-lg ring-4 ring-stone-800 transition-all hover:ring-stone-700 sm:h-16 sm:w-16"
          >
            <svg
              className="h-5 w-5 text-stone-400 sm:h-6 sm:w-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99"
              />
            </svg>
            <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">Reset</span>
          </button>
        )}
      </div>

      {/* Help Text */}
      <p className="mt-10 text-center text-[10px] text-stone-600 sm:mt-12 sm:text-xs">
        {hasAnalysis && transcription
          ? `${transcription.noteCount} notes • MIDI ${transcription.range.minMidi}-${transcription.range.maxMidi}`
          : hasRecording && !isTranscribing
            ? 'Click Analyze to detect notes'
            : isTranscribing
              ? 'Analyzing audio...'
              : 'Click to record a short guitar riff (max 20 seconds)'}
      </p>

      {/* Help Section */}
      <div className="mt-4 border-t border-stone-800 pt-3 sm:mt-6 sm:pt-4">
        <button
          onClick={() => setIsHelpOpen(!isHelpOpen)}
          className="flex w-full cursor-pointer items-center justify-center gap-1.5 text-[11px] text-stone-500 transition-colors hover:text-stone-400 sm:gap-2 sm:text-xs"
        >
          <svg
            className="h-3.5 w-3.5 sm:h-4 sm:w-4"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Zm-9 5.25h.008v.008H12v-.008Z"
            />
          </svg>
          <span>Tips for best results</span>
          <svg
            className={`h-2.5 w-2.5 transition-transform sm:h-3 sm:w-3 ${isHelpOpen ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {isHelpOpen && (
          <div className="mt-2 space-y-1.5 text-[11px] text-stone-500 sm:mt-3 sm:space-y-2 sm:text-xs">
            <div className="flex items-start gap-2 rounded-lg bg-stone-900/50 p-2.5 sm:p-3">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 18v-5.25m0 0a6.01 6.01 0 0 0 1.5-.189m-1.5.189a6.01 6.01 0 0 1-1.5-.189m3.75 7.478a12.06 12.06 0 0 1-4.5 0m3.75 2.383a14.406 14.406 0 0 1-3 0M14.25 18v-.192c0-.983.658-1.823 1.508-2.316a7.5 7.5 0 1 0-7.517 0c.85.493 1.509 1.333 1.509 2.316V18" />
              </svg>
              <p>Record one instrument at a time for best pitch detection.</p>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-stone-900/50 p-2.5 sm:p-3">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75 11.25 15 15 9.75m-3-7.036A11.959 11.959 0 0 1 3.598 6 11.99 11.99 0 0 0 3 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285Z" />
              </svg>
              <p>Everything runs locally — your audio never leaves your device.</p>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-stone-900/50 p-2.5 sm:p-3">
              <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500 sm:h-4 sm:w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
              </svg>
              <p>Keep recordings short (5-15s) for faster results.</p>
            </div>
          </div>
        )}
      </div>

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
