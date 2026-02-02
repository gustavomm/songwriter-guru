/**
 * PCM Capture AudioWorklet Processor
 * 
 * Captures raw PCM float samples directly from the audio stream,
 * bypassing MediaRecorder's lossy compression for improved transcription accuracy.
 */

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super()
    this._isCapturing = true
  }

  /**
   * Process audio data from the input stream.
   * Called for each 128-sample block (at 44100Hz, ~2.9ms per block).
   */
  process(inputs, outputs, parameters) {
    // Check if we should continue capturing
    if (!this._isCapturing) {
      return false // Stop the processor
    }

    const input = inputs[0]
    
    // Only process if we have input data
    if (input && input.length > 0 && input[0].length > 0) {
      // Get the first channel (mono) - if stereo, we'll mix down in the service
      const channelData = input[0]
      
      // Create a copy of the samples (the buffer is reused by the audio system)
      const samples = new Float32Array(channelData.length)
      samples.set(channelData)
      
      // Send samples to the main thread
      this.port.postMessage({
        type: 'samples',
        samples: samples
      }, [samples.buffer]) // Transfer ownership for efficiency
    }

    // Return true to keep the processor running
    return true
  }
}

// Register the processor with the AudioWorklet system
registerProcessor('pcm-capture-processor', PCMCaptureProcessor)
