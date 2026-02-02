import { MusicNoteIcon, CancelIcon, ResetIcon } from '../icons'

interface RecorderControlsProps {
  isRecording: boolean
  isProcessing: boolean
  isTranscribing: boolean
  hasRecording: boolean
  hasAnalysis: boolean
  hasError: boolean
  onRecordClick: () => void
  onTranscribe: () => void
  onCancelTranscription: () => void
  onReset: () => void
}

export function RecorderControls({
  isRecording,
  isProcessing,
  isTranscribing,
  hasRecording,
  hasAnalysis,
  hasError,
  onRecordClick,
  onTranscribe,
  onCancelTranscription,
  onReset,
}: RecorderControlsProps) {
  return (
    <div className="flex justify-center gap-3 sm:gap-4">
      {/* Record / Stop Button */}
      <button
        onClick={onRecordClick}
        disabled={isProcessing}
        className={`group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full shadow-lg ring-4 transition-all sm:h-16 sm:w-16 ${
          isRecording
            ? 'bg-gradient-to-b from-red-600 to-red-700 ring-red-900/50 hover:ring-red-800/50'
            : 'bg-gradient-to-b from-stone-700 to-stone-800 ring-stone-800 hover:ring-amber-900/50'
        } disabled:cursor-not-allowed disabled:opacity-50`}
      >
        {isRecording ? (
          <div className="h-4 w-4 rounded bg-white sm:h-5 sm:w-5" />
        ) : (
          <div className="h-5 w-5 rounded-full bg-red-500 shadow-inner shadow-red-400/50 sm:h-6 sm:w-6" />
        )}
        <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">
          {isRecording ? 'Stop' : 'Record'}
        </span>
      </button>

      {/* Transcribe Button - shown when we have a recording but not analyzing */}
      {hasRecording && !hasAnalysis && !isRecording && !isTranscribing && (
        <button
          onClick={onTranscribe}
          className="group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-amber-600 to-amber-700 shadow-lg ring-4 ring-amber-900/50 transition-all hover:ring-amber-800/50 sm:h-16 sm:w-16"
        >
          <MusicNoteIcon className="h-5 w-5 text-white sm:h-6 sm:w-6" />
          <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">
            Analyze
          </span>
        </button>
      )}

      {/* Cancel Button - shown during transcription */}
      {isTranscribing && (
        <button
          onClick={onCancelTranscription}
          className="group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-red-600 to-red-700 shadow-lg ring-4 ring-red-900/50 transition-all hover:ring-red-800/50 sm:h-16 sm:w-16"
        >
          <CancelIcon className="h-5 w-5 text-white sm:h-6 sm:w-6" />
          <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">
            Cancel
          </span>
        </button>
      )}

      {/* Reset Button */}
      {(hasRecording || hasAnalysis || hasError) && !isRecording && !isTranscribing && (
        <button
          onClick={onReset}
          className="group relative flex h-14 w-14 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-stone-700 to-stone-800 shadow-lg ring-4 ring-stone-800 transition-all hover:ring-stone-700 sm:h-16 sm:w-16"
        >
          <ResetIcon className="h-5 w-5 text-stone-400 sm:h-6 sm:w-6" />
          <span className="absolute -bottom-6 text-[10px] text-stone-500 sm:-bottom-8 sm:text-xs">
            Reset
          </span>
        </button>
      )}
    </div>
  )
}
