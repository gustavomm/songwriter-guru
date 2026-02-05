// ─────────────────────────────────────────────────────────────────────────────
// Spectral Processing: FFT-based noise reduction and spectral analysis
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

// FFT parameters for noise reduction
const NOISE_FFT_SIZE = 2048
const NOISE_HOP_SIZE = 512 // 75% overlap for smooth reconstruction

// Noise estimation parameters
const NOISE_ESTIMATION_PERCENTILE = 0.1 // Use quietest 10% of frames for noise estimate
const MIN_NOISE_FRAMES = 5 // Minimum frames needed for noise estimation

// Spectral subtraction parameters
// These are tuned to be gentle - preserving signal over aggressive noise removal
const SPECTRAL_FLOOR = 0.15 // Minimum spectral magnitude (max 16dB attenuation)
const OVERSUBTRACTION_FACTOR = 0.8 // Subtract less than estimated noise (conservative)
const SMOOTHING_FACTOR = 0.15 // Light temporal smoothing to preserve transients

// ─────────────────────────────────────────────────────────────────────────────
// FFT Implementation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FFT processor for spectral analysis and synthesis.
 */
class FFTProcessor {
  private size: number
  private cosTable: Float32Array
  private sinTable: Float32Array
  private hannWindow: Float32Array

  constructor(size: number) {
    this.size = size
    this.cosTable = new Float32Array(size / 2)
    this.sinTable = new Float32Array(size / 2)
    this.hannWindow = new Float32Array(size)

    // Precompute twiddle factors
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size
      this.cosTable[i] = Math.cos(angle)
      this.sinTable[i] = Math.sin(angle)
    }

    // Precompute Hann window
    for (let i = 0; i < size; i++) {
      this.hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (size - 1)))
    }
  }

  /**
   * Forward FFT: time domain -> frequency domain
   */
  forward(input: Float32Array): { real: Float32Array; imag: Float32Array } {
    const real = new Float32Array(this.size)
    const imag = new Float32Array(this.size)

    // Apply window and copy
    for (let i = 0; i < this.size; i++) {
      real[i] = (input[i] || 0) * this.hannWindow[i]
      imag[i] = 0
    }

    this.fft(real, imag, false)

    return { real, imag }
  }

  /**
   * Inverse FFT: frequency domain -> time domain
   */
  inverse(real: Float32Array, imag: Float32Array): Float32Array {
    const outReal = new Float32Array(real)
    const outImag = new Float32Array(imag)

    this.fft(outReal, outImag, true)

    // Scale and apply window for overlap-add
    const output = new Float32Array(this.size)
    for (let i = 0; i < this.size; i++) {
      output[i] = (outReal[i] / this.size) * this.hannWindow[i]
    }

    return output
  }

  /**
   * In-place Cooley-Tukey FFT
   */
  private fft(real: Float32Array, imag: Float32Array, inverse: boolean): void {
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
    const sign = inverse ? 1 : -1
    for (let len = 2; len <= n; len *= 2) {
      const halfLen = len / 2
      const tableStep = n / len

      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < halfLen; k++) {
          const idx = i + k
          const idx2 = idx + halfLen
          const tableIdx = k * tableStep

          const cos = this.cosTable[tableIdx]
          const sin = sign * this.sinTable[tableIdx]

          const tReal = real[idx2] * cos - imag[idx2] * sin
          const tImag = real[idx2] * sin + imag[idx2] * cos

          real[idx2] = real[idx] - tReal
          imag[idx2] = imag[idx] - tImag
          real[idx] += tReal
          imag[idx] += tImag
        }
      }
    }
  }

  /**
   * Get the Hann window for overlap-add normalization
   */
  getWindow(): Float32Array {
    return this.hannWindow
  }

  /**
   * Get FFT size
   */
  getSize(): number {
    return this.size
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Spectral Noise Reduction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Estimate noise spectrum from the quietest frames of audio.
 */
function estimateNoiseSpectrum(
  audioData: Float32Array,
  fft: FFTProcessor,
  hopSize: number
): Float32Array {
  const fftSize = fft.getSize()
  const numBins = fftSize / 2 + 1
  const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1

  if (numFrames < MIN_NOISE_FRAMES) {
    // Not enough frames, return zero noise estimate
    return new Float32Array(numBins)
  }

  // Calculate magnitude spectrum and energy for each frame
  const frameData: { energy: number; magnitudes: Float32Array }[] = []

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize
    const frameBuffer = audioData.slice(start, start + fftSize)

    const { real, imag } = fft.forward(frameBuffer)

    // Calculate magnitudes and energy
    const magnitudes = new Float32Array(numBins)
    let energy = 0

    for (let i = 0; i < numBins; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
      energy += magnitudes[i] * magnitudes[i]
    }

    frameData.push({ energy, magnitudes })
  }

  // Sort frames by energy (quietest first)
  frameData.sort((a, b) => a.energy - b.energy)

  // Take the average of the quietest frames as noise estimate
  const numNoiseFrames = Math.max(
    MIN_NOISE_FRAMES,
    Math.floor(numFrames * NOISE_ESTIMATION_PERCENTILE)
  )

  const noiseSpectrum = new Float32Array(numBins)
  for (let i = 0; i < numNoiseFrames; i++) {
    for (let bin = 0; bin < numBins; bin++) {
      noiseSpectrum[bin] += frameData[i].magnitudes[bin]
    }
  }

  // Average
  for (let bin = 0; bin < numBins; bin++) {
    noiseSpectrum[bin] /= numNoiseFrames
  }

  return noiseSpectrum
}

/**
 * Apply spectral subtraction to reduce noise.
 *
 * Algorithm:
 * 1. Compute STFT of the signal
 * 2. Estimate noise spectrum from quietest frames
 * 3. Subtract noise spectrum from each frame (with spectral flooring)
 * 4. Reconstruct signal via inverse STFT with overlap-add
 */
export function spectralNoiseReduction(
  audioData: Float32Array,
  sampleRate: number,
  precomputedNoiseProfile?: Float32Array
): Float32Array {
  const fft = new FFTProcessor(NOISE_FFT_SIZE)
  const fftSize = fft.getSize()
  const hopSize = NOISE_HOP_SIZE
  const numBins = fftSize / 2 + 1

  // Estimate noise spectrum if not provided
  const noiseSpectrum = precomputedNoiseProfile || estimateNoiseSpectrum(audioData, fft, hopSize)

  // Prepare output buffer
  const output = new Float32Array(audioData.length)
  const windowSum = new Float32Array(audioData.length) // For overlap-add normalization

  const numFrames = Math.floor((audioData.length - fftSize) / hopSize) + 1
  const window = fft.getWindow()

  // Previous frame's gain for smoothing
  let prevGain = new Float32Array(numBins).fill(1)

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize
    const frameBuffer = audioData.slice(start, start + fftSize)

    // Forward FFT
    const { real, imag } = fft.forward(frameBuffer)

    // Calculate magnitudes
    const magnitudes = new Float32Array(numBins)
    const phases = new Float32Array(numBins)

    for (let i = 0; i < numBins; i++) {
      magnitudes[i] = Math.sqrt(real[i] * real[i] + imag[i] * imag[i])
      phases[i] = Math.atan2(imag[i], real[i])
    }

    // Spectral subtraction with Wiener-like gain
    const gain = new Float32Array(numBins)
    for (let i = 0; i < numBins; i++) {
      const noiseMag = noiseSpectrum[i] * OVERSUBTRACTION_FACTOR
      const signalPower = magnitudes[i] * magnitudes[i]
      const noisePower = noiseMag * noiseMag

      // Wiener-like gain calculation
      let g = Math.max(0, 1 - noisePower / (signalPower + 0.0001))

      // Apply spectral floor to prevent musical noise
      g = Math.max(SPECTRAL_FLOOR, g)

      // Temporal smoothing
      g = SMOOTHING_FACTOR * prevGain[i] + (1 - SMOOTHING_FACTOR) * g

      gain[i] = g
    }

    prevGain = gain

    // Apply gain and reconstruct complex spectrum
    const newReal = new Float32Array(fftSize)
    const newImag = new Float32Array(fftSize)

    for (let i = 0; i < numBins; i++) {
      const newMag = magnitudes[i] * gain[i]
      newReal[i] = newMag * Math.cos(phases[i])
      newImag[i] = newMag * Math.sin(phases[i])

      // Mirror for negative frequencies (except DC and Nyquist)
      if (i > 0 && i < numBins - 1) {
        newReal[fftSize - i] = newReal[i]
        newImag[fftSize - i] = -newImag[i]
      }
    }

    // Inverse FFT
    const reconstructed = fft.inverse(newReal, newImag)

    // Overlap-add
    for (let i = 0; i < fftSize; i++) {
      if (start + i < output.length) {
        output[start + i] += reconstructed[i]
        windowSum[start + i] += window[i] * window[i]
      }
    }
  }

  // Normalize by window sum (overlap-add normalization)
  for (let i = 0; i < output.length; i++) {
    if (windowSum[i] > 0.0001) {
      output[i] /= windowSum[i]
    }
  }

  return output
}

/**
 * Estimate the noise profile from a segment of audio (e.g., silence before the recording).
 * Can be used to pre-compute noise profile for better results.
 */
export function estimateNoiseProfile(
  noiseSegment: Float32Array,
  _sampleRate: number
): Float32Array {
  const fft = new FFTProcessor(NOISE_FFT_SIZE)
  return estimateNoiseSpectrum(noiseSegment, fft, NOISE_HOP_SIZE)
}

/**
 * Check if spectral noise reduction would be beneficial for the audio.
 * Returns true if the signal appears noisy enough to warrant processing.
 * Uses a conservative threshold to avoid processing clean signals.
 */
export function shouldApplyNoiseReduction(audioData: Float32Array, noiseFloorDb: number): boolean {
  // Only apply NR if noise floor is quite high (above -40dB)
  // This avoids processing relatively clean signals
  return noiseFloorDb > -40
}
