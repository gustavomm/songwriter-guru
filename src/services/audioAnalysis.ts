// ─────────────────────────────────────────────────────────────────────────────
// Audio Analysis: Extract metrics from audio for adaptive processing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Audio metrics extracted from input signal.
 * Used to adapt transcription parameters for optimal detection.
 */
export interface AudioMetrics {
  /** Peak amplitude in dBFS (0 = full scale, negative values below) */
  peakLevelDb: number
  /** RMS level in dBFS (average loudness) */
  rmsLevelDb: number
  /** Estimated noise floor in dBFS (from quietest frames) */
  noiseFloorDb: number
  /** Dynamic range: peak to RMS ratio in dB */
  dynamicRangeDb: number
  /** Whether the signal has clear transients (attacks) */
  hasTransients: boolean
  /** Linear peak amplitude (0-1) */
  peakLinear: number
  /** Linear RMS amplitude (0-1) */
  rmsLinear: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Frame size for analysis (in samples at target rate)
const ANALYSIS_FRAME_SIZE = 2048

// Number of quietest frames to use for noise floor estimation
const NOISE_FLOOR_PERCENTILE = 0.1 // Bottom 10% of frames

// Transient detection: ratio of frame energy to previous frame
const TRANSIENT_RATIO_THRESHOLD = 3.0 // 3x energy increase = transient

// Minimum number of transients to consider signal as "having transients"
const MIN_TRANSIENT_COUNT = 2

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert linear amplitude to dBFS (decibels relative to full scale).
 * Full scale (1.0) = 0 dBFS, silence approaches -Infinity.
 */
export function linearToDbfs(linear: number): number {
  if (linear <= 0) return -Infinity
  return 20 * Math.log10(linear)
}

/**
 * Convert dBFS to linear amplitude.
 */
export function dbfsToLinear(dbfs: number): number {
  if (dbfs === -Infinity) return 0
  return Math.pow(10, dbfs / 20)
}

/**
 * Calculate RMS (Root Mean Square) of an audio segment.
 */
function calculateRms(samples: Float32Array, start: number, length: number): number {
  let sumSquares = 0
  const end = Math.min(start + length, samples.length)
  const actualLength = end - start

  if (actualLength <= 0) return 0

  for (let i = start; i < end; i++) {
    sumSquares += samples[i] * samples[i]
  }

  return Math.sqrt(sumSquares / actualLength)
}

/**
 * Calculate peak amplitude of an audio segment.
 */
function calculatePeak(samples: Float32Array, start: number, length: number): number {
  let peak = 0
  const end = Math.min(start + length, samples.length)

  for (let i = start; i < end; i++) {
    const abs = Math.abs(samples[i])
    if (abs > peak) peak = abs
  }

  return peak
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Analysis Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Analyze audio data and extract metrics for adaptive processing.
 *
 * @param audioData - Audio samples as Float32Array (normalized -1 to 1)
 * @param sampleRate - Sample rate of the audio
 * @returns AudioMetrics object with analysis results
 */
export function analyzeAudio(audioData: Float32Array, _sampleRate: number): AudioMetrics {
  if (audioData.length === 0) {
    return {
      peakLevelDb: -Infinity,
      rmsLevelDb: -Infinity,
      noiseFloorDb: -Infinity,
      dynamicRangeDb: 0,
      hasTransients: false,
      peakLinear: 0,
      rmsLinear: 0,
    }
  }

  // Calculate overall peak
  const peakLinear = calculatePeak(audioData, 0, audioData.length)
  const peakLevelDb = linearToDbfs(peakLinear)

  // Calculate overall RMS
  const rmsLinear = calculateRms(audioData, 0, audioData.length)
  const rmsLevelDb = linearToDbfs(rmsLinear)

  // Frame-by-frame analysis for noise floor and transients
  const frameRmsValues: number[] = []
  const frameCount = Math.floor(audioData.length / ANALYSIS_FRAME_SIZE)
  let transientCount = 0
  let prevFrameEnergy = 0

  for (let i = 0; i < frameCount; i++) {
    const frameStart = i * ANALYSIS_FRAME_SIZE
    const frameRms = calculateRms(audioData, frameStart, ANALYSIS_FRAME_SIZE)
    frameRmsValues.push(frameRms)

    // Transient detection: check for sudden energy increase
    const frameEnergy = frameRms * frameRms
    // Use a small epsilon to avoid division by zero and handle near-silence
    const MIN_ENERGY = 1e-10
    if (i > 0) {
      // For frames coming from near-silence, check absolute energy threshold
      if (prevFrameEnergy < MIN_ENERGY && frameEnergy > MIN_ENERGY * TRANSIENT_RATIO_THRESHOLD) {
        // Transition from silence to sound is a transient
        transientCount++
      } else if (prevFrameEnergy >= MIN_ENERGY) {
        const energyRatio = frameEnergy / prevFrameEnergy
        if (energyRatio > TRANSIENT_RATIO_THRESHOLD) {
          transientCount++
        }
      }
    }
    prevFrameEnergy = frameEnergy
  }

  // Estimate noise floor from quietest frames
  let noiseFloorDb = -Infinity
  if (frameRmsValues.length > 0) {
    // Sort frames by RMS level
    const sortedRms = [...frameRmsValues].sort((a, b) => a - b)

    // Take the average of the quietest percentile
    const quietFrameCount = Math.max(1, Math.floor(sortedRms.length * NOISE_FLOOR_PERCENTILE))
    let quietSum = 0
    for (let i = 0; i < quietFrameCount; i++) {
      quietSum += sortedRms[i]
    }
    const avgQuietRms = quietSum / quietFrameCount
    noiseFloorDb = linearToDbfs(avgQuietRms)
  }

  // Calculate dynamic range (difference between peak and RMS in dB)
  const dynamicRangeDb = peakLevelDb - rmsLevelDb

  // Determine if signal has clear transients
  const hasTransients = transientCount >= MIN_TRANSIENT_COUNT

  return {
    peakLevelDb,
    rmsLevelDb,
    noiseFloorDb,
    dynamicRangeDb,
    hasTransients,
    peakLinear,
    rmsLinear,
  }
}

/**
 * Calculate the gain needed to normalize audio to a target peak level.
 *
 * @param currentPeakDb - Current peak level in dBFS
 * @param targetPeakDb - Target peak level in dBFS (default -3 dBFS)
 * @returns Linear gain multiplier
 */
export function calculateNormalizationGain(
  currentPeakDb: number,
  targetPeakDb: number = -3
): number {
  if (currentPeakDb === -Infinity) return 1 // Can't normalize silence

  const gainDb = targetPeakDb - currentPeakDb

  // Limit gain to prevent excessive amplification of quiet signals
  // Max +24dB gain (about 16x amplification)
  const limitedGainDb = Math.min(gainDb, 24)

  return dbfsToLinear(limitedGainDb)
}

/**
 * Apply gain to audio data (in-place modification).
 *
 * @param audioData - Audio samples to modify
 * @param gain - Linear gain multiplier
 * @param softClip - Whether to apply soft clipping to prevent harsh distortion
 */
export function applyGain(audioData: Float32Array, gain: number, softClip: boolean = true): void {
  for (let i = 0; i < audioData.length; i++) {
    let sample = audioData[i] * gain

    if (softClip && Math.abs(sample) > 0.95) {
      // Soft clip using tanh for smoother limiting
      sample = Math.tanh(sample)
    }

    audioData[i] = sample
  }
}

/**
 * Normalize audio data to a target peak level.
 *
 * @param audioData - Audio samples (will be modified in place)
 * @param targetPeakDb - Target peak level in dBFS (default -3 dBFS)
 * @returns The gain that was applied
 */
export function normalizeAudio(audioData: Float32Array, targetPeakDb: number = -3): number {
  const metrics = analyzeAudio(audioData, 22050) // Sample rate doesn't matter for peak
  const gain = calculateNormalizationGain(metrics.peakLevelDb, targetPeakDb)

  if (gain !== 1) {
    applyGain(audioData, gain, true)
  }

  return gain
}
