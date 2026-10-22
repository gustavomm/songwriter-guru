import { memo, useMemo } from 'react'
import { findVoicings } from '../../services/chordVoicings'
import { ChordDiagram } from '../fretboard/ChordDiagram'
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
  /** Shown on the fretboard */
  isFocused?: boolean
  onPlay: () => void
}

export const ChordCard = memo(function ChordCard({
  chord,
  isPlaying,
  isFocused = false,
  onPlay,
}: ChordCardProps) {
  // The easiest shape to play, so the card shows a chord box rather than a list of notes
  const voicing = useMemo(() => findVoicings(chord.chordTones, { limit: 1 })[0], [chord.chordTones])
  const details = (chord.sourceDetails ?? (chord.sourceDetail ? [chord.sourceDetail] : []))
    .filter(Boolean)
    .join(' • ')

  return (
    <div
      onClick={onPlay}
      className={`group flex cursor-pointer gap-3 rounded-xl border p-3 transition-all ${
        isPlaying
          ? 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30'
          : isFocused
            ? 'border-rose-400/50 bg-rose-500/5 ring-1 ring-rose-400/30'
            : 'border-stone-700/50 bg-stone-950/30 hover:border-stone-600 hover:bg-stone-900/50'
      }`}
    >
      {/* Chord box doubles as the play button */}
      <button
        onClick={(e) => {
          e.stopPropagation()
          onPlay()
        }}
        className="relative w-[76px] shrink-0 cursor-pointer self-start rounded-lg bg-stone-950/50 p-1.5"
        aria-label={`Play ${chord.symbol} and show it on the fretboard`}
      >
        {voicing ? (
          <ChordDiagram voicing={voicing} chordTones={chord.chordTones} className="h-auto w-full" />
        ) : (
          <span className="flex aspect-square items-center justify-center text-center text-[11px] text-stone-400">
            {chord.chordTones.join(' ')}
          </span>
        )}
        <span
          className={`absolute -right-1.5 -bottom-1.5 flex h-6 w-6 items-center justify-center rounded-full shadow ${
            isPlaying
              ? 'bg-amber-500 text-stone-950'
              : 'bg-stone-700 text-stone-200 group-hover:bg-stone-600'
          }`}
        >
          <PlayIcon className="h-2.5 w-2.5" />
        </span>
      </button>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1">
          <div className="min-w-0">
            <span className="text-lg font-bold text-stone-100">{chord.symbol}</span>
            {chord.roman && <span className="ml-2 text-sm text-stone-500">{chord.roman}</span>}
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

        <p className="mt-0.5 text-xs text-stone-400">
          {chord.chordTones.join(' · ')}
          {voicing && (
            <span className="text-stone-600">
              {' '}
              — {voicing.label === 'Open' ? 'open chord' : voicing.label}
            </span>
          )}
        </p>
        {details && <p className="mt-1 text-xs text-stone-500">{details}</p>}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <ScoreBar value={chord.supportScore} label="fit" color="emerald" />
          <ScoreBar value={chord.colorScore} label="color" color="violet" />
          {isFocused && (
            <a
              href="#fretboard"
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                document.getElementById('fretboard')?.scrollIntoView({ behavior: 'smooth' })
              }}
              className="ml-auto font-medium text-rose-300 hover:text-rose-200"
            >
              More shapes on the neck ↑
            </a>
          )}
        </div>
      </div>
    </div>
  )
})

function ScoreBar({
  value,
  label,
  color,
}: {
  value: number
  label: string
  color: 'emerald' | 'violet'
}) {
  const bar = color === 'emerald' ? 'bg-emerald-500' : 'bg-violet-500'
  const text = color === 'emerald' ? 'text-emerald-400/80' : 'text-violet-400/80'
  return (
    <div className="flex items-center gap-1.5">
      <div className="h-1.5 w-10 overflow-hidden rounded-full bg-stone-700">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${value * 100}%` }} />
      </div>
      <span className={`font-medium ${text}`}>{Math.round(value * 100)}%</span>
      <span className="text-stone-500">{label}</span>
    </div>
  )
}
