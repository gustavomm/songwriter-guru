// ─────────────────────────────────────────────────────────────────────────────
// Audio Decoder: Blob → AudioBuffer
// Includes professional-grade pre-processing for improved transcription accuracy
// ─────────────────────────────────────────────────────────────────────────────

import { analyzeAudio, normalizeAudio, type AudioMetrics } from './audioAnalysis'
import { spectralNoiseReduction, shouldApplyNoiseReduction } from './spectralProcessing'

export interface DecodedAudio {
  audioBuffer: AudioBuffer
  sampleRate: number
  durationMs: number
}

export interface PreparedAudio {
  audioData: Float32Array
  originalSampleRate: number
  durationMs: number
  metrics: AudioMetrics
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio Pre-processing Constants
// ─────────────────────────────────────────────────────────────────────────────

// High-pass filter to remove low-frequency rumble
// 65Hz supports drop C tuning (~65Hz) while filtering sub-bass
const HIGH_PASS_FREQUENCY = 65

// Low-pass filter - increased to 5kHz to preserve more harmonics
// Basic Pitch will handle the frequency selection
const LOW_PASS_FREQUENCY = 5000

// AC hum frequencies to notch out (50Hz in Europe, 60Hz in Americas)
const HUM_FREQUENCIES = [50, 60]
// Harmonics of hum frequencies
const HUM_HARMONICS = [100, 120, 150, 180]

// Notch filter Q values (higher = narrower notch)
const NOTCH_Q_FUNDAMENTAL = 30 // Narrow notch for fundamentals
const NOTCH_Q_HARMONIC = 20 // Slightly wider for harmonics

// Target normalization level in dBFS
// -3dBFS is industry standard for headroom
const TARGET_PEAK_DBFS = -3

// Noise gate threshold - adaptive based on noise floor
// This is the ratio above noise floor to consider as signal
// Lower values = more signal passes through
const NOISE_GATE_RATIO = 1.5

// Gate smoothing parameters (in samples at 22050Hz)
const GATE_ATTACK_SAMPLES = 220 // ~10ms attack
const GATE_RELEASE_SAMPLES = 1102 // ~50ms release

// Spectral noise reduction threshold
// Apply spectral NR if noise floor is above this level (dB)
// Conservative threshold to avoid processing clean signals
const SPECTRAL_NR_THRESHOLD_DB = -40

// Frequency bands for frequency-aware gating
const FREQ_BANDS = {
  bass: { low: 0, high: 250, weight: 0.3 },
  mid: { low: 250, high: 2000, weight: 0.5 },
  high: { low: 2000, high: 8000, weight: 0.2 },
}

/**
 * Decode an audio Blob into an AudioBuffer using the Web Audio API.
 * Works with any format the browser supports (webm, mp3, wav, etc.)
 */
export async function decodeAudioBlob(blob: Blob): Promise<DecodedAudio> {
  // Convert Blob to ArrayBuffer
  const arrayBuffer = await blob.arrayBuffer()

  // Create AudioContext for decoding
  const audioContext = new AudioContext()

  try {
    // Decode the audio data
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)

    return {
      audioBuffer,
      sampleRate: audioBuffer.sampleRate,
      durationMs: Math.round(audioBuffer.duration * 1000),
    }
  } finally {
    // Close the context to free resources
    await audioContext.close()
  }
}

/**
 * Convert an AudioBuffer to a mono Float32Array.
 * If stereo, averages the channels.
 */
export function audioBufferToMono(audioBuffer: AudioBuffer): Float32Array {
  const numChannels = audioBuffer.numberOfChannels

  if (numChannels === 1) {
    // Return a copy to avoid modifying the original buffer
    return new Float32Array(audioBuffer.getChannelData(0))
  }

  // Mix down to mono by averaging all channels
  const length = audioBuffer.length
  const mono = new Float32Array(length)

  for (let ch = 0; ch < numChannels; ch++) {
    const channelData = audioBuffer.getChannelData(ch)
    for (let i = 0; i < length; i++) {
      mono[i] += channelData[i]
    }
  }

  // Average
  for (let i = 0; i < length; i++) {
    mono[i] /= numChannels
  }

  return mono
}

/**
 * Resample audio data to a target sample rate.
 * Uses OfflineAudioContext for high-quality resampling.
 */
export async function resampleAudio(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  if (audioBuffer.sampleRate === targetSampleRate) {
    return audioBuffer
  }

  const duration = audioBuffer.duration
  const targetLength = Math.ceil(duration * targetSampleRate)

  const offlineContext = new OfflineAudioContext(
    1, // mono output
    targetLength,
    targetSampleRate
  )

  // Create a buffer source
  const source = offlineContext.createBufferSource()
  source.buffer = audioBuffer
  source.connect(offlineContext.destination)
  source.start(0)

  // Render the resampled audio
  const resampledBuffer = await offlineContext.startRendering()

  return resampledBuffer
}

/**
 * Apply multiple filters in a chain using a single OfflineAudioContext.
 */
async function applyFilterChain(
  audioBuffer: AudioBuffer,
  filters: Array<{ type: BiquadFilterType; frequency: number; Q: number }>
): Promise<AudioBuffer> {
  if (filters.length === 0) return audioBuffer

  const offlineContext = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  )

  // Create source
  const source = offlineContext.createBufferSource()
  source.buffer = audioBuffer

  // Create and chain filters
  let currentNode: AudioNode = source
  for (const filterConfig of filters) {
    const filter = offlineContext.createBiquadFilter()
    filter.type = filterConfig.type
    filter.frequency.value = filterConfig.frequency
    filter.Q.value = filterConfig.Q
    currentNode.connect(filter)
    currentNode = filter
  }

  // Connect last filter to destination
  currentNode.connect(offlineContext.destination)
  source.start(0)

  return offlineContext.startRendering()
}

/**
 * Apply multi-band filtering for noise reduction:
 * 1. Notch filters for AC hum (50/60Hz and harmonics)
 * 2. High-pass filter for sub-bass rumble
 * 3. Low-pass filter for high-frequency noise
 */
async function applyMultiBandFiltering(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
  const filters: Array<{ type: BiquadFilterType; frequency: number; Q: number }> = []

  // 1. Notch filters for AC hum fundamentals (50Hz and 60Hz)
  for (const freq of HUM_FREQUENCIES) {
    filters.push({ type: 'notch', frequency: freq, Q: NOTCH_Q_FUNDAMENTAL })
  }

  // 2. Notch filters for hum harmonics (100Hz, 120Hz, 150Hz, 180Hz)
  for (const freq of HUM_HARMONICS) {
    filters.push({ type: 'notch', frequency: freq, Q: NOTCH_Q_HARMONIC })
  }

  // 3. High-pass filter for sub-bass rumble
  filters.push({ type: 'highpass', frequency: HIGH_PASS_FREQUENCY, Q: 0.707 })

  // 4. Low-pass filter for high-frequency noise
  filters.push({ type: 'lowpass', frequency: LOW_PASS_FREQUENCY, Q: 0.707 })

  return applyFilterChain(audioBuffer, filters)
}

/**
 * Simple band-pass filter for frequency band isolation.
 * Uses a pair of biquad filters (high-pass + low-pass).
 */
async function isolateFrequencyBand(
  audioBuffer: AudioBuffer,
  lowFreq: number,
  highFreq: number
): Promise<AudioBuffer> {
  const filters: Array<{ type: BiquadFilterType; frequency: number; Q: number }> = []

  if (lowFreq > 0) {
    filters.push({ type: 'highpass', frequency: lowFreq, Q: 0.707 })
  }
  if (highFreq < audioBuffer.sampleRate / 2) {
    filters.push({ type: 'lowpass', frequency: highFreq, Q: 0.707 })
  }

  if (filters.length === 0) return audioBuffer
  return applyFilterChain(audioBuffer, filters)
}

/**
 * Apply a frequency-aware adaptive noise gate.
 *
 * This gate analyzes energy in multiple frequency bands and applies
 * gating based on where the signal energy is concentrated.
 * This helps preserve low-frequency content (bass notes) while
 * gating high-frequency noise more aggressively.
 */
async function applyFrequencyAwareGate(
  audioBuffer: AudioBuffer,
  noiseFloorLinear: number,
  sampleRate: number
): Promise<Float32Array> {
  // Get mono audio data
  const audioData = audioBufferToMono(audioBuffer)

  // Calculate threshold as a multiple of the noise floor
  const threshold = noiseFloorLinear * NOISE_GATE_RATIO

  // Scale attack/release to current sample rate
  const attackSamples = Math.round((GATE_ATTACK_SAMPLES * sampleRate) / 22050)
  const releaseSamples = Math.round((GATE_RELEASE_SAMPLES * sampleRate) / 22050)

  // Calculate attack/release coefficients
  const attackCoeff = 1 - Math.exp(-1 / attackSamples)
  const releaseCoeff = 1 - Math.exp(-1 / releaseSamples)

  // Analyze frequency bands for weighted gating decision
  // This is done once for the whole signal to save computation
  const bandBuffers: { band: keyof typeof FREQ_BANDS; data: Float32Array }[] = []

  for (const [bandName, bandConfig] of Object.entries(FREQ_BANDS)) {
    try {
      const bandBuffer = await isolateFrequencyBand(audioBuffer, bandConfig.low, bandConfig.high)
      bandBuffers.push({
        band: bandName as keyof typeof FREQ_BANDS,
        data: audioBufferToMono(bandBuffer),
      })
    } catch {
      // If band isolation fails, use full band
      bandBuffers.push({
        band: bandName as keyof typeof FREQ_BANDS,
        data: audioData,
      })
    }
  }

  const result = new Float32Array(audioData.length)
  let envelope = 0
  let gateGain = 0

  // RMS window size (about 10ms)
  const rmsWindow = Math.round(sampleRate * 0.01)

  for (let i = 0; i < audioData.length; i++) {
    // Calculate weighted RMS across frequency bands
    let weightedRms = 0
    const windowStart = Math.max(0, i - rmsWindow)
    const windowEnd = Math.min(audioData.length, i + rmsWindow)
    const windowLength = windowEnd - windowStart

    for (const { band, data } of bandBuffers) {
      let bandSumSquares = 0
      for (let j = windowStart; j < windowEnd; j++) {
        bandSumSquares += data[j] * data[j]
      }
      const bandRms = Math.sqrt(bandSumSquares / windowLength)
      weightedRms += bandRms * FREQ_BANDS[band].weight
    }

    // Update envelope with attack/release
    if (weightedRms > envelope) {
      envelope = envelope + attackCoeff * (weightedRms - envelope)
    } else {
      envelope = envelope + releaseCoeff * (weightedRms - envelope)
    }

    // Calculate gate gain (smooth transition)
    const targetGain = envelope > threshold ? 1 : Math.pow(envelope / threshold, 2)

    // Smooth the gain changes
    if (targetGain > gateGain) {
      gateGain = gateGain + attackCoeff * (targetGain - gateGain)
    } else {
      gateGain = gateGain + releaseCoeff * (targetGain - gateGain)
    }

    result[i] = audioData[i] * gateGain
  }

  return result
}

/**
 * Simple adaptive noise gate (fallback when frequency-aware is not needed).
 * Uses the analyzed noise floor for intelligent gating.
 */
function applySimpleNoiseGate(
  audioData: Float32Array,
  noiseFloorLinear: number,
  sampleRate: number
): Float32Array {
  // Calculate threshold as a multiple of the noise floor
  const threshold = noiseFloorLinear * NOISE_GATE_RATIO

  // Scale attack/release to current sample rate
  const attackSamples = Math.round((GATE_ATTACK_SAMPLES * sampleRate) / 22050)
  const releaseSamples = Math.round((GATE_RELEASE_SAMPLES * sampleRate) / 22050)

  // Calculate attack/release coefficients
  const attackCoeff = 1 - Math.exp(-1 / attackSamples)
  const releaseCoeff = 1 - Math.exp(-1 / releaseSamples)

  const result = new Float32Array(audioData.length)
  let envelope = 0
  let gateGain = 0

  // RMS window size (about 10ms)
  const rmsWindow = Math.round(sampleRate * 0.01)

  for (let i = 0; i < audioData.length; i++) {
    // Calculate local RMS
    let sumSquares = 0
    const windowStart = Math.max(0, i - rmsWindow)
    const windowEnd = Math.min(audioData.length, i + rmsWindow)
    const windowLength = windowEnd - windowStart

    for (let j = windowStart; j < windowEnd; j++) {
      sumSquares += audioData[j] * audioData[j]
    }
    const rms = Math.sqrt(sumSquares / windowLength)

    // Update envelope with attack/release
    if (rms > envelope) {
      envelope = envelope + attackCoeff * (rms - envelope)
    } else {
      envelope = envelope + releaseCoeff * (rms - envelope)
    }

    // Calculate gate gain (smooth transition)
    const targetGain = envelope > threshold ? 1 : Math.pow(envelope / threshold, 2)

    // Smooth the gain changes
    if (targetGain > gateGain) {
      gateGain = gateGain + attackCoeff * (targetGain - gateGain)
    } else {
      gateGain = gateGain + releaseCoeff * (targetGain - gateGain)
    }

    result[i] = audioData[i] * gateGain
  }

  return result
}

/**
 * Full pre-processing pipeline for transcription:
 * 1. Multi-band filtering (notch + HP + LP)
 * 2. Resampling to target rate
 * 3. Convert to mono
 * 4. Analyze audio metrics
 * 5. Spectral noise reduction (if signal is noisy)
 * 6. Normalize to target level
 * 7. Frequency-aware noise gate
 */
async function preprocessForTranscription(
  audioBuffer: AudioBuffer,
  targetSampleRate: number
): Promise<{ audioData: Float32Array; metrics: AudioMetrics }> {
  // Step 1: Multi-band filtering (before resampling for better quality)
  const filteredBuffer = await applyMultiBandFiltering(audioBuffer)

  // Step 2: Resample to target rate
  const resampledBuffer = await resampleAudio(filteredBuffer, targetSampleRate)

  // Step 3: Convert to mono Float32Array
  let audioData = audioBufferToMono(resampledBuffer)

  // Step 4: Analyze audio metrics (before normalization)
  const metrics = analyzeAudio(audioData, targetSampleRate)

  // Step 5: Apply spectral noise reduction for noisy signals
  // This helps clean up background noise before pitch detection
  const isNoisy = shouldApplyNoiseReduction(audioData, metrics.noiseFloorDb)
  let spectralNrApplied = false
  if (isNoisy && metrics.noiseFloorDb > SPECTRAL_NR_THRESHOLD_DB) {
    try {
      audioData = spectralNoiseReduction(audioData, targetSampleRate)
      spectralNrApplied = true
    } catch (err) {
      // If spectral NR fails, continue without it
      console.warn('Spectral noise reduction failed, continuing without:', err)
    }
  }

  // Step 6: Normalize to target level
  normalizeAudio(audioData, TARGET_PEAK_DBFS)

  // Step 7: Apply noise gate
  // Convert noise floor from dB to linear for the gate
  const noiseFloorLinear = Math.pow(10, metrics.noiseFloorDb / 20)

  // If spectral NR was applied, use simple gate to avoid double-processing
  // Otherwise, use frequency-aware gate for noisy signals
  if (spectralNrApplied) {
    // Spectral NR already cleaned the noise, use light simple gate
    audioData = applySimpleNoiseGate(audioData, noiseFloorLinear, targetSampleRate)
  } else if (isNoisy) {
    // No spectral NR, use frequency-aware gate for better noise handling
    const tempContext = new AudioContext()
    try {
      const tempBuffer = tempContext.createBuffer(1, audioData.length, targetSampleRate)
      tempBuffer.copyToChannel(audioData, 0)
      audioData = await applyFrequencyAwareGate(tempBuffer, noiseFloorLinear, targetSampleRate)
    } catch {
      // Fallback to simple gate if frequency-aware fails
      audioData = applySimpleNoiseGate(audioData, noiseFloorLinear, targetSampleRate)
    } finally {
      await tempContext.close()
    }
  } else {
    // Clean signal, use simple gate
    audioData = applySimpleNoiseGate(audioData, noiseFloorLinear, targetSampleRate)
  }

  return { audioData, metrics }
}

/**
 * Full pipeline: Decode blob, convert to mono, resample to target rate.
 * Returns the processed Float32Array ready for Basic Pitch.
 *
 * NOTE: This path uses lossy-compressed audio (from MediaRecorder).
 * For better transcription accuracy, use prepareRawPcmForTranscription when
 * raw PCM data is available from AudioWorklet capture.
 */
export async function prepareAudioForTranscription(
  blob: Blob,
  targetSampleRate: number = 22050
): Promise<PreparedAudio> {
  // Step 1: Decode the blob
  const { audioBuffer, sampleRate, durationMs } = await decodeAudioBlob(blob)

  // Step 2-6: Full pre-processing pipeline
  const { audioData, metrics } = await preprocessForTranscription(audioBuffer, targetSampleRate)

  return {
    audioData,
    originalSampleRate: sampleRate,
    durationMs,
    metrics,
  }
}

/**
 * Prepare raw PCM data for transcription (lossless path).
 *
 * This function takes raw PCM samples captured via AudioWorklet and processes
 * them for Basic Pitch. This bypasses MediaRecorder's lossy compression for
 * improved transcription accuracy.
 *
 * Includes professional-grade pre-processing:
 * - Multi-band filtering (notch + HP + LP)
 * - Loudness normalization
 * - Adaptive noise gate
 *
 * @param pcmData - Raw PCM samples as Float32Array (mono)
 * @param sourceSampleRate - Sample rate of the input data (typically 44100 or 48000 Hz)
 * @param targetSampleRate - Target sample rate for Basic Pitch (default 22050 Hz)
 */
export async function prepareRawPcmForTranscription(
  pcmData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number = 22050
): Promise<PreparedAudio> {
  const durationMs = Math.round((pcmData.length / sourceSampleRate) * 1000)

  // Create an AudioBuffer from the raw PCM data
  const audioContext = new AudioContext()

  try {
    // Create a buffer with the raw PCM data
    const sourceBuffer = audioContext.createBuffer(1, pcmData.length, sourceSampleRate)
    sourceBuffer.copyToChannel(new Float32Array(pcmData), 0)

    // Full pre-processing pipeline
    const { audioData, metrics } = await preprocessForTranscription(sourceBuffer, targetSampleRate)

    return {
      audioData,
      originalSampleRate: sourceSampleRate,
      durationMs,
      metrics,
    }
  } finally {
    await audioContext.close()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export for backwards compatibility and convenience
// ─────────────────────────────────────────────────────────────────────────────

export { analyzeAudio, type AudioMetrics } from './audioAnalysis'
