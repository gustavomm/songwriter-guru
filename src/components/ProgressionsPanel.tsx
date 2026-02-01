import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppState } from '../domain/state'
import { midiPlayer } from '../services/midiPlayer'
import { generateProgressions } from '../services/progressionService'
import type { ProgressionSuggestion, ProgressionSlot } from '../domain/types'

// ─────────────────────────────────────────────────────────────────────────────
// Weirdness Knob Component - Guitar Pedal Style
// ─────────────────────────────────────────────────────────────────────────────

interface WeirdnessKnobProps {
  value: number // 0-1
  onChange: (value: number) => void
  onChangeComplete?: (value: number) => void // Called when user releases the knob
  disabled?: boolean
}

function WeirdnessKnob({ value, onChange, onChangeComplete, disabled = false }: WeirdnessKnobProps) {
  const knobRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const lastAngle = useRef<number | null>(null)
  const valueRef = useRef(value) // Track latest value for onChangeComplete

  // Keep valueRef in sync
  valueRef.current = value

  // Rotation: -135° (7 o'clock, 0%) to +135° (5 o'clock, 100%)
  const rotation = -135 + value * 270

  // Calculate angle from knob center to pointer position
  const getAngleFromCenter = useCallback((clientX: number, clientY: number): number | null => {
    if (!knobRef.current) return null
    const rect = knobRef.current.getBoundingClientRect()
    const centerX = rect.left + rect.width / 2
    const centerY = rect.top + rect.height / 2
    const deltaX = clientX - centerX
    const deltaY = clientY - centerY
    // atan2 returns angle in radians, convert to degrees
    // 0° is at 3 o'clock, we want 0° at 12 o'clock (top)
    let angle = Math.atan2(deltaY, deltaX) * (180 / Math.PI) + 90
    if (angle < -180) angle += 360
    if (angle > 180) angle -= 360
    return angle
  }, [])

  // Unified handler for both mouse and touch start
  const handlePointerDown = useCallback((clientX: number, clientY: number) => {
    if (disabled) return
    setIsDragging(true)
    lastAngle.current = getAngleFromCenter(clientX, clientY)
  }, [disabled, getAngleFromCenter])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    handlePointerDown(e.clientX, e.clientY)
  }, [handlePointerDown])

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    e.preventDefault()
    const touch = e.touches[0]
    if (touch) {
      handlePointerDown(touch.clientX, touch.clientY)
    }
  }, [handlePointerDown])

  useEffect(() => {
    if (!isDragging) return

    // Unified move handler
    const handleMove = (clientX: number, clientY: number) => {
      const currentAngle = getAngleFromCenter(clientX, clientY)
      if (currentAngle === null || lastAngle.current === null) return

      // Calculate angle delta
      let angleDelta = currentAngle - lastAngle.current

      // Handle wrap-around at ±180°
      if (angleDelta > 180) angleDelta -= 360
      if (angleDelta < -180) angleDelta += 360

      // Convert angle delta to value delta (270° total range)
      const valueDelta = angleDelta / 270
      const newValue = Math.max(0, Math.min(1, valueRef.current + valueDelta))

      onChange(newValue)
      lastAngle.current = currentAngle
    }

    const handleMouseMove = (e: MouseEvent) => {
      handleMove(e.clientX, e.clientY)
    }

    const handleTouchMove = (e: TouchEvent) => {
      e.preventDefault() // Prevent scrolling while dragging
      const touch = e.touches[0]
      if (touch) {
        handleMove(touch.clientX, touch.clientY)
      }
    }

    const handleEnd = () => {
      setIsDragging(false)
      lastAngle.current = null
      // Fire onChangeComplete when user releases
      onChangeComplete?.(valueRef.current)
    }

    // Mouse events
    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleEnd)
    // Touch events
    document.addEventListener('touchmove', handleTouchMove, { passive: false })
    document.addEventListener('touchend', handleEnd)
    document.addEventListener('touchcancel', handleEnd)

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleEnd)
      document.removeEventListener('touchmove', handleTouchMove)
      document.removeEventListener('touchend', handleEnd)
      document.removeEventListener('touchcancel', handleEnd)
    }
  }, [isDragging, onChange, onChangeComplete, getAngleFromCenter])

  // Handle scroll wheel
  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (disabled) return
    e.preventDefault()
    const delta = e.deltaY > 0 ? -0.05 : 0.05
    const newValue = Math.max(0, Math.min(1, value + delta))
    onChange(newValue)
    // Also fire onChangeComplete for wheel (immediate feedback)
    onChangeComplete?.(newValue)
  }, [disabled, value, onChange, onChangeComplete])

  // Colors: green (safe) -> purple (mild) -> orange (spicy)
  const getIndicatorColor = () => {
    if (value < 0.33) return '#22c55e' // green-500
    if (value < 0.66) return '#a855f7' // purple-500
    return '#f97316' // orange-500
  }

  const getLabelColor = () => {
    if (value < 0.33) return 'text-green-400'
    if (value < 0.66) return 'text-purple-400'
    return 'text-orange-400'
  }

  const getLabel = () => {
    if (value < 0.33) return 'Safe'
    if (value < 0.66) return 'Mild'
    return 'Spicy'
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      {/* Label */}
      <span className="text-[10px] font-semibold uppercase tracking-widest text-stone-500">
        Weirdness
      </span>

      {/* Knob container with range indicators */}
      <div className="relative">
        {/* Min/Max labels */}
        <span className="absolute -left-2 bottom-0 text-[9px] font-medium text-stone-600">0</span>
        <span className="absolute -right-3 bottom-0 text-[9px] font-medium text-stone-600">10</span>

        {/* Tick marks around knob */}
        <svg className="absolute -inset-2 h-16 w-16" viewBox="0 0 64 64">
          {/* Tick marks - 11 marks from -135° to +135° */}
          {Array.from({ length: 11 }).map((_, i) => {
            const tickAngle = -135 + (i * 27) // 270° / 10 = 27° per tick
            const radians = (tickAngle - 90) * (Math.PI / 180)
            const innerR = 26
            const outerR = 29
            const x1 = 32 + Math.cos(radians) * innerR
            const y1 = 32 + Math.sin(radians) * innerR
            const x2 = 32 + Math.cos(radians) * outerR
            const y2 = 32 + Math.sin(radians) * outerR
            const isActive = (i / 10) <= value
            return (
              <line
                key={i}
                x1={x1}
                y1={y1}
                x2={x2}
                y2={y2}
                stroke={isActive ? getIndicatorColor() : '#44403c'}
                strokeWidth={i % 5 === 0 ? 2 : 1.5}
                strokeLinecap="round"
              />
            )
          })}
        </svg>

        {/* Main knob - Guitar pedal style (skirted) */}
        <div
          ref={knobRef}
          onMouseDown={handleMouseDown}
          onTouchStart={handleTouchStart}
          onWheel={handleWheel}
          className={`
            relative h-12 w-12 select-none touch-none
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-grab'}
            ${isDragging ? 'cursor-grabbing' : ''}
          `}
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
          title={`Weirdness: ${Math.round(value * 100)}%`}
        >
          {/* Outer skirt - scalloped edges effect */}
          <div
            className="absolute inset-0 rounded-full"
            style={{
              background: `
                radial-gradient(circle at 30% 30%, #3f3f46 0%, #18181b 100%)
              `,
              boxShadow: `
                0 4px 8px rgba(0,0,0,0.4),
                0 2px 4px rgba(0,0,0,0.3),
                inset 0 1px 1px rgba(255,255,255,0.1),
                inset 0 -1px 2px rgba(0,0,0,0.3)
              `,
            }}
          />

          {/* Scalloped edge detail - 8 grooves */}
          {Array.from({ length: 8 }).map((_, i) => {
            const angle = i * 45
            return (
              <div
                key={i}
                className="absolute left-1/2 top-0 h-1/2 w-1 -translate-x-1/2 origin-bottom"
                style={{
                  transform: `translateX(-50%) rotate(${angle}deg)`,
                }}
              >
                <div
                  className="h-2 w-full rounded-full"
                  style={{
                    background: 'linear-gradient(to right, transparent, rgba(0,0,0,0.4), transparent)',
                  }}
                />
              </div>
            )
          })}

          {/* Silver/brushed metal center cap */}
          <div
            className="absolute inset-2 rounded-full"
            style={{
              background: `
                conic-gradient(
                  from 0deg,
                  #a1a1aa 0deg,
                  #e4e4e7 30deg,
                  #a1a1aa 60deg,
                  #d4d4d8 90deg,
                  #a1a1aa 120deg,
                  #e4e4e7 150deg,
                  #a1a1aa 180deg,
                  #d4d4d8 210deg,
                  #a1a1aa 240deg,
                  #e4e4e7 270deg,
                  #a1a1aa 300deg,
                  #d4d4d8 330deg,
                  #a1a1aa 360deg
                )
              `,
              boxShadow: `
                inset 0 2px 4px rgba(255,255,255,0.3),
                inset 0 -2px 4px rgba(0,0,0,0.2),
                0 1px 2px rgba(0,0,0,0.3)
              `,
            }}
          />

          {/* Center point (conical depression) */}
          <div
            className="absolute inset-4 rounded-full"
            style={{
              background: `
                radial-gradient(circle at 40% 40%, #d4d4d8 0%, #a1a1aa 50%, #71717a 100%)
              `,
            }}
          />

          {/* Indicator line - white stripe */}
          <div
            className="absolute left-1/2 top-0.5 h-2 w-1 -translate-x-1/2 rounded-sm"
            style={{
              background: '#ffffff',
              boxShadow: '0 0 2px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      </div>

      {/* Value label */}
      <span className={`text-xs font-bold ${getLabelColor()}`}>
        {getLabel()}
      </span>
    </div>
  )
}

// Icons
function PlayIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
    </svg>
  )
}

function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M5.25 3A2.25 2.25 0 003 5.25v9.5A2.25 2.25 0 005.25 17h9.5A2.25 2.25 0 0017 14.75v-9.5A2.25 2.25 0 0014.75 3h-9.5z" />
    </svg>
  )
}

/**
 * Single chord slot with optional alternatives dropdown
 */
function ChordSlot({
  slot,
  isActive,
}: {
  slot: ProgressionSlot
  isActive: boolean
}) {
  const [showAlternatives, setShowAlternatives] = useState(false)
  const hasAlternatives = slot.alternatives && slot.alternatives.length > 0

  return (
    <div
      className="relative"
      onMouseEnter={() => hasAlternatives && setShowAlternatives(true)}
      onMouseLeave={() => setShowAlternatives(false)}
    >
      <div
        className={`flex flex-col items-center rounded-lg px-2 py-1 transition-all ${isActive
          ? 'bg-amber-500/20 ring-1 ring-amber-500/50'
          : hasAlternatives ? 'cursor-help' : ''
          }`}
      >
        <span
          className={`text-lg font-bold ${isActive
            ? 'text-amber-400'
            : 'text-stone-100'
            }`}
        >
          {slot.chosen.symbol}
        </span>
        <span
          className={`text-xs ${isActive
            ? 'text-amber-500/70'
            : 'text-stone-500'
            }`}
        >
          {slot.role}
        </span>
        {/* Indicator for alternatives */}
        {hasAlternatives && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-stone-700 text-[8px] text-stone-400">
            +{slot.alternatives.length}
          </span>
        )}
      </div>

      {/* Alternatives dropdown */}
      {showAlternatives && hasAlternatives && (
        <div className="absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 rounded-lg border border-stone-700 bg-stone-900 p-2 shadow-lg">
          <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-stone-500">
            Alternatives
          </p>
          <div className="flex flex-col gap-1">
            {slot.alternatives.map((alt, j) => (
              <div
                key={j}
                className="flex items-center justify-between gap-2 rounded px-2 py-0.5 text-sm hover:bg-stone-800"
              >
                <span className="font-medium text-stone-300">{alt.symbol}</span>
                <span className="text-[10px] text-stone-500">
                  {Math.round(alt.supportScore * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProgressionCard({
  progression,
  rank,
  isPlaying,
  currentChordIndex,
  onPlay,
  onStop,
}: {
  progression: ProgressionSuggestion
  rank: number
  isPlaying: boolean
  currentChordIndex: number
  onPlay: () => void
  onStop: () => void
}) {
  // Use slots if available, otherwise fall back to chords/romans arrays
  const hasSlots = progression.slots && progression.slots.length > 0

  return (
    <div
      className={`group rounded-xl border p-4 transition-all ${isPlaying
        ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30'
        : 'border-stone-700/50 bg-stone-950/30 hover:border-stone-600 hover:bg-stone-900/50'
        }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          {/* Play button */}
          <button
            onClick={isPlaying ? onStop : onPlay}
            className={`flex h-7 w-7 cursor-pointer items-center justify-center rounded-full transition-all ${isPlaying
              ? 'bg-amber-500/30 text-amber-400'
              : 'bg-stone-800/80 text-stone-400 hover:bg-stone-700/80 hover:text-stone-300'
              }`}
            title={isPlaying ? 'Stop' : 'Play progression'}
          >
            {isPlaying ? (
              <StopIcon className="h-3 w-3" />
            ) : (
              <PlayIcon className="h-3 w-3" />
            )}
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
        </div>
        <div className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400">
          {Math.round(progression.score * 100)}%
        </div>
      </div>

      {/* Chord flow */}
      <div className="flex flex-wrap items-center gap-2">
        {hasSlots ? (
          // Use slots with alternatives
          progression.slots.map((slot, i) => (
            <div key={i} className="flex items-center gap-2">
              <ChordSlot
                slot={slot}
                isActive={isPlaying && currentChordIndex === i}
              />
              {i < progression.slots.length - 1 && (
                <svg
                  className="h-4 w-4 text-stone-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                  />
                </svg>
              )}
            </div>
          ))
        ) : (
          // Fallback to legacy chords/romans arrays
          progression.chords.map((chord, i) => (
            <div key={i} className="flex items-center gap-2">
              <div
                className={`flex flex-col items-center rounded-lg px-2 py-1 transition-all ${isPlaying && currentChordIndex === i
                  ? 'bg-amber-500/20 ring-1 ring-amber-500/50'
                  : ''
                  }`}
              >
                <span
                  className={`text-lg font-bold ${isPlaying && currentChordIndex === i
                    ? 'text-amber-400'
                    : 'text-stone-100'
                    }`}
                >
                  {chord}
                </span>
                {progression.romans[i] && (
                  <span
                    className={`text-xs ${isPlaying && currentChordIndex === i
                      ? 'text-amber-500/70'
                      : 'text-stone-500'
                      }`}
                  >
                    {progression.romans[i]}
                  </span>
                )}
              </div>
              {i < progression.chords.length - 1 && (
                <svg
                  className="h-4 w-4 text-stone-600"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                  strokeWidth={2}
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M13.5 4.5 21 12m0 0-7.5 7.5M21 12H3"
                  />
                </svg>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

export function ProgressionsPanel() {
  const { status, progressions: stateProgressions, harmony, chords, features } = useAppState()
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  const [currentChordIndex, setCurrentChordIndex] = useState(0)
  const playbackRef = useRef<{ timeoutIds: number[] }>({ timeoutIds: [] })

  // Weirdness knob state
  const [weirdness, setWeirdness] = useState(0.5)
  const [localProgressions, setLocalProgressions] = useState<ProgressionSuggestion[] | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)

  // Use local progressions if we've regenerated, otherwise use state progressions
  const progressions = localProgressions ?? stateProgressions

  const isLoading = ['decoding', 'transcribing'].includes(status)
  const hasResults = status === 'analyzed' && progressions && progressions.length > 0

  // Get selected harmonic field candidate
  const selectedCandidate = harmony?.candidates.find(c => c.id === harmony.selectedCandidateId)

  // Regenerate progressions when knob is released
  const handleWeirdnessComplete = useCallback((newWeirdness: number) => {
    if (!selectedCandidate || !chords || !features) return

    setIsRegenerating(true)
    // Use setTimeout to allow UI to update before heavy computation
    setTimeout(() => {
      const newProgressions = generateProgressions(selectedCandidate, chords, features, newWeirdness)
      setLocalProgressions(newProgressions)
      setIsRegenerating(false)
    }, 10)
  }, [selectedCandidate, chords, features])

  // Reset local progressions when state progressions change (new analysis)
  useEffect(() => {
    setLocalProgressions(null)
    setWeirdness(0.5)
  }, [stateProgressions])

  // Play a progression as a sequence of chords
  const handlePlay = useCallback((index: number) => {
    if (!progressions) return

    const progression = progressions[index]
    if (!progression) return

    // Clear any existing playback
    playbackRef.current.timeoutIds.forEach(id => clearTimeout(id))
    playbackRef.current.timeoutIds = []

    setPlayingIndex(index)
    setCurrentChordIndex(0)

    const chordDuration = 800 // ms per chord
    const gap = 100 // ms between chords

    progression.chords.forEach((chord, i) => {
      const delay = i * (chordDuration + gap)

      const timeoutId = window.setTimeout(() => {
        setCurrentChordIndex(i)
        // Parse chord and play (extract root and type)
        midiPlayer.playChord(getChordTones(chord), 3, chordDuration, 0.35)
      }, delay)

      playbackRef.current.timeoutIds.push(timeoutId)
    })

    // Stop playing state after all chords
    const totalDuration = progression.chords.length * (chordDuration + gap)
    const endTimeout = window.setTimeout(() => {
      setPlayingIndex(null)
      setCurrentChordIndex(0)
    }, totalDuration)
    playbackRef.current.timeoutIds.push(endTimeout)
  }, [progressions])

  // Stop playback
  const handleStop = useCallback(() => {
    playbackRef.current.timeoutIds.forEach(id => clearTimeout(id))
    playbackRef.current.timeoutIds = []
    setPlayingIndex(null)
    setCurrentChordIndex(0)
  }, [])

  return (
    <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-5 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div className="flex items-center gap-2">
          <div
            className={`h-2 w-2 rounded-full ${hasResults ? 'bg-emerald-500' : 'bg-stone-600'
              }`}
          />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
            Progression Ideas
          </h2>
          {hasResults && (
            <span className="text-xs text-stone-500">
              {progressions.length} suggestions
            </span>
          )}
        </div>

        {/* Weirdness Knob */}
        {hasResults && (
          <WeirdnessKnob
            value={weirdness}
            onChange={setWeirdness}
            onChangeComplete={handleWeirdnessComplete}
            disabled={isLoading || isRegenerating}
          />
        )}
      </div>

      {isLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-600 border-t-emerald-500" />
        </div>
      ) : hasResults ? (
        <div className={`space-y-3 transition-opacity duration-200 ${isRegenerating ? 'opacity-50' : ''}`}>
          {progressions.map((progression, i) => (
            <ProgressionCard
              key={i}
              progression={progression}
              rank={i + 1}
              isPlaying={playingIndex === i}
              currentChordIndex={playingIndex === i ? currentChordIndex : -1}
              onPlay={() => handlePlay(i)}
              onStop={handleStop}
            />
          ))}
        </div>
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
              d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 0 1 3 19.875v-6.75ZM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V8.625ZM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 0 1-1.125-1.125V4.125Z"
            />
          </svg>
          <p className="text-center text-sm text-stone-600">
            Suggested chord progressions will appear here
          </p>
        </div>
      )}
    </div>
  )
}

/**
 * Extract chord tones from a chord symbol for playback.
 * Simple parsing - extracts root and basic quality.
 */
function getChordTones(chordSymbol: string): string[] {
  // Parse common chord patterns
  const match = chordSymbol.match(/^([A-G][#b]?)(.*)$/)
  if (!match) return ['C', 'E', 'G'] // Fallback

  const root = match[1]
  const quality = match[2]

  // Get intervals based on quality
  const intervals = getIntervalsForQuality(quality)

  // Convert intervals to note names (simplified - just returns chord tones)
  return intervals.map(semitones => transposeNote(root, semitones))
}

/**
 * Get semitone intervals for a chord quality.
 */
function getIntervalsForQuality(quality: string): number[] {
  // Major triad
  if (!quality || quality === 'M' || quality === 'maj') {
    return [0, 4, 7]
  }
  // Minor triad
  if (quality === 'm' || quality === 'min') {
    return [0, 3, 7]
  }
  // Dominant 7
  if (quality === '7') {
    return [0, 4, 7, 10]
  }
  // Major 7
  if (quality === 'maj7' || quality === 'M7') {
    return [0, 4, 7, 11]
  }
  // Minor 7
  if (quality === 'm7' || quality === 'min7') {
    return [0, 3, 7, 10]
  }
  // Diminished
  if (quality === 'dim' || quality === '°') {
    return [0, 3, 6]
  }
  // Half-diminished
  if (quality === 'm7b5' || quality === 'ø7' || quality === 'ø') {
    return [0, 3, 6, 10]
  }
  // Augmented
  if (quality === 'aug' || quality === '+') {
    return [0, 4, 8]
  }
  // sus4
  if (quality === 'sus4') {
    return [0, 5, 7]
  }
  // sus2
  if (quality === 'sus2') {
    return [0, 2, 7]
  }

  // Default to major triad
  return [0, 4, 7]
}

/**
 * Transpose a note by semitones (simplified).
 */
function transposeNote(note: string, semitones: number): string {
  const notes = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const flatToSharp: Record<string, string> = {
    'Db': 'C#', 'Eb': 'D#', 'Fb': 'E', 'Gb': 'F#', 'Ab': 'G#', 'Bb': 'A#', 'Cb': 'B'
  }

  // Normalize flats to sharps for lookup
  const normalizedNote = flatToSharp[note] || note
  const noteIndex = notes.indexOf(normalizedNote)

  if (noteIndex === -1) return note // Fallback

  const newIndex = (noteIndex + semitones + 12) % 12
  return notes[newIndex]
}
