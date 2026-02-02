import { useState, useMemo, useRef, useEffect } from 'react'
import { midiPlayer } from '../services/midiPlayer'
import { midiToNoteName } from '../services/transcriptionService'
import { PlayIcon, StopIcon } from './icons'
import type { TranscribedNote } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

const NOTE_HEIGHT = 24 // Height of each note bar
const ROW_GAP = 2 // Gap between rows
const MIN_NOTE_WIDTH = 24 // Minimum width for very short notes
const PIXELS_PER_SECOND = 120 // Width scale for timeline

// Note colors by octave (for visual variety)
const OCTAVE_COLORS = [
  'from-rose-500 to-rose-600',
  'from-orange-500 to-orange-600',
  'from-amber-500 to-amber-600',
  'from-yellow-500 to-yellow-600',
  'from-lime-500 to-lime-600',
  'from-emerald-500 to-emerald-600',
  'from-cyan-500 to-cyan-600',
  'from-blue-500 to-blue-600',
  'from-violet-500 to-violet-600',
  'from-purple-500 to-purple-600',
]

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface NotesTimelineProps {
  notes: TranscribedNote[]
  isPlaying?: boolean
  currentNoteIndex?: number
  onPlayAll?: () => void
  onStop?: () => void
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function NotesTimeline({
  notes,
  isPlaying = false,
  currentNoteIndex = -1,
  onPlayAll,
  onStop,
}: NotesTimelineProps) {
  const [playingNoteId, setPlayingNoteId] = useState<number | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Calculate timeline dimensions
  const { rows, totalDuration, minMidi, maxMidi, timelineWidth } = useMemo(() => {
    if (notes.length === 0) {
      return { rows: [], totalDuration: 0, minMidi: 60, maxMidi: 72, timelineWidth: 0 }
    }

    // Get time bounds
    const startTime = Math.min(...notes.map((n) => n.startSec))
    const endTime = Math.max(...notes.map((n) => n.endSec))
    const totalDuration = endTime - startTime

    // Get pitch bounds
    const midiValues = notes.map((n) => n.midi)
    const minMidi = Math.min(...midiValues)
    const maxMidi = Math.max(...midiValues)

    // Organize notes by pitch (each unique pitch gets a row)
    const uniquePitches = [...new Set(midiValues)].sort((a, b) => b - a) // High to low
    const pitchToRow = new Map(uniquePitches.map((pitch, i) => [pitch, i]))

    // Create row data with normalized positions
    const rows = notes.map((note, originalIndex) => {
      const row = pitchToRow.get(note.midi) ?? 0
      const leftPercent = ((note.startSec - startTime) / totalDuration) * 100
      const widthPercent = ((note.endSec - note.startSec) / totalDuration) * 100

      return {
        ...note,
        originalIndex,
        row,
        leftPercent,
        widthPercent,
        startTime,
      }
    })

    const timelineWidth = totalDuration * PIXELS_PER_SECOND

    return { rows, totalDuration, minMidi, maxMidi, timelineWidth }
  }, [notes])

  // Auto-scroll to current note during playback
  useEffect(() => {
    if (isPlaying && currentNoteIndex >= 0 && containerRef.current) {
      const currentNote = rows.find((r) => r.originalIndex === currentNoteIndex)
      if (currentNote) {
        const scrollX = (currentNote.leftPercent / 100) * timelineWidth - 100
        containerRef.current.scrollTo({ left: Math.max(0, scrollX), behavior: 'smooth' })
      }
    }
  }, [currentNoteIndex, isPlaying, rows, timelineWidth])

  // Play a single note
  const handlePlayNote = (note: TranscribedNote, id: number) => {
    const duration = (note.endSec - note.startSec) * 1000
    setPlayingNoteId(id)
    midiPlayer.playNote(note.midi, Math.max(duration, 200), note.velocity ?? 0.5)

    // Clear playing state after note duration
    setTimeout(
      () => {
        setPlayingNoteId((prev) => (prev === id ? null : prev))
      },
      Math.max(duration, 200) + 100
    )
  }

  // Number of unique pitches
  const rowCount = new Set(notes.map((n) => n.midi)).size
  const timelineHeight = rowCount * (NOTE_HEIGHT + ROW_GAP) + ROW_GAP

  if (notes.length === 0) {
    return null
  }

  return (
    <div className="mb-4 sm:mb-6">
      {/* Header */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 sm:mb-3 sm:gap-3">
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-[11px] font-medium text-stone-400 sm:text-xs">Detected Notes</span>
          <button
            onClick={isPlaying ? onStop : onPlayAll}
            className={`flex cursor-pointer items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium transition-all sm:gap-1.5 sm:px-3 sm:py-1 sm:text-xs ${
              isPlaying
                ? 'bg-emerald-600 text-white ring-2 ring-emerald-400/50'
                : 'bg-stone-800 text-stone-400 hover:bg-stone-700 hover:text-stone-300'
            }`}
          >
            {isPlaying ? (
              <>
                <StopIcon className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                Stop
              </>
            ) : (
              <>
                <PlayIcon className="h-2.5 w-2.5 sm:h-3 sm:w-3" />
                Play All
              </>
            )}
          </button>
        </div>
        <div className="flex items-center gap-1.5 text-[10px] tabular-nums text-stone-500 sm:gap-3 sm:text-xs">
          <span>{notes.length} notes</span>
          <span className="hidden sm:inline">•</span>
          <span className="hidden sm:inline">
            MIDI {minMidi}–{maxMidi}
          </span>
          <span>•</span>
          <span>{totalDuration.toFixed(1)}s</span>
        </div>
      </div>

      {/* Timeline Container */}
      <div className="rounded-xl border border-stone-700/50 bg-stone-950/50 p-2 sm:p-3">
        {/* Piano Roll View */}
        <div
          ref={containerRef}
          className="scrollbar-thin scrollbar-track-stone-900 scrollbar-thumb-stone-700 overflow-x-auto overflow-y-hidden"
        >
          <div
            className="relative"
            style={{
              width: Math.max(timelineWidth, 300),
              height: timelineHeight,
              minWidth: '100%',
            }}
          >
            {/* Grid lines (time markers) */}
            {Array.from({ length: Math.ceil(totalDuration) + 1 }).map((_, i) => {
              const leftPercent = (i / totalDuration) * 100
              return (
                <div
                  key={`grid-${i}`}
                  className="absolute top-0 h-full border-l border-stone-800/50"
                  style={{ left: `${leftPercent}%` }}
                >
                  <span className="absolute -bottom-4 left-0.5 text-[9px] text-stone-600 sm:-bottom-5 sm:left-1 sm:text-[10px]">
                    {i}s
                  </span>
                </div>
              )
            })}

            {/* Notes */}
            {rows.map((note, i) => {
              const octave = Math.floor(note.midi / 12) - 1
              const colorClass = OCTAVE_COLORS[octave % OCTAVE_COLORS.length]
              const noteName = midiToNoteName(note.midi)
              const isCurrentlyPlaying =
                playingNoteId === i || (isPlaying && currentNoteIndex === note.originalIndex)

              return (
                <button
                  key={i}
                  onClick={() => handlePlayNote(note, i)}
                  className={`absolute cursor-pointer rounded-md bg-gradient-to-r shadow-md transition-all ${colorClass} ${
                    isCurrentlyPlaying
                      ? 'ring-2 ring-white/60 brightness-125 scale-y-110'
                      : 'hover:brightness-110 hover:ring-1 hover:ring-white/30'
                  }`}
                  style={{
                    left: `${note.leftPercent}%`,
                    top: note.row * (NOTE_HEIGHT + ROW_GAP) + ROW_GAP,
                    width: `max(${note.widthPercent}%, ${MIN_NOTE_WIDTH}px)`,
                    height: NOTE_HEIGHT,
                  }}
                  title={`${noteName} (${note.startSec.toFixed(2)}s - ${note.endSec.toFixed(2)}s)`}
                >
                  <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-white drop-shadow-sm sm:text-xs">
                    {noteName}
                  </span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Legend / Help */}
        <div className="mt-3 flex items-center justify-between border-t border-stone-800/50 pt-2 sm:mt-4 sm:pt-3">
          <p className="text-[10px] text-stone-600 sm:text-xs">Click any note to hear it</p>
          <div className="flex items-center gap-1 text-[9px] text-stone-600 sm:text-[10px]">
            <span>← Scroll to see more →</span>
          </div>
        </div>
      </div>
    </div>
  )
}
