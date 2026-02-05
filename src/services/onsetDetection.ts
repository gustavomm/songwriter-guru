// ─────────────────────────────────────────────────────────────────────────────
// Onset Detection: Spectral flux-based note onset detection
// Supplements Basic Pitch's onset detection for improved timing accuracy
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detected onset event with timing and strength information.
 */
export interface OnsetEvent {
  /** Time of onset in seconds */
  timeSec: number
  /** Strength of the onset (0-1, higher = more pronounced attack) */
  strength: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// FFT parameters
const FFT_SIZE = 2048 // ~93ms window at 22050Hz
const HOP_SIZE = 512 // ~23ms hop at 22050Hz (4x overlap)

// Onset detection parameters
const MEDIAN_FILTER_SIZE = 7 // Frames for adaptive threshold
const ONSET_THRESHOLD_MULTIPLIER = 1.5 // Multiplier above median for onset
const MIN_ONSET_INTERVAL_SEC = 0.03 // 30ms minimum between onsets
const ONSET_STRENGTH_FLOOR = 0.1 // Minimum flux value to consider

// ─────────────────────────────────────────────────────────────────────────────
// FFT Implementation (using Web Audio API's built-in AnalyserNode approach)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Simple FFT implementation for spectral analysis.
 * Uses the Cooley-Tukey radix-2 DIT algorithm.
 */
class SimpleFFT {
  private size: number
  private cosTable: Float32Array
  private sinTable: Float32Array

  constructor(size: number) {
    this.size = size
    this.cosTable = new Float32Array(size / 2)
    this.sinTable = new Float32Array(size / 2)

    // Precompute twiddle factors
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size
      this.cosTable[i] = Math.cos(angle)
      this.sinTable[i] = Math.sin(angle)
    }
  }

  /**
   * Compute magnitude spectrum from real-valued input.
   * Returns only the positive frequency bins (size/2 + 1).
   */
  magnitudeSpectrum(input: Float32Array): Float32Array {
    const real = new Float32Array(this.size)
    const imag = new Float32Array(this.size)

    // Copy input and apply Hann window
    for (let i = 0; i < this.size; i++) {
      const window = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (this.size - 1)))
      real[i] = (input[i] || 0) * window
      imag[i] = 0
    }

    // In-place FFT
    this.fft(real, imag)

    // Compute magnitudes for positive frequencies
    const numBins = this.size / 2 + 1
    const magnitudes = new Float32Array(numBins)
    for (let i = 0; i < numBins; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
    }

    return magnitudes
  }

  /**
   * In-place Cooley-Tukey FFT.
   */
  private fft(real: Float32Array, imag: Float32Array): void {
    const n = this.size

    // Bit reversal
    let j = 0
    for (let i = 0; i < n - 1; i++) {
      if (i < j) {
        let temp = real[i]
        real[i] = real[j]
        real[j] = temp
        temp = imag[i]
        imag[i] = imag[j]
        imag[j] = temp
      }
      let k = n / 2
      while (k <= j) {
        j -= k
        k /= 2
      }
      j += k
    }

    // FFT computation
    for (let len = 2; len <= n; len *= 2) {
      const halfLen = len / 2
      const tableStep = n / len

      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < halfLen; k++) {
          const idx = i + k
          const idx2 = idx + halfLen
          const tableIdx = k * tableStep

          const tReal = real[idx2] * this.cosTable[tableIdx] - imag[idx2] * this.sinTable[tableIdx]
          const tImag = real[idx2] * this.sinTable[tableIdx] + imag[idx2] * this.cosTable[tableIdx]

          real[idx2] = real[idx] - tReal
          imag[idx2] = imag[idx] - tImag
          real[idx] += tReal
          imag[idx] += tImag
        }
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spectral Flux Calculation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Calculate spectral flux between consecutive frames.
 * Spectral flux measures the change in the spectrum, detecting attacks.
 *
 * Uses half-wave rectification: only counts positive changes (energy increases).
 */
function calculateSpectralFlux(prevSpectrum: Float32Array, currSpectrum: Float32Array): number {
  let flux = 0
  const numBins = Math.min(prevSpectrum.length, currSpectrum.length)

  for (let i = 0; i < numBins; i++) {
    // Half-wave rectified difference (only positive changes)
    const diff = currSpectrum[i] - prevSpectrum[i]
    if (diff > 0) {
      flux += diff
    }
  }

  return flux
}

/**
 * Apply median filter to smooth the flux curve.
 * Returns the median of values in a sliding window.
 */
function medianFilter(values: number[], windowSize: number): number[] {
  const result: number[] = []
  const halfWindow = Math.floor(windowSize / 2)

  for (let i = 0; i < values.length; i++) {
    const start = Math.max(0, i - halfWindow)
    const end = Math.min(values.length, i + halfWindow + 1)
    const window = values.slice(start, end).sort((a, b) => a - b)
    result.push(window[Math.floor(window.length / 2)])
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Onset Detection Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detect onsets in audio using spectral flux analysis.
 *
 * Algorithm:
 * 1. Compute STFT (Short-Time Fourier Transform) with overlapping windows
 * 2. Calculate spectral flux between consecutive frames
 * 3. Apply adaptive threshold using median filter
 * 4. Peak-pick to find onset times
 *
 * @param audioData - Audio samples as Float32Array (mono, normalized)
 * @param sampleRate - Sample rate of the audio
 * @returns Array of detected onset events
 */
export function detectOnsets(audioData: Float32Array, sampleRate: number): OnsetEvent[] {
  if (audioData.length < FFT_SIZE) {
    return []
  }

  const fft = new SimpleFFT(FFT_SIZE)
  const numFrames = Math.floor((audioData.length - FFT_SIZE) / HOP_SIZE) + 1

  // Calculate spectral flux for each frame
  const fluxValues: number[] = []
  let prevSpectrum = new Float32Array(FFT_SIZE / 2 + 1)

  for (let frame = 0; frame < numFrames; frame++) {
    const frameStart = frame * HOP_SIZE
    const frameData = audioData.slice(frameStart, frameStart + FFT_SIZE)

    const spectrum = fft.magnitudeSpectrum(frameData)
    const flux = calculateSpectralFlux(prevSpectrum, spectrum)
    fluxValues.push(flux)

    prevSpectrum = spectrum
  }

  // Normalize flux values
  const maxFlux = Math.max(...fluxValues, 0.001)
  const normalizedFlux = fluxValues.map((f) => f / maxFlux)

  // Calculate adaptive threshold using median filter
  const medianValues = medianFilter(normalizedFlux, MEDIAN_FILTER_SIZE)

  // Peak-picking with adaptive threshold
  const onsets: OnsetEvent[] = []
  const minIntervalFrames = Math.ceil((MIN_ONSET_INTERVAL_SEC * sampleRate) / HOP_SIZE)
  let lastOnsetFrame = -minIntervalFrames

  for (let i = 1; i < normalizedFlux.length - 1; i++) {
    const flux = normalizedFlux[i]
    const threshold = medianValues[i] * ONSET_THRESHOLD_MULTIPLIER + ONSET_STRENGTH_FLOOR

    // Check if this is a local maximum above threshold
    const isPeak = flux > normalizedFlux[i - 1] && flux > normalizedFlux[i + 1]
    const aboveThreshold = flux > threshold
    const afterMinInterval = i - lastOnsetFrame >= minIntervalFrames

    if (isPeak && aboveThreshold && afterMinInterval) {
      const timeSec = (i * HOP_SIZE) / sampleRate
      onsets.push({
        timeSec,
        strength: flux,
      })
      lastOnsetFrame = i
    }
  }

  return onsets
}

/**
 * Find the nearest onset to a given time.
 * Returns the onset if within maxDistance, otherwise undefined.
 */
export function findNearestOnset(
  onsets: OnsetEvent[],
  timeSec: number,
  maxDistanceSec: number = 0.05
): OnsetEvent | undefined {
  let nearest: OnsetEvent | undefined
  let minDistance = Infinity

  for (const onset of onsets) {
    const distance = Math.abs(onset.timeSec - timeSec)
    if (distance < minDistance && distance <= maxDistanceSec) {
      minDistance = distance
      nearest = onset
    }
  }

  return nearest
}

/**
 * Snap note start times to detected onsets.
 * Improves timing accuracy when onsets are nearby.
 *
 * @param notes - Array of notes with startSec property
 * @param onsets - Detected onset events
 * @param maxSnapDistance - Maximum distance to snap (in seconds)
 * @returns Notes with start times potentially adjusted to onsets
 */
export function snapNotesToOnsets<T extends { startSec: number }>(
  notes: T[],
  onsets: OnsetEvent[],
  maxSnapDistance: number = 0.03
): T[] {
  if (onsets.length === 0) return notes

  return notes.map((note) => {
    const nearestOnset = findNearestOnset(onsets, note.startSec, maxSnapDistance)
    if (nearestOnset) {
      return { ...note, startSec: nearestOnset.timeSec }
    }
    return note
  })
}

/**
 * Get onset density (onsets per second) for a time window.
 * Useful for detecting sections with lots of activity.
 */
export function getOnsetDensity(onsets: OnsetEvent[], startSec: number, endSec: number): number {
  const duration = endSec - startSec
  if (duration <= 0) return 0

  const onsetsInWindow = onsets.filter((o) => o.timeSec >= startSec && o.timeSec <= endSec)

  return onsetsInWindow.length / duration
}

/**
 * Check if there's a strong onset near a given time.
 * Used to determine if a note has a clear attack.
 */
export function hasStrongOnsetNear(
  onsets: OnsetEvent[],
  timeSec: number,
  maxDistance: number = 0.03,
  minStrength: number = 0.3
): boolean {
  const nearest = findNearestOnset(onsets, timeSec, maxDistance)
  return nearest !== undefined && nearest.strength >= minStrength
}
