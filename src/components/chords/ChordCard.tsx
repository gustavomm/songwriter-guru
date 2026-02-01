import { PlayIcon } from '../icons'
import type { ChordSuggestion, ChordSource } from '../../domain/types'

const sourceColors: Record<ChordSource, string> = {
  diatonic: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
  secondary_dominant: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
  secondary_leading_tone: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  borrowed: 'bg-violet-500/20 text-violet-400 border-violet-500/30',
  substitute_dominant: 'bg-pink-500/20 text-pink-400 border-pink-500/30',
  secondary_supertonic: 'bg-cyan-500/20 text-cyan-400 border-cyan-500/30',
  substitute_supertonic: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
}

const sourceLabels: Record<ChordSource, string> = {
  diatonic: 'Diatonic',
  secondary_dominant: 'V/',
  secondary_leading_tone: 'vii°/',
  borrowed: 'Borrowed',
  substitute_dominant: 'subV/',
  secondary_supertonic: 'ii/',
  substitute_supertonic: 'subii/',
}

interface ChordCardProps {
  chord: ChordSuggestion
  isPlaying: boolean
  onPlay: () => void
}

export function ChordCard({ chord, isPlaying, onPlay }: ChordCardProps) {
  return (
    <div
      className={`group rounded-xl border p-3 transition-all ${
        isPlaying
          ? 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30'
          : 'border-stone-700/50 bg-stone-950/30 hover:border-stone-600 hover:bg-stone-900/50'
      }`}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Play button */}
          <button
            onClick={onPlay}
            className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all ${
              isPlaying
                ? 'bg-amber-500/30 text-amber-400'
                : 'bg-stone-800/80 text-stone-400 hover:bg-stone-700/80 hover:text-stone-300'
            }`}
            title="Play chord"
          >
            <PlayIcon className="h-3 w-3" />
          </button>
          <div className="min-w-0">
            <span className="text-lg font-bold text-stone-100">{chord.symbol}</span>
            {chord.roman && (
              <span className="ml-2 text-sm text-stone-500">{chord.roman}</span>
            )}
          </div>
        </div>
        {/* Source labels - show all if chord has multiple sources */}
        <div className="flex flex-wrap gap-1">
          {(chord.sources || [chord.source]).map((src, i) => (
            <span
              key={i}
              className={`rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${sourceColors[src]}`}
            >
              {sourceLabels[src]}
            </span>
          ))}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        {chord.chordTones.map((tone, i) => (
          <span
            key={i}
            className="rounded bg-stone-700/50 px-1.5 py-0.5 text-xs text-stone-400"
          >
            {tone}
          </span>
        ))}
      </div>

      {(chord.sourceDetails || (chord.sourceDetail ? [chord.sourceDetail] : [])).length > 0 && (
        <p className="mb-2 text-xs text-stone-500">
          {(chord.sourceDetails || [chord.sourceDetail]).filter(Boolean).join(' • ')}
        </p>
      )}

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-10 overflow-hidden rounded-full bg-stone-700">
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${chord.supportScore * 100}%` }}
            />
          </div>
          <span className="text-emerald-400/80 font-medium">{Math.round(chord.supportScore * 100)}%</span>
          <span className="text-stone-500">fit</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="h-1.5 w-10 overflow-hidden rounded-full bg-stone-700">
            <div
              className="h-full rounded-full bg-violet-500"
              style={{ width: `${chord.colorScore * 100}%` }}
            />
          </div>
          <span className="text-violet-400/80 font-medium">{Math.round(chord.colorScore * 100)}%</span>
          <span className="text-stone-500">color</span>
        </div>
      </div>
    </div>
  )
}
