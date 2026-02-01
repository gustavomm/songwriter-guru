import { useState, useCallback } from 'react'
import { useAppState } from '../domain/state'
import { midiPlayer } from '../services/midiPlayer'
import type { ChordSuggestion, ChordSource } from '../domain/types'

type TabId = 'all' | 'diatonic' | 'secondary' | 'borrowed'

const tabs: { id: TabId; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'diatonic', label: 'Diatonic' },
  { id: 'secondary', label: 'Secondary' },
  { id: 'borrowed', label: 'Borrowed' },
]

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

// Play icon
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
    </svg>
  )
}

function ChordCard({
  chord,
  isPlaying,
  onPlay,
}: {
  chord: ChordSuggestion
  isPlaying: boolean
  onPlay: () => void
}) {
  return (
    <div
      className={`group rounded-xl border p-3 transition-all ${isPlaying
        ? 'border-amber-500/50 bg-amber-500/10 ring-1 ring-amber-500/30'
        : 'border-stone-700/50 bg-stone-950/30 hover:border-stone-600 hover:bg-stone-900/50'
        }`}
    >
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {/* Play button */}
          <button
            onClick={onPlay}
            className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all ${isPlaying
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

export function ChordsPanel() {
  const { status, chords } = useAppState()
  const [activeTab, setActiveTab] = useState<TabId>('all')
  const [playingChordSymbol, setPlayingChordSymbol] = useState<string | null>(null)

  const isLoading = ['decoding', 'transcribing'].includes(status)
  const hasResults = status === 'analyzed' && chords

  const getVisibleChords = (): ChordSuggestion[] => {
    if (!chords) return []
    switch (activeTab) {
      case 'diatonic':
        return chords.diatonic
      case 'secondary':
        return chords.secondary
      case 'borrowed':
        return chords.borrowed
      default:
        return chords.ranked
    }
  }

  const visibleChords = getVisibleChords()

  // Handle playing a chord
  const handlePlayChord = useCallback((chord: ChordSuggestion) => {
    setPlayingChordSymbol(chord.symbol)
    midiPlayer.playChord(chord.chordTones, 3, 800, 0.4)

    // Clear playing state after chord duration
    setTimeout(() => {
      setPlayingChordSymbol(null)
    }, 900)
  }, [])

  return (
    <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-5 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${hasResults ? 'bg-amber-500' : 'bg-stone-600'
            }`}
        />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
          Chord Suggestions
        </h2>
        {hasResults && (
          <span className="ml-auto text-xs text-stone-500">
            {chords.ranked.length} chords
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-600 border-t-amber-500" />
        </div>
      ) : hasResults ? (
        <>
          {/* Tabs */}
          <div className="mb-4 flex gap-1 overflow-x-auto rounded-lg bg-stone-950/50 p-1 scrollbar-hide">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-medium transition-all min-w-fit ${activeTab === tab.id
                  ? 'bg-stone-800 text-stone-100'
                  : 'text-stone-500 hover:text-stone-300'
                  }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Chord Grid */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {visibleChords.map((chord, i) => (
              <ChordCard
                key={`${chord.symbol}-${chord.source}-${i}`}
                chord={chord}
                isPlaying={playingChordSymbol === chord.symbol}
                onPlay={() => handlePlayChord(chord)}
              />
            ))}
          </div>

          {visibleChords.length === 0 && (
            <p className="py-8 text-center text-sm text-stone-500">
              No chords in this category
            </p>
          )}
        </>
      ) : (
        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-stone-700/50 bg-stone-950/30 p-6">
          <svg
            className="mb-2 h-8 w-8 text-stone-700"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M3.75 6A2.25 2.25 0 0 1 6 3.75h2.25A2.25 2.25 0 0 1 10.5 6v2.25a2.25 2.25 0 0 1-2.25 2.25H6a2.25 2.25 0 0 1-2.25-2.25V6ZM3.75 15.75A2.25 2.25 0 0 1 6 13.5h2.25a2.25 2.25 0 0 1 2.25 2.25V18a2.25 2.25 0 0 1-2.25 2.25H6A2.25 2.25 0 0 1 3.75 18v-2.25ZM13.5 6a2.25 2.25 0 0 1 2.25-2.25H18A2.25 2.25 0 0 1 20.25 6v2.25A2.25 2.25 0 0 1 18 10.5h-2.25a2.25 2.25 0 0 1-2.25-2.25V6ZM13.5 15.75a2.25 2.25 0 0 1 2.25-2.25H18a2.25 2.25 0 0 1 2.25 2.25V18A2.25 2.25 0 0 1 18 20.25h-2.25A2.25 2.25 0 0 1 13.5 18v-2.25Z"
            />
          </svg>
          <p className="text-center text-sm text-stone-600">
            Diatonic, borrowed, and secondary dominant chords will appear here
          </p>
        </div>
      )}
    </div>
  )
}
