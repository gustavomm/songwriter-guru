import { MicrophoneIcon } from '../icons'
import type { TranscriptionResult } from '../../domain/types'

interface WaveformDisplayProps {
  isRecording: boolean
  isTranscribing: boolean
  hasAnalysis: boolean
  transcription: TranscriptionResult | null
  transcriptionProgress: number
  transcriptionMessage: string | null
}

export function WaveformDisplay({
  isRecording,
  isTranscribing,
  hasAnalysis,
  transcription,
  transcriptionProgress,
  transcriptionMessage,
}: WaveformDisplayProps) {
  return (
    <div className="mb-4 flex h-24 items-center justify-center rounded-xl border border-dashed border-stone-700 bg-stone-950/50 sm:mb-6 sm:h-32">
      {isRecording ? (
        <RecordingAnimation />
      ) : isTranscribing ? (
        <TranscribingProgress
          progress={transcriptionProgress}
          message={transcriptionMessage}
        />
      ) : hasAnalysis && transcription ? (
        <AnalysisComplete />
      ) : (
        <IdleState />
      )}
    </div>
  )
}

function RecordingAnimation() {
  return (
    <div className="flex items-end gap-0.5 sm:gap-1">
      {Array.from({ length: 12 }).map((_, i) => (
        <div
          key={i}
          className="w-1.5 rounded-t bg-gradient-to-t from-red-600 to-red-400 sm:w-2"
          style={{
            height: `${20 + Math.random() * 60}%`,
            animation: `pulse 0.5s ease-in-out ${i * 0.05}s infinite alternate`,
          }}
        />
      ))}
    </div>
  )
}

function TranscribingProgress({
  progress,
  message,
}: {
  progress: number
  message: string | null
}) {
  return (
    <div className="flex w-full flex-col items-center gap-2 px-4 sm:gap-3 sm:px-8">
      <div className="h-5 w-5 animate-spin rounded-full border-2 border-stone-600 border-t-amber-500 sm:h-6 sm:w-6" />
      <div className="w-full max-w-sm">
        <div className="mb-1 flex justify-between text-[10px] text-stone-500 sm:text-xs">
          <span className="truncate pr-2">{message || 'Processing...'}</span>
          <span className="tabular-nums">{Math.round(progress)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-800 sm:h-2">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  )
}

function AnalysisComplete() {
  return (
    <div className="flex w-full items-end justify-center gap-0.5 px-3 sm:gap-1 sm:px-4">
      {Array.from({ length: 20 }).map((_, i) => {
        const height = Math.random() * 60 + 20
        return (
          <div
            key={i}
            className="w-1.5 rounded-t bg-gradient-to-t from-emerald-600 to-emerald-400 sm:w-2"
            style={{ height: `${height}%` }}
          />
        )
      })}
    </div>
  )
}

function IdleState() {
  return (
    <div className="flex flex-col items-center gap-1.5 px-4 text-center text-stone-600 sm:gap-2">
      <MicrophoneIcon className="h-6 w-6 sm:h-8 sm:w-8" />
      <span className="text-[11px] sm:text-xs">Click record to start</span>
    </div>
  )
}
