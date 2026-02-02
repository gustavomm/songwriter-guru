import {
  BasicPitch,
  noteFramesToTime,
  outputToNotesPoly,
  addPitchBendsToNoteEvents,
  type NoteEventTime,
} from '@spotify/basic-pitch'
import type {
  TranscribedNote,
  TranscriptionResult,
  RecordingAsset,
  TranscriptionPreset,
} from '../domain/types'
import { prepareAudioForTranscription, prepareRawPcmForTranscription } from './audioDecoder'
import {
  limitPolyphony,
  smartMergeNotes,
  filterIsolatedNoiseNotes,
  DEFAULT_MAX_POLYPHONY,
} from './noteProcessing'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Basic Pitch expects 22050Hz sample rate
const TARGET_SAMPLE_RATE = 22050

// Model path - uses Vite's BASE_URL to work with GitHub Pages subdirectory
const MODEL_PATH = `${import.meta.env.BASE_URL}basic-pitch-model/model.json`

// ─────────────────────────────────────────────────────────────────────────────
// Transcription Tuning Parameters
// Adjust these to find the sweet spot for your use case:
// - Higher values = fewer notes detected (stricter)
// - Lower values = more notes detected (more sensitive)
// ─────────────────────────────────────────────────────────────────────────────

// Detection thresholds - TUNED FOR LESS NOISE
// Onset threshold: 0.5 is the default, higher = stricter onset detection
const ONSET_THRESHOLD = 0.5 // Range: 0.3 (sensitive) to 0.7 (strict)

// Frame threshold: explicit value for more consistent detection
// 0.3 is default, higher = requires stronger pitch activation
const FRAME_THRESHOLD = 0.35 // Range: 0.2 (sensitive) to 0.5 (strict)

// Basic Pitch timing: 22050Hz sample rate, 256-sample hop
// → ~86 frames/sec → ~11.6ms per frame
// 13 frames ≈ 150ms - slightly longer minimum to filter out noise spikes
const MIN_NOTE_LENGTH = 13 // Frames (~11.6ms each, total ~150ms)

// Energy tolerance: how quickly a note can decay before being cut off
const ENERGY_TOLERANCE = 11

// Guitar frequency range (for filtering false positives)
// Low: ~70Hz supports drop tunings (Drop D low is ~73Hz, Drop C is ~65Hz)
// High: ~2500Hz covers highest frets + strong upper partials
const GUITAR_MIN_FREQ = 70 // Hz - supports drop tunings
const GUITAR_MAX_FREQ = 2500 // Hz - high frets + harmonics

// Amplitude floor for filtering weak/hallucinated notes
// INCREASED from 0.25 to filter more aggressively
const MIN_AMPLITUDE = 0.35

// Minimum note duration in seconds (post-processing filter)
// Notes shorter than this are likely noise artifacts
const MIN_NOTE_DURATION_SEC = 0.08 // 80ms minimum

// ─────────────────────────────────────────────────────────────────────────────
// Custom Error for Cancellation
// ─────────────────────────────────────────────────────────────────────────────

export class TranscriptionCancelledError extends Error {
  constructor() {
    super('Transcription cancelled')
    this.name = 'TranscriptionCancelledError'
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton Service
// ─────────────────────────────────────────────────────────────────────────────

class TranscriptionServiceImpl {
  private basicPitch: BasicPitch | null = null
  private modelLoadingPromise: Promise<BasicPitch> | null = null
  private currentAbortController: AbortController | null = null

  /**
   * Ensure the Basic Pitch model is loaded (lazy loading with deduplication)
   */
  async ensureModelLoaded(onProgress?: (message: string) => void): Promise<BasicPitch> {
    // Return existing instance
    if (this.basicPitch) {
      return this.basicPitch
    }

    // Return in-flight loading promise
    if (this.modelLoadingPromise) {
      return this.modelLoadingPromise
    }

    // Start loading
    onProgress?.('Loading pitch detection model...')

    this.modelLoadingPromise = (async () => {
      try {
        const bp = new BasicPitch(MODEL_PATH)
        // Force the model to load by accessing it
        await bp.model
        this.basicPitch = bp
        onProgress?.('Model loaded')
        return bp
      } catch (error) {
        this.modelLoadingPromise = null
        throw error
      }
    })()

    return this.modelLoadingPromise
  }

  /**
   * Check if transcription is currently in progress
   */
  get isTranscribing(): boolean {
    return this.currentAbortController !== null
  }

  /**
   * Cancel the current transcription (if any)
   */
  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort()
      this.currentAbortController = null
    }
  }

  /**
   * Transcribe audio from a RecordingAsset to TranscribedNote[]
   * Supports cancellation via abort signal
   *
   * Uses lossless PCM data when available (from AudioWorklet capture),
   * otherwise falls back to decoding the compressed blob.
   *
   * @param recordingAsset - The recorded audio to transcribe
   * @param preset - 'lead' for single notes/riffs, 'chord' for strumming (default: 'lead')
   * @param onProgress - Progress callback
   */
  async transcribe(
    recordingAsset: RecordingAsset,
    preset: TranscriptionPreset = 'lead',
    onProgress?: (percent: number, message?: string) => void
  ): Promise<TranscriptionResult> {
    // Cancel any existing transcription
    this.cancel()

    // Create new abort controller for this transcription
    this.currentAbortController = new AbortController()
    const signal = this.currentAbortController.signal

    try {
      // Step 1: Load model
      onProgress?.(0, 'Loading model...')
      const basicPitch = await this.ensureModelLoaded((msg) => onProgress?.(5, msg))

      // Check for cancellation
      if (signal.aborted) {
        throw new TranscriptionCancelledError()
      }

      // Step 2: Prepare audio (lossless or lossy path)
      let audioData: Float32Array
      let durationMs: number

      if (recordingAsset.pcmData && recordingAsset.pcmSampleRate) {
        // HQ Path: Use raw PCM data (lossless)
        onProgress?.(10, 'Preparing audio (HQ lossless)...')
        const prepared = await prepareRawPcmForTranscription(
          recordingAsset.pcmData,
          recordingAsset.pcmSampleRate,
          TARGET_SAMPLE_RATE
        )
        audioData = prepared.audioData
        durationMs = prepared.durationMs
      } else {
        // Fallback: Decode compressed blob (lossy)
        onProgress?.(10, 'Decoding audio...')
        const prepared = await prepareAudioForTranscription(recordingAsset.blob, TARGET_SAMPLE_RATE)
        audioData = prepared.audioData
        durationMs = prepared.durationMs
      }

      // Check for cancellation
      if (signal.aborted) {
        throw new TranscriptionCancelledError()
      }

      // Step 3: Run inference
      onProgress?.(15, 'Transcribing...')

      // Collect results from the callback - accumulate all frames
      const allFrames: number[][] = []
      const allOnsets: number[][] = []
      const allContours: number[][] = []

      await basicPitch.evaluateModel(
        audioData,
        // onComplete callback - called incrementally with each batch of results
        (frames, onsets, contours) => {
          // Check for cancellation during model evaluation
          if (signal.aborted) return

          // Accumulate results from each callback
          allFrames.push(...frames)
          allOnsets.push(...onsets)
          allContours.push(...contours)
        },
        // percentCallback - Basic Pitch returns percent as 0..1, not 0..100
        (percent) => {
          if (signal.aborted) return

          // Scale percent (0..1) to 15-90 range for overall progress
          const scaledPercent = 15 + percent * 75
          onProgress?.(scaledPercent, `Transcribing... ${Math.round(percent * 100)}%`)
        }
      )

      // Check for cancellation after model evaluation
      if (signal.aborted) {
        throw new TranscriptionCancelledError()
      }

      // Step 4: Convert to note events
      onProgress?.(90, 'Processing notes...')

      // Preset-specific settings
      // Lead: inferOnsets + melodiaTrick help detect melody continuity
      // Chord: disable both to reduce ghost notes from dense strumming
      const inferOnsets = preset === 'lead'
      const melodiaTrick = preset === 'lead'

      // Adjust thresholds based on preset
      // Chord mode uses slightly higher thresholds to reduce noise from strumming
      const effectiveOnsetThresh = preset === 'chord' ? ONSET_THRESHOLD + 0.05 : ONSET_THRESHOLD
      const effectiveFrameThresh = preset === 'chord' ? FRAME_THRESHOLD + 0.05 : FRAME_THRESHOLD

      // Convert frames/onsets to note events using tuning constants
      const noteEvents = outputToNotesPoly(
        allFrames,
        allOnsets,
        effectiveOnsetThresh,
        effectiveFrameThresh, // Use explicit frame threshold for consistent detection
        MIN_NOTE_LENGTH,
        inferOnsets, // preset-dependent: helps detect notes without clear attacks
        GUITAR_MAX_FREQ, // maxFreq: filter high-frequency artifacts
        GUITAR_MIN_FREQ, // minFreq: filter sub-bass rumble
        melodiaTrick, // preset-dependent: helps with melodic content
        ENERGY_TOLERANCE
      )

      // Check for cancellation
      if (signal.aborted) {
        throw new TranscriptionCancelledError()
      }

      // Add pitch bends from contours
      const notesWithBends = addPitchBendsToNoteEvents(allContours, noteEvents)

      // Convert to timed notes
      const allTimedNotes = noteFramesToTime(notesWithBends)

      // Filter out weak/hallucinated notes based on amplitude AND duration
      // This two-stage filter catches both quiet noise and short spikes
      const timedNotes = allTimedNotes.filter((note) => {
        // Filter 1: Amplitude must be above minimum
        if (note.amplitude < MIN_AMPLITUDE) return false

        // Filter 2: Duration must be above minimum
        if (note.durationSeconds < MIN_NOTE_DURATION_SEC) return false

        return true
      })

      // Step 5: Convert to our TranscribedNote format
      onProgress?.(95, 'Finalizing...')

      const notes = convertToTranscribedNotes(timedNotes, durationMs)

      // Calculate range
      const midiValues = notes.map((n) => n.midi)
      const minMidi = midiValues.length > 0 ? Math.min(...midiValues) : 0
      const maxMidi = midiValues.length > 0 ? Math.max(...midiValues) : 0

      onProgress?.(100, 'Complete')

      return {
        notes,
        noteCount: notes.length,
        range: { minMidi, maxMidi },
      }
    } finally {
      // Clear the abort controller when done (success or error)
      this.currentAbortController = null
    }
  }

  /**
   * Reset the service (useful for testing or freeing memory)
   */
  reset(): void {
    this.cancel()
    this.basicPitch = null
    this.modelLoadingPromise = null
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert Basic Pitch NoteEventTime[] to our TranscribedNote[] format.
 *
 * Processing pipeline:
 * 1. Convert to our TranscribedNote format
 * 2. Filter isolated noise notes (weak notes with no neighbors)
 * 3. Apply polyphony limit (max 6 simultaneous notes for guitar)
 * 4. Smart merge with pitch bend awareness
 */
function convertToTranscribedNotes(
  timedNotes: NoteEventTime[],
  _durationMs: number
): TranscribedNote[] {
  // Step 1: Convert to our format
  const notes = timedNotes
    .map((note) => ({
      startSec: note.startTimeSeconds,
      endSec: note.startTimeSeconds + note.durationSeconds,
      midi: note.pitchMidi,
      velocity: note.amplitude,
      pitchBend: note.pitchBends,
    }))
    .sort((a, b) => a.startSec - b.startSec)

  // Step 2: Filter isolated noise notes (weak notes far from other notes)
  const noiseFiltered = filterIsolatedNoiseNotes(notes)

  // Step 3: Apply polyphony limit (filter hallucinated harmonics/artifacts)
  const polyLimited = limitPolyphony(noiseFiltered, DEFAULT_MAX_POLYPHONY)

  // Step 4: Smart merge with pitch bend awareness
  const merged = smartMergeNotes(polyLimited)

  return merged
}

// Re-export midiToNoteName from noteUtils for backwards compatibility
export { midiToNoteName } from './noteUtils'

// ─────────────────────────────────────────────────────────────────────────────
// Export singleton instance
// ─────────────────────────────────────────────────────────────────────────────

export const transcriptionService = new TranscriptionServiceImpl()
