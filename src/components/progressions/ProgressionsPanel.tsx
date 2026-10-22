import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { useAppState } from '../../domain/state'
import { midiPlayer } from '../../services/midiPlayer'
import { generateProgressions } from '../../services/progressionService'
import { canHarmonize, harmonizeRiff } from '../../services/riffHarmonizer'
import { getChordTones } from '../../services/chordUtils'
import { ChartIcon } from '../icons'
import { WeirdnessKnob } from '../ui/WeirdnessKnob'
import { ProgressionCard } from './ProgressionCard'
import { RiffHarmonySection } from './RiffHarmonySection'
import type { ProgressionSuggestion } from '../../domain/types'

const DEFAULT_WEIRDNESS = 0.5

export function ProgressionsPanel() {
  const {
    status,
    progressions: stateProgressions,
    harmony,
    chords,
    features,
    transcription,
  } = useAppState()
  const [playingIndex, setPlayingIndex] = useState<number | null>(null)
  // Riff harmonization option being played (separate from template playback)
  const [harmonyPlayingIndex, setHarmonyPlayingIndex] = useState<number | null>(null)
  const [currentChordIndex, setCurrentChordIndex] = useState(0)
  const [playWithRiff, setPlayWithRiff] = useState(true)
  const playbackRef = useRef<{ timeoutIds: number[] }>({ timeoutIds: [] })

  // Weirdness knob state (committed = value at the last knob release)
  const [weirdness, setWeirdness] = useState(DEFAULT_WEIRDNESS)
  const [committedWeirdness, setCommittedWeirdness] = useState(DEFAULT_WEIRDNESS)
  const [localProgressions, setLocalProgressions] = useState<ProgressionSuggestion[] | null>(null)
  const [isRegenerating, setIsRegenerating] = useState(false)

  // Use local progressions if we've regenerated, otherwise use state progressions
  const progressions = localProgressions ?? stateProgressions

  const isLoading = ['decoding', 'transcribing'].includes(status)
  const hasResults = status === 'analyzed' && progressions && progressions.length > 0
  // Analysis finished without a key (too few notes): no progressions were generated
  const notEnoughNotes = status === 'analyzed' && !!harmony && harmony.candidates.length === 0

  // Memoize selected harmonic field candidate to avoid recalculating on every render
  const selectedCandidate = useMemo(
    () => harmony?.candidates.find((c) => c.id === harmony.selectedCandidateId),
    [harmony]
  )

  // Regenerate progressions when knob is released
  const handleWeirdnessComplete = useCallback(
    (newWeirdness: number) => {
      if (!selectedCandidate || !chords || !features) return

      setCommittedWeirdness(newWeirdness)
      setIsRegenerating(true)
      // Use setTimeout to allow UI to update before heavy computation
      setTimeout(() => {
        const newProgressions = generateProgressions(
          selectedCandidate,
          chords,
          features,
          newWeirdness
        )
        setLocalProgressions(newProgressions)
        setIsRegenerating(false)
      }, 10)
    },
    [selectedCandidate, chords, features]
  )

  // Keep the latest weirdness available to the effect below without re-running it
  const weirdnessRef = useRef(weirdness)
  weirdnessRef.current = weirdness

  // When state progressions change (new analysis or key change), keep the user's
  // weirdness setting and regenerate with it instead of resetting the knob
  useEffect(() => {
    const currentWeirdness = weirdnessRef.current
    if (currentWeirdness === DEFAULT_WEIRDNESS || !selectedCandidate || !chords || !features) {
      setLocalProgressions(null)
      return
    }
    setLocalProgressions(
      generateProgressions(selectedCandidate, chords, features, currentWeirdness)
    )
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only react to new state progressions
  }, [stateProgressions])

  // Bar-by-bar harmonization of the riff itself (cheap: recomputed per key/knob release)
  const harmonization = useMemo(
    () =>
      selectedCandidate && chords && features && canHarmonize(features)
        ? harmonizeRiff(selectedCandidate, chords, features, committedWeirdness)
        : null,
    [selectedCandidate, chords, features, committedWeirdness]
  )

  const clearPlayback = useCallback(() => {
    playbackRef.current.timeoutIds.forEach((id) => clearTimeout(id))
    playbackRef.current.timeoutIds = []
  }, [])

  // Play a progression as a sequence of chords
  const handlePlay = useCallback(
    (index: number) => {
      if (!progressions) return

      const progression = progressions[index]
      if (!progression) return

      // Clear any existing playback
      clearPlayback()
      setHarmonyPlayingIndex(null)

      setPlayingIndex(index)
      setCurrentChordIndex(0)

      const chordDuration = 800 // ms per chord
      const gap = 100 // ms between chords

      progression.chords.forEach((chord, i) => {
        const delay = i * (chordDuration + gap)
        // Prefer the chord tones computed at generation time; only re-parse as a fallback
        const tones = progression.slots[i]?.chosen.chordTones ?? getChordTones(chord)

        const timeoutId = window.setTimeout(() => {
          setCurrentChordIndex(i)
          midiPlayer.playChord(tones, 3, chordDuration, 0.35)
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
    },
    [progressions, clearPlayback]
  )

  // Play a riff harmonization in time: each chord at its bar's start for the
  // bar's length, optionally with the transcribed riff on top
  const handlePlayHarmony = useCallback(
    (index: number) => {
      const option = harmonization?.options[index]
      if (!option || option.chords.length === 0) return

      clearPlayback()
      setPlayingIndex(null)
      setHarmonyPlayingIndex(index)
      setCurrentChordIndex(0)

      const riffNotes = playWithRiff ? (transcription?.notes ?? []) : []
      const origin = Math.min(option.chords[0].startSec, ...riffNotes.map((n) => n.startSec))
      const schedule = (atSec: number, fn: () => void) => {
        const delay = Math.max(0, (atSec - origin) * 1000)
        playbackRef.current.timeoutIds.push(window.setTimeout(fn, delay))
      }

      option.chords.forEach((harmonized, i) => {
        const durationMs = Math.max(200, (harmonized.endSec - harmonized.startSec) * 1000 * 0.95)
        schedule(harmonized.startSec, () => {
          setCurrentChordIndex(i)
          midiPlayer.playChord(
            harmonized.chord.chordTones,
            3,
            durationMs,
            playWithRiff ? 0.28 : 0.35
          )
        })
      })
      for (const note of riffNotes) {
        const durationMs = Math.max(120, (note.endSec - note.startSec) * 1000)
        schedule(note.startSec, () =>
          midiPlayer.playNote(note.midi, durationMs, (note.velocity ?? 0.6) * 0.8)
        )
      }

      const end = Math.max(
        option.chords[option.chords.length - 1].endSec,
        ...riffNotes.map((n) => n.endSec)
      )
      schedule(end, () => {
        setHarmonyPlayingIndex(null)
        setCurrentChordIndex(0)
      })
    },
    [harmonization, playWithRiff, transcription, clearPlayback]
  )

  // Stop playback
  const handleStop = useCallback(() => {
    clearPlayback()
    setPlayingIndex(null)
    setHarmonyPlayingIndex(null)
    setCurrentChordIndex(0)
  }, [clearPlayback])

  // Stop playing when the harmonization changes or the panel unmounts
  useEffect(() => {
    handleStop()
  }, [harmonization, handleStop])
  useEffect(() => clearPlayback, [clearPlayback])

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
            <span className="text-xs text-stone-500">{progressions.length} suggestions</span>
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
        <div className={`transition-opacity duration-200 ${isRegenerating ? 'opacity-50' : ''}`}>
          {harmonization && harmonization.options.length > 0 && (
            <>
              <RiffHarmonySection
                result={harmonization}
                playingIndex={harmonyPlayingIndex}
                currentChordIndex={currentChordIndex}
                withRiff={playWithRiff}
                onToggleRiff={() => setPlayWithRiff((on) => !on)}
                onPlay={handlePlayHarmony}
                onStop={handleStop}
              />
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-stone-500">
                Progression ideas from templates
              </h3>
            </>
          )}
          <div className="space-y-3">
            {progressions.map((progression, i) => (
              <ProgressionCard
                key={`${progression.chords.join('-')}-${i}`}
                progression={progression}
                rank={i + 1}
                isPlaying={playingIndex === i}
                currentChordIndex={playingIndex === i ? currentChordIndex : -1}
                onPlay={() => handlePlay(i)}
                onStop={handleStop}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="flex min-h-[120px] flex-col items-center justify-center rounded-xl border border-dashed border-stone-700/50 bg-stone-950/30 p-6">
          <ChartIcon className="mb-2 h-8 w-8 text-stone-700" />
          <p className="text-center text-sm text-stone-600">
            {notEnoughNotes
              ? 'Not enough notes to detect a key, so no progressions to suggest'
              : 'Suggested chord progressions will appear here'}
          </p>
        </div>
      )}
    </div>
  )
}
