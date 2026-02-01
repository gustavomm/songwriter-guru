import type { RecordingAsset } from '../../domain/types'
import { CheckIcon } from '../icons'

interface AudioPlaybackProps {
  recordingAsset: RecordingAsset
}

export function AudioPlayback({ recordingAsset }: AudioPlaybackProps) {
  return (
    <div className="mb-4 sm:mb-6">
      {/* HQ Capture indicator */}
      {recordingAsset.pcmData && (
        <div className="mb-2 flex flex-wrap items-center justify-center gap-1.5 text-[10px] sm:text-xs">
          <span className="inline-flex h-4 items-center gap-1 rounded bg-emerald-900/40 px-1.5 text-emerald-400">
            <CheckIcon className="h-3 w-3" />
            HQ
          </span>
          <span className="text-stone-500">Better transcription accuracy</span>
        </div>
      )}
      <audio
        controls
        src={recordingAsset.audioUrl}
        className="h-10 w-full rounded-lg sm:h-12"
        style={{
          filter: 'invert(1) hue-rotate(180deg)',
          opacity: 0.7,
        }}
      />
    </div>
  )
}
