export type RecordingStatus =
  | 'idle'
  | 'recording'
  | 'recorded'
  | 'decoding'
  | 'transcribing'
  | 'analyzed'
  | 'error'

export interface RecordingAsset {
  blob: Blob
  audioUrl: string
  durationMs: number
  sampleRate?: number
  /**
   * Raw PCM samples captured via AudioWorklet (lossless).
   * When present, this should be used for transcription instead of decoding the blob.
   */
  pcmData?: Float32Array
  /**
   * Sample rate of the PCM data (typically 44100 or 48000 Hz).
   * Required when pcmData is present.
   */
  pcmSampleRate?: number
}

export type RecordingErrorStage = 'permission' | 'record' | 'decode' | 'transcribe' | 'analyze'

export interface RecordingError {
  stage: RecordingErrorStage
  message: string
}
