import { memo } from 'react'
import { StopIcon, ScaleIcon, DroneIcon } from '../icons'
import type { HarmonicFieldCandidate } from '../../domain/types'

interface FieldCardProps {
  candidate: HarmonicFieldCandidate
  isSelected: boolean
  onSelect: () => void
  isPlayingScale: boolean
  isPlayingDrone: boolean
  onPlayScale: () => void
  onToggleDrone: () => void
}

export const FieldCard = memo(function FieldCard({
  candidate,
  isSelected,
  onSelect,
  isPlayingScale,
  isPlayingDrone,
  onPlayScale,
  onToggleDrone,
}: FieldCardProps) {
  // Handle card click - select this candidate
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't select if clicking on control buttons
    if ((e.target as HTMLElement).closest('[data-no-select]')) return
    onSelect()
  }

  return (
    <div
      onClick={handleCardClick}
      className={`cursor-pointer rounded-xl border p-4 transition-all ${
        isSelected
          ? 'border-violet-500/50 bg-violet-500/10 ring-1 ring-violet-500/30'
          : 'border-stone-700/50 bg-stone-950/30 hover:border-stone-600 hover:bg-stone-900/40'
      }`}
    >
      {/* Header row */}
      <div className="mb-2 flex w-full items-center justify-between">
        <div className="flex items-baseline gap-2">
          <span className="text-lg font-bold text-stone-100">{candidate.tonic}</span>
          <span className="text-sm text-stone-400">{candidate.mode}</span>
        </div>
        <div
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            candidate.fitScore >= 0.9
              ? 'bg-emerald-500/20 text-emerald-400'
              : candidate.fitScore >= 0.8
                ? 'bg-amber-500/20 text-amber-400'
                : 'bg-stone-500/20 text-stone-400'
          }`}
        >
          {Math.round(candidate.fitScore * 100)}% fit
        </div>
      </div>

      {/* Scale notes */}
      <div className="flex flex-wrap gap-1.5">
        {candidate.scaleNotes.map((note, i) => (
          <span
            key={i}
            className={`rounded px-1.5 py-0.5 text-xs ${
              i === 0 ? 'bg-violet-500/30 text-violet-300' : 'bg-stone-700/50 text-stone-400'
            }`}
          >
            {note}
          </span>
        ))}
      </div>

      {/* Out of scale notes */}
      {candidate.outOfScale.length > 0 && (
        <p className="mt-2 text-xs text-stone-500">
          Out of scale: {candidate.outOfScale.map((o) => o.note).join(', ')}
        </p>
      )}

      {/* Playback controls */}
      <div className="mt-3 flex gap-2" data-no-select>
        <button
          onClick={onPlayScale}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            isPlayingScale
              ? 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30'
              : 'bg-stone-800/80 text-stone-400 hover:bg-stone-700/80 hover:text-stone-300'
          }`}
        >
          {isPlayingScale ? (
            <>
              <StopIcon className="h-3.5 w-3.5" />
              Stop
            </>
          ) : (
            <>
              <ScaleIcon className="h-3.5 w-3.5" />
              Play Scale
            </>
          )}
        </button>

        <button
          onClick={onToggleDrone}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${
            isPlayingDrone
              ? 'bg-violet-500/20 text-violet-400 ring-1 ring-violet-500/30'
              : 'bg-stone-800/80 text-stone-400 hover:bg-stone-700/80 hover:text-stone-300'
          }`}
        >
          {isPlayingDrone ? (
            <>
              <StopIcon className="h-3.5 w-3.5" />
              Stop Drone
            </>
          ) : (
            <>
              <DroneIcon className="h-3.5 w-3.5" />
              Drone
            </>
          )}
        </button>
      </div>
    </div>
  )
})
