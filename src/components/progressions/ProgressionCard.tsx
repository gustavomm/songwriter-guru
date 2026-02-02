import { PlayIcon, StopIcon, ArrowRightIcon } from '../icons'
import { ChordSlot } from './ChordSlot'
import type { ProgressionSuggestion } from '../../domain/types'

interface ProgressionCardProps {
  progression: ProgressionSuggestion
  rank: number
  isPlaying: boolean
  currentChordIndex: number
  onPlay: () => void
  onStop: () => void
}

export function ProgressionCard({
  progression,
  rank,
  isPlaying,
  currentChordIndex,
  onPlay,
  onStop,
}: ProgressionCardProps) {
  // Use slots if available, otherwise fall back to chords/romans arrays
  const hasSlots = progression.slots && progression.slots.length > 0

  return (
    <div
      className={`group rounded-xl border p-4 transition-all ${
        isPlaying
          ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30'
          : 'border-stone-700/50 bg-stone-950/30 hover:border-stone-600 hover:bg-stone-900/50'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Play button */}
          <button
            onClick={isPlaying ? onStop : onPlay}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-all ${
              isPlaying
                ? 'bg-amber-500/30 text-amber-400'
                : 'bg-stone-800/80 text-stone-400 hover:bg-stone-700/80 hover:text-stone-300'
            }`}
            title={isPlaying ? 'Stop' : 'Play progression'}
          >
            {isPlaying ? <StopIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
          </button>
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-stone-800 text-xs font-medium text-stone-400">
            {rank}
          </span>
          {/* Tags */}
          {progression.containsSecondaryDominant && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-400">
              V/x
            </span>
          )}
          {progression.containsBorrowedChord && (
            <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-xs font-medium text-violet-400">
              borrowed
            </span>
          )}
          {progression.containsColorChord &&
            !progression.containsSecondaryDominant &&
            !progression.containsBorrowedChord && (
              <span className="rounded-full bg-sky-500/20 px-2 py-0.5 text-xs font-medium text-sky-400">
                colorful
              </span>
            )}
          {!progression.containsSecondaryDominant &&
            !progression.containsBorrowedChord &&
            !progression.containsColorChord && (
              <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
                diatonic
              </span>
            )}
        </div>
        <div className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
          {Math.round(progression.score * 100)}%
        </div>
      </div>

      {/* Chord flow */}
      <div className="flex flex-wrap items-center gap-2">
        {hasSlots
          ? // Use slots with alternatives
            progression.slots.map((slot, i) => (
              <div key={i} className="flex items-center gap-2">
                <ChordSlot slot={slot} isActive={isPlaying && currentChordIndex === i} />
                {i < progression.slots.length - 1 && (
                  <ArrowRightIcon className="h-4 w-4 text-stone-600" />
                )}
              </div>
            ))
          : // Fallback to legacy chords/romans arrays
            progression.chords.map((chord, i) => (
              <div key={i} className="flex items-center gap-2">
                <div
                  className={`flex flex-col items-center rounded-lg px-2 py-1 transition-all ${
                    isPlaying && currentChordIndex === i
                      ? 'bg-amber-500/20 ring-1 ring-amber-500/50'
                      : ''
                  }`}
                >
                  <span
                    className={`text-lg font-bold ${
                      isPlaying && currentChordIndex === i ? 'text-amber-400' : 'text-stone-100'
                    }`}
                  >
                    {chord}
                  </span>
                  {progression.romans[i] && (
                    <span
                      className={`text-xs ${
                        isPlaying && currentChordIndex === i
                          ? 'text-amber-500/70'
                          : 'text-stone-500'
                      }`}
                    >
                      {progression.romans[i]}
                    </span>
                  )}
                </div>
                {i < progression.chords.length - 1 && (
                  <ArrowRightIcon className="h-4 w-4 text-stone-600" />
                )}
              </div>
            ))}
      </div>
    </div>
  )
}
