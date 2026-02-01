import { useState, useCallback, useRef, useEffect } from 'react'
import { useAppState } from '../../domain/state'
import { midiPlayer } from '../../services/midiPlayer'
import { generateProgressions } from '../../services/progressionService'
import { getChordTones } from '../../services/chordUtils'
import { ChartIcon } from '../icons'
import { WeirdnessKnob } from '../ui/WeirdnessKnob'
import { ProgressionCard } from './ProgressionCard'
import type { ProgressionSuggestion } from '../../domain/types'

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
            className={`h-2 w-2 rounded-full ${hasResults ? 'bg-emerald-500' : 'bg-stone-600'}`}
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
          <ChartIcon className="mb-2 h-8 w-8 text-stone-700" />
          <p className="text-center text-sm text-stone-600">
            Suggested chord progressions will appear here
          </p>
        </div>
      )}
    </div>
  )
}
