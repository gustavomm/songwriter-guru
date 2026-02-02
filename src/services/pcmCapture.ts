/**
 * PCM Capture Service
 *
 * Captures raw PCM float samples using AudioWorklet for lossless audio capture.
 * This bypasses MediaRecorder's lossy compression (Opus) for improved transcription accuracy.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface PCMCaptureResult {
  /** Raw PCM samples as Float32Array */
  pcmData: Float32Array
  /** Sample rate of the captured audio */
  sampleRate: number
  /** Duration in milliseconds */
  durationMs: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature Detection
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Check if AudioWorklet is supported in this browser.
 * AudioWorklet requires:
 * - AudioContext with audioWorklet property
 * - Secure context (HTTPS or localhost)
 */
export function isPCMCaptureSupported(): boolean {
  try {
    // Check for AudioContext
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) {
      return false
    }

    // Check for audioWorklet support
    const testContext = new AudioContextClass()
    const hasWorklet = 'audioWorklet' in testContext
    testContext.close()

    // Check for secure context (required for worklets)
    const isSecureContext = window.isSecureContext

    return hasWorklet && isSecureContext
  } catch {
    return false
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PCM Capture Class
// ─────────────────────────────────────────────────────────────────────────────

export class PCMCapture {
  private audioContext: AudioContext | null = null
  private sourceNode: MediaStreamAudioSourceNode | null = null
  private workletNode: AudioWorkletNode | null = null
  private sampleChunks: Float32Array[] = []
  private isCapturing = false
  private startTime = 0

  /**
   * Start capturing PCM samples from the given MediaStream.
   *
   * @param stream - MediaStream from getUserMedia
   * @returns Promise that resolves when capture is ready
   */
  async startCapture(stream: MediaStream): Promise<void> {
    if (this.isCapturing) {
      throw new Error('PCM capture is already in progress')
    }

    // Create AudioContext
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    this.audioContext = new AudioContextClass()

    try {
      // Load the worklet processor
      await this.audioContext.audioWorklet.addModule('/pcm-capture-processor.js')

      // Create source node from the stream
      this.sourceNode = this.audioContext.createMediaStreamSource(stream)

      // Create the worklet node
      this.workletNode = new AudioWorkletNode(this.audioContext, 'pcm-capture-processor')

      // Handle incoming samples from the worklet
      this.workletNode.port.onmessage = (event) => {
        if (event.data.type === 'samples' && this.isCapturing) {
          this.sampleChunks.push(event.data.samples)
        }
      }

      // Connect the audio graph: source -> worklet (-> nowhere, we just capture)
      this.sourceNode.connect(this.workletNode)
      // Don't connect to destination - we don't want to hear the input

      // Start capturing
      this.sampleChunks = []
      this.isCapturing = true
      this.startTime = Date.now()
    } catch (error) {
      // Clean up on error
      await this.cleanup()
      throw error
    }
  }

  /**
   * Stop capturing and return the accumulated PCM data.
   *
   * @returns PCMCaptureResult with the raw audio data
   */
  async stopCapture(): Promise<PCMCaptureResult | null> {
    if (!this.isCapturing || !this.audioContext) {
      return null
    }

    this.isCapturing = false
    const durationMs = Date.now() - this.startTime
    const sampleRate = this.audioContext.sampleRate

    // Concatenate all sample chunks into a single Float32Array
    const totalLength = this.sampleChunks.reduce((acc, chunk) => acc + chunk.length, 0)
    const pcmData = new Float32Array(totalLength)

    let offset = 0
    for (const chunk of this.sampleChunks) {
      pcmData.set(chunk, offset)
      offset += chunk.length
    }

    // Clean up
    await this.cleanup()

    return {
      pcmData,
      sampleRate,
      durationMs,
    }
  }

  /**
   * Cancel capture and clean up resources.
   */
  async cancel(): Promise<void> {
    this.isCapturing = false
    await this.cleanup()
  }

  /**
   * Check if capture is currently in progress.
   */
  get capturing(): boolean {
    return this.isCapturing
  }

  /**
   * Clean up all audio resources.
   */
  private async cleanup(): Promise<void> {
    // Disconnect nodes
    if (this.sourceNode) {
      this.sourceNode.disconnect()
      this.sourceNode = null
    }

    if (this.workletNode) {
      this.workletNode.disconnect()
      this.workletNode.port.close()
      this.workletNode = null
    }

    // Close audio context
    if (this.audioContext && this.audioContext.state !== 'closed') {
      await this.audioContext.close()
      this.audioContext = null
    }

    // Clear sample buffer
    this.sampleChunks = []
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Singleton instance for convenience
// ─────────────────────────────────────────────────────────────────────────────

let pcmCaptureInstance: PCMCapture | null = null

/**
 * Get the shared PCMCapture instance.
 */
export function getPCMCapture(): PCMCapture {
  if (!pcmCaptureInstance) {
    pcmCaptureInstance = new PCMCapture()
  }
  return pcmCaptureInstance
}
