import {
    BasicPitch,
    noteFramesToTime,
    outputToNotesPoly,
    addPitchBendsToNoteEvents,
    type NoteEventTime,
} from '@spotify/basic-pitch'
import type { TranscribedNote, TranscriptionResult, RecordingAsset, TranscriptionPreset } from '../domain/types'
import { prepareAudioForTranscription, prepareRawPcmForTranscription } from './audioDecoder'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Basic Pitch expects 22050Hz sample rate
const TARGET_SAMPLE_RATE = 22050

// Model path - Basic Pitch includes model in node_modules
// We'll copy to public/ for production, or use dynamic import path
const MODEL_PATH = '/basic-pitch-model/model.json'

// ─────────────────────────────────────────────────────────────────────────────
// Transcription Tuning Parameters
// Adjust these to find the sweet spot for your use case:
// - Higher values = fewer notes detected (stricter)
// - Lower values = more notes detected (more sensitive)
// ─────────────────────────────────────────────────────────────────────────────
// Detection thresholds
const ONSET_THRESHOLD = 0.4 // Range: 0.2 (sensitive) to 0.6 (strict)
// Note: frameThresh is set to null in outputToNotesPoly for adaptive detection
// (computed from mean + std of frames, more robust across different recordings)

// Basic Pitch timing: 22050Hz sample rate, 256-sample hop
// → ~86 frames/sec → ~11.6ms per frame
// 11 frames ≈ 128ms (matches Basic Pitch's default minimum note length)
const MIN_NOTE_LENGTH = 11 // Frames (~11.6ms each, total ~128ms)
const ENERGY_TOLERANCE = 10

// Guitar frequency range (for filtering false positives)
// Low: ~70Hz supports drop tunings (Drop D low is ~73Hz, Drop C is ~65Hz)
// High: ~2500Hz covers highest frets + strong upper partials
const GUITAR_MIN_FREQ = 70   // Hz - supports drop tunings
const GUITAR_MAX_FREQ = 2500 // Hz - high frets + harmonics

// Amplitude floor for filtering weak/hallucinated notes
const MIN_AMPLITUDE = 0.25

// Guitar polyphony limit (6 strings max - filters hallucinated harmonics/artifacts)
const MAX_POLYPHONY = 6

// Pitch bend threshold for detecting intentional bends vs artifacts
const SIGNIFICANT_BEND_THRESHOLD = 0.3 // semitones

// Post-processing merge settings
const MERGE_TIME_THRESHOLD = 0.15 // Max gap (seconds) to consider notes as "connected"
const WOBBLE_SEMITONES = 1 // Pitch deviation to consider as wobble (half-step)

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
    async ensureModelLoaded(
        onProgress?: (message: string) => void
    ): Promise<BasicPitch> {
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
            const basicPitch = await this.ensureModelLoaded((msg) =>
                onProgress?.(5, msg)
            )

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
                const prepared = await prepareAudioForTranscription(
                    recordingAsset.blob,
                    TARGET_SAMPLE_RATE
                )
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

            // Convert frames/onsets to note events using tuning constants
            const noteEvents = outputToNotesPoly(
                allFrames,
                allOnsets,
                ONSET_THRESHOLD,
                undefined, // frameThresh: undefined = adaptive (computed from mean+std of frames)
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

            // Filter out weak/hallucinated notes based on amplitude
            const timedNotes = allTimedNotes.filter(note => note.amplitude >= MIN_AMPLITUDE)

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
 * Concatenate pitch bend arrays from merged notes.
 * Returns undefined if no bends exist.
 */
function concatenatePitchBends(...notes: TranscribedNote[]): number[] | undefined {
    const allBends: number[] = []
    for (const note of notes) {
        if (note.pitchBend && note.pitchBend.length > 0) {
            allBends.push(...note.pitchBend)
        }
    }
    return allBends.length > 0 ? allBends : undefined
}

/**
 * Check if a note has significant pitch bend (likely intentional vibrato/slide).
 */
function hasSignificantPitchBend(note: TranscribedNote): boolean {
    if (!note.pitchBend || note.pitchBend.length === 0) return false
    return note.pitchBend.some(bend => Math.abs(bend) > SIGNIFICANT_BEND_THRESHOLD)
}

/**
 * Limit polyphony to MAX_POLYPHONY simultaneous notes (guitar has 6 strings).
 * When more notes overlap, keep the ones with highest amplitude.
 * This filters out hallucinated notes from harmonics/artifacts.
 */
function limitPolyphony(notes: TranscribedNote[]): TranscribedNote[] {
    if (notes.length <= MAX_POLYPHONY) return notes

    // Sort by start time
    const sorted = [...notes].sort((a, b) => a.startSec - b.startSec)

    const result: TranscribedNote[] = []

    for (const note of sorted) {
        // Find notes that overlap with this one
        const overlapping = result.filter(n =>
            n.endSec > note.startSec && n.startSec < note.endSec
        )

        if (overlapping.length < MAX_POLYPHONY) {
            result.push(note)
        } else {
            // Check if this note has higher amplitude than any overlapping note
            const lowestAmp = overlapping.reduce((min, n) =>
                (n.velocity ?? 0) < (min.velocity ?? 0) ? n : min
            )
            if ((note.velocity ?? 0) > (lowestAmp.velocity ?? 0)) {
                // Remove lowest and add this one
                const idx = result.indexOf(lowestAmp)
                result.splice(idx, 1)
                result.push(note)
            }
            // Otherwise, drop this note (likely hallucination)
        }
    }

    return result.sort((a, b) => a.startSec - b.startSec)
}

/**
 * Convert Basic Pitch NoteEventTime[] to our TranscribedNote[] format.
 * 
 * Processing pipeline:
 * 1. Convert to our TranscribedNote format
 * 2. Apply polyphony limit (max 6 simultaneous notes for guitar)
 * 3. Smart merge with pitch bend awareness
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

    // Step 2: Apply polyphony limit (filter hallucinated harmonics/artifacts)
    const polyLimited = limitPolyphony(notes)

    // Step 3: Smart merge with pitch bend awareness
    const merged = smartMergeNotes(polyLimited)

    return merged
}

/**
 * Smart merge algorithm:
 * 1. Group notes that are temporally connected (within MERGE_TIME_THRESHOLD)
 * 2. Within each group, identify "anchor" notes and absorb wobble notes (±1 semitone)
 * 3. Merge consecutive same-pitch notes into longer sustained notes
 * 4. Preserve gaps between groups (intentional rests)
 */
function smartMergeNotes(notes: TranscribedNote[]): TranscribedNote[] {
    if (notes.length === 0) return []

    // Step 1: Group notes into phrases (connected sequences)
    const phrases = groupIntoPhrases(notes)

    // Step 2: Clean up each phrase
    const cleanedPhrases = phrases.map(cleanPhrase)

    // Step 3: Flatten back to single array
    return cleanedPhrases.flat()
}

/**
 * Group notes into phrases based on temporal proximity.
 * A new phrase starts when there's a gap > MERGE_TIME_THRESHOLD with no notes.
 */
function groupIntoPhrases(notes: TranscribedNote[]): TranscribedNote[][] {
    if (notes.length === 0) return []

    const phrases: TranscribedNote[][] = []
    let currentPhrase: TranscribedNote[] = [notes[0]]

    for (let i = 1; i < notes.length; i++) {
        const prev = notes[i - 1]
        const curr = notes[i]

        // Check if there's a significant gap
        const gap = curr.startSec - prev.endSec

        if (gap > MERGE_TIME_THRESHOLD) {
            // Start a new phrase
            phrases.push(currentPhrase)
            currentPhrase = [curr]
        } else {
            // Continue current phrase
            currentPhrase.push(curr)
        }
    }

    // Don't forget the last phrase
    phrases.push(currentPhrase)

    return phrases
}

/**
 * Clean up a phrase by:
 * 1. Identifying dominant pitches
 * 2. Absorbing wobble notes (±1 semitone surrounded by same pitch)
 * 3. Merging consecutive same-pitch notes
 */
function cleanPhrase(phrase: TranscribedNote[]): TranscribedNote[] {
    if (phrase.length === 0) return []
    if (phrase.length === 1) return phrase

    // Step 1: Absorb wobble notes into surrounding dominant pitch
    const deWobbled = absorbWobbleNotes(phrase)

    // Step 2: Merge consecutive same-pitch notes
    const merged = mergeConsecutiveSamePitch(deWobbled)

    return merged
}

/**
 * Absorb short "wobble" notes that are ±1 semitone from surrounding notes.
 * Pattern: A -> B -> A where B is ±1 semitone from A and B is short
 * Result: Extend the first A to cover B and merge with second A
 * 
 * BUT: If the middle note has significant pitch bend, it's likely intentional
 * vibrato or a slide, so we preserve it instead of absorbing.
 */
function absorbWobbleNotes(notes: TranscribedNote[]): TranscribedNote[] {
    if (notes.length < 3) return notes

    const result: TranscribedNote[] = []
    let i = 0

    while (i < notes.length) {
        const current = notes[i]

        // Look ahead: is this a wobble pattern? (A -> wobble -> A)
        if (i + 2 < notes.length) {
            const middle = notes[i + 1]
            const after = notes[i + 2]

            // Check if middle note has significant pitch bend (likely intentional)
            const middleHasIntentionalBend = hasSignificantPitchBend(middle)

            const isWobble =
                current.midi === after.midi && // Same pitch before and after
                Math.abs(middle.midi - current.midi) <= WOBBLE_SEMITONES && // Middle is close
                (middle.endSec - middle.startSec) < 0.2 && // Middle note is short (<200ms)
                !middleHasIntentionalBend // NOT an intentional bend/vibrato

            if (isWobble) {
                // Merge all three into one note with the dominant pitch
                // Preserve pitch bends from all three notes
                const vel1 = current.velocity ?? 0.5
                const vel2 = after.velocity ?? 0.5
                result.push({
                    startSec: current.startSec,
                    endSec: after.endSec,
                    midi: current.midi, // Use the dominant pitch
                    velocity: (vel1 + vel2) / 2,
                    pitchBend: concatenatePitchBends(current, middle, after),
                })
                i += 3 // Skip all three notes
                continue
            }
        }

        // Not a wobble pattern, keep the note with its pitch bend
        result.push({ ...current })
        i++
    }

    return result
}

/**
 * Merge consecutive notes with the same pitch into longer notes.
 * Preserves pitch bends by concatenating them when merging.
 */
function mergeConsecutiveSamePitch(notes: TranscribedNote[]): TranscribedNote[] {
    if (notes.length === 0) return []

    const result: TranscribedNote[] = []
    let current = { ...notes[0] }

    for (let i = 1; i < notes.length; i++) {
        const next = notes[i]
        const gap = next.startSec - current.endSec

        // Merge if same pitch and close together (or overlapping)
        if (next.midi === current.midi && gap <= MERGE_TIME_THRESHOLD) {
            // Extend current note
            current.endSec = Math.max(current.endSec, next.endSec)
            // Average velocities
            if (current.velocity !== undefined && next.velocity !== undefined) {
                current.velocity = (current.velocity + next.velocity) / 2
            }
            // Concatenate pitch bends when merging
            current.pitchBend = concatenatePitchBends(current, next)
        } else {
            // Different pitch or gap too large - save and start new
            result.push(current)
            current = { ...next }
        }
    }

    // Don't forget the last note
    result.push(current)

    return result
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

// ─────────────────────────────────────────────────────────────────────────────
// Export singleton instance
// ─────────────────────────────────────────────────────────────────────────────

export const transcriptionService = new TranscriptionServiceImpl()
