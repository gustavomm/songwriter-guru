// ─────────────────────────────────────────────────────────────────────────────
// Audio Decoder: Blob → AudioBuffer
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedAudio {
  audioBuffer: AudioBuffer
  sampleRate: number
  durationMs: number
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

  // Step 2: Resample to target rate (Basic Pitch expects 22050Hz)
  const resampledBuffer = await resampleAudio(audioBuffer, targetSampleRate)

  // Step 3: Convert to mono Float32Array
  const audioData = audioBufferToMono(resampledBuffer)

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

  // If already at target rate, return as-is
  if (sourceSampleRate === targetSampleRate) {
    return {
      audioData: pcmData,
      originalSampleRate: sourceSampleRate,
      durationMs,
    }
  }

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

    // Resample to target rate
    const resampledBuffer = await resampleAudio(sourceBuffer, targetSampleRate)

    // Get the resampled data
    const audioData = audioBufferToMono(resampledBuffer)

    return {
      audioData,
      originalSampleRate: sourceSampleRate,
      durationMs,
    }
  } finally {
    await audioContext.close()
  }
}
