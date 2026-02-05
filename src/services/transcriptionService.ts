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
import {
  prepareAudioForTranscription,
  prepareRawPcmForTranscription,
  type AudioMetrics,
} from './audioDecoder'
import {
  limitPolyphony,
  smartMergeNotes,
  filterIsolatedNoiseNotes,
  DEFAULT_MAX_POLYPHONY,
} from './noteProcessing'
import {
  detectOnsets,
  snapNotesToOnsets,
  hasStrongOnsetNear,
  type OnsetEvent,
} from './onsetDetection'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Basic Pitch expects 22050Hz sample rate
const TARGET_SAMPLE_RATE = 22050

// Model path - uses Vite's BASE_URL to work with GitHub Pages subdirectory
const MODEL_PATH = `${import.meta.env.BASE_URL}basic-pitch-model/model.json`

// ─────────────────────────────────────────────────────────────────────────────
// Base Transcription Parameters
// These are the baseline values that get adjusted by adaptive thresholds
// ─────────────────────────────────────────────────────────────────────────────

// Base onset threshold: 0.5 is the default
// Higher = stricter onset detection, fewer false positives
const BASE_ONSET_THRESHOLD = 0.5

// Base frame threshold: requires pitch activation to be above this
// Higher = requires stronger pitch confidence
const BASE_FRAME_THRESHOLD = 0.35

// Minimum note length in frames (~11.6ms per frame at 22050Hz)
// 11 frames ≈ 128ms - minimum for real notes
const BASE_MIN_NOTE_LENGTH = 11

// Energy tolerance: how quickly a note can decay before being cut off
const ENERGY_TOLERANCE = 11

// Guitar frequency range (for filtering false positives)
// Low: ~65Hz supports drop C tuning
// High: ~3000Hz covers highest frets + upper harmonics
const GUITAR_MIN_FREQ = 65
const GUITAR_MAX_FREQ = 3000

// Base amplitude floor for filtering weak notes
const BASE_MIN_AMPLITUDE = 0.3

// Minimum note duration in seconds (post-processing filter)
const BASE_MIN_NOTE_DURATION_SEC = 0.06 // 60ms minimum

// ─────────────────────────────────────────────────────────────────────────────
// Adaptive Threshold Configuration
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Adaptive thresholds calculated from audio metrics.
 */
interface AdaptiveThresholds {
  onsetThreshold: number
  frameThreshold: number
  minNoteLength: number
  minAmplitude: number
  minNoteDuration: number
}

/**
 * Calculate adaptive thresholds based on audio metrics.
 *
 * The idea: adjust detection sensitivity based on input characteristics:
 * - Quieter recordings get more sensitive detection (lower thresholds)
 * - Noisier recordings get stricter detection (higher thresholds)
 * - Higher dynamic range suggests more transients (sensitive onset detection)
 */
function calculateAdaptiveThresholds(
  metrics: AudioMetrics,
  preset: TranscriptionPreset
): AdaptiveThresholds {
  // Signal-to-noise ratio estimate (how much signal above noise floor)
  const snrDb = metrics.rmsLevelDb - metrics.noiseFloorDb

  // SNR factor: good SNR (>20dB) = full sensitivity, poor SNR (<10dB) = reduced sensitivity
  // Range: 0.7 to 1.0
  const snrFactor = Math.min(1.0, Math.max(0.7, 0.5 + snrDb / 40))

  // Dynamic range factor: high dynamic range (>15dB) indicates clear transients
  // For lead playing, we want more sensitive onset detection with high dynamics
  // Range: 0.85 to 1.0
  const dynamicFactor = metrics.hasTransients ? 0.9 : 1.0

  // Level factor: after normalization, this reflects original recording quality
  // Very quiet original recordings may have more noise even after normalization
  // Use the original RMS level before normalization
  // Range: 0.8 to 1.0
  const originalLevel = metrics.rmsLevelDb
  const levelFactor = Math.min(1.0, Math.max(0.8, 0.6 - originalLevel / 50))

  // Preset adjustments
  const presetOnsetBoost = preset === 'chord' ? 0.05 : 0
  const presetFrameBoost = preset === 'chord' ? 0.05 : 0
  const presetMinLengthBoost = preset === 'chord' ? 2 : 0

  // Calculate final thresholds
  // For thresholds, lower = more sensitive, so multiply by factors
  const onsetThreshold = Math.min(
    0.7,
    Math.max(0.3, (BASE_ONSET_THRESHOLD + presetOnsetBoost) * snrFactor)
  )

  const frameThreshold = Math.min(
    0.5,
    Math.max(0.2, (BASE_FRAME_THRESHOLD + presetFrameBoost) * snrFactor * dynamicFactor)
  )

  // Min note length: increase for noisy signals
  const minNoteLength = Math.round((BASE_MIN_NOTE_LENGTH + presetMinLengthBoost) / snrFactor)

  // Min amplitude: lower for clean signals with good dynamics
  const minAmplitude = Math.min(
    0.5,
    Math.max(0.2, BASE_MIN_AMPLITUDE * levelFactor * (metrics.hasTransients ? 0.9 : 1.0))
  )

  // Min duration: slightly shorter for signals with clear transients
  const minNoteDuration = metrics.hasTransients
    ? BASE_MIN_NOTE_DURATION_SEC * 0.8
    : BASE_MIN_NOTE_DURATION_SEC

  return {
    onsetThreshold,
    frameThreshold,
    minNoteLength,
    minAmplitude,
    minNoteDuration,
  }
}

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
   * Now includes adaptive thresholds based on audio analysis for improved
   * detection across different recording conditions.
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
      // Now includes metrics from audio analysis
      let audioData: Float32Array
      let durationMs: number
      let metrics: AudioMetrics

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
        metrics = prepared.metrics
      } else {
        // Fallback: Decode compressed blob (lossy)
        onProgress?.(10, 'Decoding audio...')
        const prepared = await prepareAudioForTranscription(recordingAsset.blob, TARGET_SAMPLE_RATE)
        audioData = prepared.audioData
        durationMs = prepared.durationMs
        metrics = prepared.metrics
      }

      // Check for cancellation
      if (signal.aborted) {
        throw new TranscriptionCancelledError()
      }

      // Step 3: Calculate adaptive thresholds based on audio metrics
      const thresholds = calculateAdaptiveThresholds(metrics, preset)

      // Step 3b: Run onset detection for improved timing
      const detectedOnsets = detectOnsets(audioData, TARGET_SAMPLE_RATE)

      // Log metrics and thresholds for debugging (development only)
      if (import.meta.env.DEV) {
        console.log('[Transcription] Audio metrics:', {
          peakDb: metrics.peakLevelDb.toFixed(1),
          rmsDb: metrics.rmsLevelDb.toFixed(1),
          noiseFloorDb: metrics.noiseFloorDb.toFixed(1),
          dynamicRangeDb: metrics.dynamicRangeDb.toFixed(1),
          hasTransients: metrics.hasTransients,
        })
        console.log('[Transcription] Adaptive thresholds:', {
          onset: thresholds.onsetThreshold.toFixed(3),
          frame: thresholds.frameThreshold.toFixed(3),
          minNoteLength: thresholds.minNoteLength,
          minAmplitude: thresholds.minAmplitude.toFixed(3),
          minNoteDuration: thresholds.minNoteDuration.toFixed(3),
        })
        console.log('[Transcription] Detected onsets:', detectedOnsets.length)
      }

      // Step 4: Run inference
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

      // Step 5: Convert to note events using adaptive thresholds
      onProgress?.(90, 'Processing notes...')

      // Preset-specific settings
      // Lead: inferOnsets + melodiaTrick help detect melody continuity
      // Chord: disable both to reduce ghost notes from dense strumming
      const inferOnsets = preset === 'lead'
      const melodiaTrick = preset === 'lead'

      // Convert frames/onsets to note events using adaptive thresholds
      const noteEvents = outputToNotesPoly(
        allFrames,
        allOnsets,
        thresholds.onsetThreshold,
        thresholds.frameThreshold,
        thresholds.minNoteLength,
        inferOnsets,
        GUITAR_MAX_FREQ,
        GUITAR_MIN_FREQ,
        melodiaTrick,
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

      // Filter out weak/hallucinated notes using adaptive thresholds
      const timedNotes = allTimedNotes.filter((note) => {
        // Filter 1: Amplitude must be above adaptive minimum
        if (note.amplitude < thresholds.minAmplitude) return false

        // Filter 2: Duration must be above adaptive minimum
        if (note.durationSeconds < thresholds.minNoteDuration) return false

        return true
      })

      // Step 6: Convert to our TranscribedNote format with onset enhancement
      onProgress?.(95, 'Finalizing...')

      const notes = convertToTranscribedNotes(timedNotes, durationMs, detectedOnsets)

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
 * 2. Snap note start times to detected onsets (improved timing)
 * 3. Filter isolated noise notes (weak notes with no neighbors)
 * 4. Apply polyphony limit (max 6 simultaneous notes for guitar)
 * 5. Smart merge with pitch bend awareness
 * 6. Filter weak notes without clear onset support
 */
function convertToTranscribedNotes(
  timedNotes: NoteEventTime[],
  _durationMs: number,
  detectedOnsets: OnsetEvent[] = []
): TranscribedNote[] {
  // Step 1: Convert to our format
  let notes = timedNotes
    .map((note) => ({
      startSec: note.startTimeSeconds,
      endSec: note.startTimeSeconds + note.durationSeconds,
      midi: note.pitchMidi,
      velocity: note.amplitude,
      pitchBend: note.pitchBends,
    }))
    .sort((a, b) => a.startSec - b.startSec)

  // Step 2: Snap note start times to detected onsets for better timing
  if (detectedOnsets.length > 0) {
    notes = snapNotesToOnsets(notes, detectedOnsets, 0.03) // 30ms snap window
  }

  // Step 3: Filter isolated noise notes (weak notes far from other notes)
  const noiseFiltered = filterIsolatedNoiseNotes(notes)

  // Step 4: Apply polyphony limit (filter hallucinated harmonics/artifacts)
  const polyLimited = limitPolyphony(noiseFiltered, DEFAULT_MAX_POLYPHONY)

  // Step 5: Smart merge with pitch bend awareness
  const merged = smartMergeNotes(polyLimited)

  // Step 6: Additional filtering - remove weak notes that don't have onset support
  // This helps catch false positives that passed through other filters
  const onsetFiltered =
    detectedOnsets.length > 0 ? filterWeakNotesWithoutOnset(merged, detectedOnsets) : merged

  return onsetFiltered
}

/**
 * Filter out weak notes that don't have a corresponding detected onset.
 * Strong notes are kept regardless of onset detection.
 */
function filterWeakNotesWithoutOnset(
  notes: TranscribedNote[],
  onsets: OnsetEvent[],
  weakThreshold: number = 0.4, // Notes below this velocity are considered "weak"
  onsetSearchWindow: number = 0.05 // 50ms window to find onset
): TranscribedNote[] {
  return notes.filter((note) => {
    // Strong notes are always kept
    if ((note.velocity ?? 1) >= weakThreshold) {
      return true
    }

    // For weak notes, require onset support
    return hasStrongOnsetNear(onsets, note.startSec, onsetSearchWindow, 0.2)
  })
}

// Re-export midiToNoteName from noteUtils for backwards compatibility
export { midiToNoteName } from './noteUtils'

// ─────────────────────────────────────────────────────────────────────────────
// Export singleton instance
// ─────────────────────────────────────────────────────────────────────────────

export const transcriptionService = new TranscriptionServiceImpl()
