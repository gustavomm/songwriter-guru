import type { TranscriptionResult, RecordingAsset } from '../../domain/types'
import { formatTime } from '../../services/audioRecorder'

interface RecorderHeaderProps {
  isRecording: boolean
  isProcessing: boolean
  hasAnalysis: boolean
  hasRecording: boolean
  transcription: TranscriptionResult | null
  recordingAsset: RecordingAsset | null
  isTranscribing: boolean
}

export function RecorderHeader({
  isRecording,
  isProcessing,
  hasAnalysis,
  hasRecording,
  transcription,
  recordingAsset,
  isTranscribing,
}: RecorderHeaderProps) {
  return (
    <div className="mb-3 flex items-center gap-2 sm:mb-4">
      <div
        className={`h-2 w-2 shrink-0 rounded-full transition-colors ${
          isRecording
            ? 'animate-pulse bg-red-500'
            : isProcessing
              ? 'animate-pulse bg-amber-500'
              : hasAnalysis
                ? 'bg-emerald-500'
                : hasRecording
                  ? 'bg-blue-500'
                  : 'bg-stone-600'
        }`}
      />
      <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
        Recorder
      </h2>
      {hasAnalysis && transcription && (
        <span className="ml-auto text-xs text-stone-500 tabular-nums">
          {transcription.noteCount} notes detected
        </span>
      )}
      {hasRecording && !hasAnalysis && !isTranscribing && recordingAsset && (
        <span className="ml-auto text-xs text-stone-500 tabular-nums">
          {formatTime(recordingAsset.durationMs)} recorded
        </span>
      )}
    </div>
  )
}
