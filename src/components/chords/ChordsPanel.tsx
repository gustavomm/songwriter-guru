import { useState, useCallback, useRef, useMemo } from 'react'
import { useAppDispatch, useAppState } from '../../domain/state'
import { findVoicings } from '../../services/chordVoicings'
import { midiPlayer } from '../../services/midiPlayer'
import { strum } from '../fretboard/strum'
import { GridIcon } from '../icons'
import { ChordCard } from './ChordCard'
import { ChordTabs, type TabId } from './ChordTabs'
import type { ChordSuggestion } from '../../domain/types'

export function ChordsPanel() {
  const { status, chords, harmony, focusedChord } = useAppState()
  const dispatch = useAppDispatch()
  const [activeTab, setActiveTab] = useState<TabId>('all')
  const [playingChordSymbol, setPlayingChordSymbol] = useState<string | null>(null)
  const playingTimeoutRef = useRef<number | null>(null)

  const isLoading = ['decoding', 'transcribing'].includes(status)
  const hasResults = status === 'analyzed' && chords
  // Analysis finished without a key (too few notes): no chords were generated
  const notEnoughNotes = status === 'analyzed' && !!harmony && harmony.candidates.length === 0

  // Memoize visible chords to avoid recalculating on every render
  const visibleChords = useMemo((): ChordSuggestion[] => {
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
  }, [chords, activeTab])

  // Handle playing a chord
  const handlePlayChord = useCallback(
    (chord: ChordSuggestion) => {
      // Clear any existing timeout to prevent it from clearing the new playing state
      if (playingTimeoutRef.current !== null) {
        clearTimeout(playingTimeoutRef.current)
      }

      setPlayingChordSymbol(chord.symbol)
      // Light the chord up on the fretboard
      dispatch({
        type: 'FOCUS_CHORD',
        payload: { symbol: chord.symbol, roman: chord.roman, chordTones: chord.chordTones },
      })
      const [shape] = findVoicings(chord.chordTones, { limit: 1 })
      if (shape) strum(shape.midi)
      else midiPlayer.playChord(chord.chordTones, 3, 800, 0.4)

      // Clear playing state after chord duration
      playingTimeoutRef.current = window.setTimeout(() => {
        setPlayingChordSymbol(null)
        playingTimeoutRef.current = null
      }, 900)
    },
    [dispatch]
  )

  return (
    <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-5 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-center gap-2">
        <div className={`h-2 w-2 rounded-full ${hasResults ? 'bg-amber-500' : 'bg-stone-600'}`} />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
          Chord Suggestions
        </h2>
        {hasResults && (
          <span className="ml-auto text-xs text-stone-500">{chords.ranked.length} chords</span>
        )}
      </div>

      {isLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-600 border-t-amber-500" />
        </div>
      ) : hasResults ? (
        <>
          <ChordTabs activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Chord Grid */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {visibleChords.map((chord) => (
              <ChordCard
                key={chord.id}
                chord={chord}
                isPlaying={playingChordSymbol === chord.symbol}
                isFocused={focusedChord?.symbol === chord.symbol}
                onPlay={() => handlePlayChord(chord)}
              />
            ))}
          </div>

          {visibleChords.length === 0 && (
            <p className="py-8 text-center text-sm text-stone-500">No chords in this category</p>
          )}
        </>
      ) : (
        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-stone-700/50 bg-stone-950/30 p-6">
          <GridIcon className="mb-2 h-8 w-8 text-stone-700" />
          <p className="text-center text-sm text-stone-600">
            {notEnoughNotes
              ? 'Not enough notes to detect a key, so no chords to suggest'
              : 'Diatonic, borrowed, and secondary dominant chords will appear here'}
          </p>
        </div>
      )}
    </div>
  )
}
