import { useState, useRef, useCallback, useEffect } from 'react'
import type { RecordingError, RecordingAsset } from '../domain/types'
import { PCMCapture, isPCMCaptureSupported } from './pcmCapture'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface UseAudioRecorderOptions {
  /**
   * When true (default), disables browser speech processing (echo cancellation,
   * noise suppression, auto gain control) for cleaner pitch detection.
   * Set to false for recording in noisy environments.
   */
  musicMode?: boolean
}

export interface UseAudioRecorderReturn {
  // State
  isRecording: boolean
  elapsedMs: number
  recordingAsset: RecordingAsset | null
  error: RecordingError | null
  /** Whether HQ PCM capture is being used (lossless audio) */
  isHQCapture: boolean

  // Actions
  startRecording: () => Promise<void>
  stopRecording: () => void
  reset: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const MAX_RECORDING_MS = 20_000 // 20 seconds max
const TIMER_INTERVAL_MS = 100 // Update timer every 100ms

// Preferred MIME types in order of preference
const MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
  'audio/mpeg',
]

function getSupportedMimeType(): string {
  for (const mimeType of MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(mimeType)) {
      return mimeType
    }
  }
  // Fallback to default (browser will choose)
  return ''
}

// Check if HQ capture is supported (memoize on first call)
let hqCaptureSupported: boolean | null = null
function isHQCaptureSupported(): boolean {
  if (hqCaptureSupported === null) {
    hqCaptureSupported = isPCMCaptureSupported()
  }
  return hqCaptureSupported
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useAudioRecorder(options: UseAudioRecorderOptions = {}): UseAudioRecorderReturn {
  const { musicMode = true } = options

  // State
  const [isRecording, setIsRecording] = useState(false)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [recordingAsset, setRecordingAsset] = useState<RecordingAsset | null>(null)
  const [error, setError] = useState<RecordingError | null>(null)
  const [isHQCapture, setIsHQCapture] = useState(false)

  // Refs for MediaRecorder
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef<number>(0)

  // Refs for HQ PCM capture
  const pcmCaptureRef = useRef<PCMCapture | null>(null)
  const pendingStopRef = useRef<{
    resolve: (value: RecordingAsset) => void
    mimeType: string
  } | null>(null)

  // Cleanup function
  const cleanup = useCallback(async () => {
    // Stop timer
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }

    // Stop media recorder
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    mediaRecorderRef.current = null

    // Stop PCM capture
    if (pcmCaptureRef.current) {
      await pcmCaptureRef.current.cancel()
      pcmCaptureRef.current = null
    }

    // Stop all tracks to release microphone
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }

    // Clear chunks
    chunksRef.current = []
    pendingStopRef.current = null
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanup()
      // Revoke any existing object URL
      if (recordingAsset?.audioUrl) {
        URL.revokeObjectURL(recordingAsset.audioUrl)
      }
    }
  }, [cleanup, recordingAsset?.audioUrl])

  // Start recording
  const startRecording = useCallback(async () => {
    // Reset any previous state
    setError(null)
    setElapsedMs(0)

    // Revoke previous URL if exists
    if (recordingAsset?.audioUrl) {
      URL.revokeObjectURL(recordingAsset.audioUrl)
    }
    setRecordingAsset(null)

    try {
      // Request microphone permission
      // In music mode, disable speech processing for cleaner pitch detection
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: !musicMode,
          noiseSuppression: !musicMode,
          autoGainControl: !musicMode,
        },
      })
      streamRef.current = stream

      // Check if HQ capture is supported and start it
      const useHQ = isHQCaptureSupported()
      setIsHQCapture(useHQ)

      if (useHQ) {
        try {
          pcmCaptureRef.current = new PCMCapture()
          await pcmCaptureRef.current.startCapture(stream)
        } catch (err) {
          console.warn('HQ PCM capture failed to start, falling back to MediaRecorder only:', err)
          pcmCaptureRef.current = null
          setIsHQCapture(false)
        }
      }

      // Create MediaRecorder (always needed for playback)
      const mimeType = getSupportedMimeType()
      const recorderOptions: MediaRecorderOptions = mimeType ? { mimeType } : {}
      const mediaRecorder = new MediaRecorder(stream, recorderOptions)
      mediaRecorderRef.current = mediaRecorder

      // Collect data chunks
      chunksRef.current = []
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data)
        }
      }

      // Handle recording stop
      mediaRecorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, {
          type: mimeType || 'audio/webm',
        })
        const audioUrl = URL.createObjectURL(blob)
        const durationMs = Date.now() - startTimeRef.current

        // Get PCM data if available
        let pcmData: Float32Array | undefined
        let pcmSampleRate: number | undefined

        if (pcmCaptureRef.current) {
          try {
            const pcmResult = await pcmCaptureRef.current.stopCapture()
            if (pcmResult) {
              pcmData = pcmResult.pcmData
              pcmSampleRate = pcmResult.sampleRate
            }
          } catch (err) {
            console.warn('Failed to get PCM data:', err)
          }
          pcmCaptureRef.current = null
        }

        const asset: RecordingAsset = {
          blob,
          audioUrl,
          durationMs,
          ...(pcmData && pcmSampleRate ? { pcmData, pcmSampleRate } : {}),
        }

        setRecordingAsset(asset)
        setIsRecording(false)

        // Stop timer
        if (timerRef.current) {
          clearInterval(timerRef.current)
          timerRef.current = null
        }

        // Release microphone
        if (streamRef.current) {
          streamRef.current.getTracks().forEach((track) => track.stop())
          streamRef.current = null
        }
      }

      // Handle errors during recording
      mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event)
        setError({
          stage: 'record',
          message: 'An error occurred while recording. Please try again.',
        })
        cleanup()
        setIsRecording(false)
      }

      // Start recording
      mediaRecorder.start(100) // Collect data every 100ms
      startTimeRef.current = Date.now()
      setIsRecording(true)

      // Start elapsed time timer
      timerRef.current = setInterval(() => {
        const elapsed = Date.now() - startTimeRef.current
        setElapsedMs(elapsed)

        // Auto-stop at max duration
        if (elapsed >= MAX_RECORDING_MS) {
          // Inline stop logic to avoid hoisting issues
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
            mediaRecorderRef.current.stop()
          }
        }
      }, TIMER_INTERVAL_MS)
    } catch (err) {
      console.error('getUserMedia error:', err)

      // Handle specific permission errors
      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError({
            stage: 'permission',
            message: 'Microphone access was denied. Please allow microphone access and try again.',
          })
        } else if (err.name === 'NotFoundError') {
          setError({
            stage: 'permission',
            message: 'No microphone found. Please connect a microphone and try again.',
          })
        } else {
          setError({
            stage: 'permission',
            message: `Could not access microphone: ${err.message}`,
          })
        }
      } else {
        setError({
          stage: 'permission',
          message: 'Could not access microphone. Please check your browser settings.',
        })
      }
    }
  }, [cleanup, recordingAsset?.audioUrl, musicMode])

  // Stop recording
  const stopRecording = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
      mediaRecorderRef.current.stop()
    }
  }, [])

  // Reset to initial state
  const reset = useCallback(() => {
    cleanup()
    setIsRecording(false)
    setElapsedMs(0)
    setError(null)
    setIsHQCapture(false)

    // Revoke object URL
    if (recordingAsset?.audioUrl) {
      URL.revokeObjectURL(recordingAsset.audioUrl)
    }
    setRecordingAsset(null)
  }, [cleanup, recordingAsset?.audioUrl])

  return {
    isRecording,
    elapsedMs,
    recordingAsset,
    error,
    isHQCapture,
    startRecording,
    stopRecording,
    reset,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Utility: Format milliseconds as MM:SS
// ─────────────────────────────────────────────────────────────────────────────

export function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`
}
