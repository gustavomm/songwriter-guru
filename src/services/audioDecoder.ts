// ─────────────────────────────────────────────────────────────────────────────
// Audio Decoder: Blob → AudioBuffer
// Includes pre-processing for improved transcription accuracy
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedAudio {
  audioBuffer: AudioBuffer
  sampleRate: number
  durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Audio Pre-processing Constants
// ─────────────────────────────────────────────────────────────────────────────

// High-pass filter to remove low-frequency rumble (below guitar's low E ~82Hz)
// Using 60Hz to allow for drop tunings
const HIGH_PASS_FREQUENCY = 60

// Low-pass filter to remove high-frequency hiss/noise (above guitar's useful range)
const LOW_PASS_FREQUENCY = 4000

// Noise gate threshold (RMS below this is considered silence/noise)
// Expressed as a fraction of the signal's peak amplitude
const NOISE_GATE_THRESHOLD = 0.02

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
    return audioBuffer.getChannelData(0)
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
 * Apply a biquad filter to an AudioBuffer.
 * Used for high-pass and low-pass filtering.
 */
async function applyBiquadFilter(
  audioBuffer: AudioBuffer,
  filterType: BiquadFilterType,
  frequency: number
): Promise<AudioBuffer> {
  const offlineContext = new OfflineAudioContext(
    audioBuffer.numberOfChannels,
    audioBuffer.length,
    audioBuffer.sampleRate
  )

  // Create source
  const source = offlineContext.createBufferSource()
  source.buffer = audioBuffer

  // Create filter
  const filter = offlineContext.createBiquadFilter()
  filter.type = filterType
  filter.frequency.value = frequency
  filter.Q.value = 0.707 // Butterworth response (flat passband)

  // Connect: source -> filter -> destination
  source.connect(filter)
  filter.connect(offlineContext.destination)
  source.start(0)

  return offlineContext.startRendering()
}

/**
 * Apply a simple noise gate to audio data.
 * Reduces samples below the threshold to zero.
 */
function applyNoiseGate(audioData: Float32Array, threshold: number): Float32Array {
  // Find peak amplitude
  let peak = 0
  for (let i = 0; i < audioData.length; i++) {
    const abs = Math.abs(audioData[i])
    if (abs > peak) peak = abs
  }

  // Calculate absolute threshold
  const absThreshold = peak * threshold

  // Apply gate with smoothing (to avoid clicks)
  const result = new Float32Array(audioData.length)
  const smoothingWindow = 64 // samples for smoothing

  for (let i = 0; i < audioData.length; i++) {
    // Calculate local RMS for gate decision
    let sumSquares = 0
    const windowStart = Math.max(0, i - smoothingWindow)
    const windowEnd = Math.min(audioData.length, i + smoothingWindow)
    for (let j = windowStart; j < windowEnd; j++) {
      sumSquares += audioData[j] * audioData[j]
    }
    const rms = Math.sqrt(sumSquares / (windowEnd - windowStart))

    // Apply soft gate (smooth transition)
    if (rms < absThreshold) {
      // Below threshold - attenuate based on how far below
      const attenuation = rms / absThreshold
      result[i] = audioData[i] * attenuation * attenuation // Quadratic for smoother gate
    } else {
      result[i] = audioData[i]
    }
  }

  return result
}

/**
 * Pre-process audio for transcription:
 * 1. High-pass filter to remove rumble
 * 2. Low-pass filter to remove hiss
 * 3. Noise gate to reduce background noise
 */
async function preprocessAudioBuffer(audioBuffer: AudioBuffer): Promise<AudioBuffer> {
  // Step 1: High-pass filter (remove low-frequency rumble)
  let processed = await applyBiquadFilter(audioBuffer, 'highpass', HIGH_PASS_FREQUENCY)

  // Step 2: Low-pass filter (remove high-frequency hiss)
  processed = await applyBiquadFilter(processed, 'lowpass', LOW_PASS_FREQUENCY)

  return processed
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
): Promise<{
  audioData: Float32Array
  originalSampleRate: number
  durationMs: number
}> {
  // Step 1: Decode the blob
  const { audioBuffer, sampleRate, durationMs } = await decodeAudioBlob(blob)

  // Step 2: Pre-process (filter noise)
  const filteredBuffer = await preprocessAudioBuffer(audioBuffer)

  // Step 3: Resample to target rate (Basic Pitch expects 22050Hz)
  const resampledBuffer = await resampleAudio(filteredBuffer, targetSampleRate)

  // Step 4: Convert to mono Float32Array
  let audioData = audioBufferToMono(resampledBuffer)

  // Step 5: Apply noise gate
  audioData = applyNoiseGate(audioData, NOISE_GATE_THRESHOLD)

  return {
    audioData,
    originalSampleRate: sampleRate,
    durationMs,
  }
}

/**
 * Prepare raw PCM data for transcription (lossless path).
 *
 * This function takes raw PCM samples captured via AudioWorklet and resamples
 * them to the target sample rate for Basic Pitch. This bypasses MediaRecorder's
 * lossy compression for improved transcription accuracy.
 *
 * Includes pre-processing:
 * - High-pass filter to remove rumble
 * - Low-pass filter to remove hiss
 * - Noise gate to reduce background noise
 *
 * @param pcmData - Raw PCM samples as Float32Array (mono)
 * @param sourceSampleRate - Sample rate of the input data (typically 44100 or 48000 Hz)
 * @param targetSampleRate - Target sample rate for Basic Pitch (default 22050 Hz)
 */
export async function prepareRawPcmForTranscription(
  pcmData: Float32Array,
  sourceSampleRate: number,
  targetSampleRate: number = 22050
): Promise<{
  audioData: Float32Array
  originalSampleRate: number
  durationMs: number
}> {
  const durationMs = Math.round((pcmData.length / sourceSampleRate) * 1000)

  // Create an AudioBuffer from the raw PCM data
  const audioContext = new AudioContext()

  try {
    // Create a buffer with the raw PCM data
    const sourceBuffer = audioContext.createBuffer(
      1, // mono
      pcmData.length,
      sourceSampleRate
    )
    sourceBuffer.copyToChannel(new Float32Array(pcmData), 0)

    // Step 1: Pre-process (filter noise) - do this before resampling for better quality
    const filteredBuffer = await preprocessAudioBuffer(sourceBuffer)

    // Step 2: Resample to target rate
    const resampledBuffer = await resampleAudio(filteredBuffer, targetSampleRate)

    // Step 3: Convert to mono Float32Array
    let audioData = audioBufferToMono(resampledBuffer)

    // Step 4: Apply noise gate
    audioData = applyNoiseGate(audioData, NOISE_GATE_THRESHOLD)

    return {
      audioData,
      originalSampleRate: sourceSampleRate,
      durationMs,
    }
  } finally {
    await audioContext.close()
  }
}
