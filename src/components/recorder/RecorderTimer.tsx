import type { RecordingStatus } from '../../domain/types'
import { formatTime } from '../../services/audioRecorder'

interface RecorderTimerProps {
  isRecording: boolean
  elapsedMs: number
  isHQCapture: boolean
  error: { message: string } | null
  effectiveStatus: RecordingStatus
}

const statusMessages: Record<RecordingStatus, string> = {
  idle: 'Ready to record',
  recording: 'Recording...',
  recorded: 'Recording complete',
  decoding: 'Decoding audio...',
  transcribing: 'Transcribing notes...',
  analyzed: 'Analysis complete',
  error: 'An error occurred',
}

export function RecorderTimer({
  isRecording,
  elapsedMs,
  isHQCapture,
  error,
  effectiveStatus,
}: RecorderTimerProps) {
  return (
    <div className="mb-3 text-center sm:mb-4">
      {isRecording ? (
        <div className="flex flex-col items-center gap-0.5 sm:gap-1">
          <span className="font-mono text-xl font-bold tabular-nums text-red-400 sm:text-2xl">
            {formatTime(elapsedMs)}
          </span>
          <div className="flex items-center gap-2 text-[10px] text-stone-500 sm:text-xs">
            <span>Max 20 seconds</span>
            {isHQCapture && (
              <span className="inline-flex items-center gap-1 rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-400">
                HQ
              </span>
            )}
          </div>
        </div>
      ) : error ? (
        <p className="text-xs text-red-400 sm:text-sm">{error.message}</p>
      ) : (
        <p className="text-xs text-stone-500 sm:text-sm">{statusMessages[effectiveStatus]}</p>
      )}
    </div>
  )
}
