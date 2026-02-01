import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppState, useAppDispatch } from '../domain/state'
import type { HarmonicFieldCandidate } from '../domain/types'
import { midiPlayer } from '../services/midiPlayer'
import { generateChordSuggestions } from '../services/chordSuggestion'
import { generateProgressions } from '../services/progressionService'

// Icons
function StopIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 20 20">
      <path d="M5.25 3A2.25 2.25 0 003 5.25v9.5A2.25 2.25 0 005.25 17h9.5A2.25 2.25 0 0017 14.75v-9.5A2.25 2.25 0 0014.75 3h-9.5z" />
    </svg>
  )
}

function ScaleIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3" />
    </svg>
  )
}

function DroneIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z" />
    </svg>
  )
}

function FieldCard({
  candidate,
  isSelected,
  onSelect,
  isPlayingScale,
  isPlayingDrone,
  onPlayScale,
  onToggleDrone,
}: {
  candidate: HarmonicFieldCandidate
  isSelected: boolean
  onSelect: () => void
  isPlayingScale: boolean
  isPlayingDrone: boolean
  onPlayScale: () => void
  onToggleDrone: () => void
}) {
  // Handle card click - select this candidate
  const handleCardClick = (e: React.MouseEvent) => {
    // Don't select if clicking on control buttons
    if ((e.target as HTMLElement).closest('[data-no-select]')) return
    onSelect()
  }

  return (
    <div
      onClick={handleCardClick}
      className={`cursor-pointer rounded-xl border p-4 transition-all ${isSelected
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
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${candidate.fitScore >= 0.9
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
            className={`rounded px-1.5 py-0.5 text-xs ${i === 0
              ? 'bg-violet-500/30 text-violet-300'
              : 'bg-stone-700/50 text-stone-400'
              }`}
          >
            {note}
          </span>
        ))}
      </div>

      {/* Out of scale notes */}
      {candidate.outOfScale.length > 0 && (
        <p className="mt-2 text-xs text-stone-500">
          Out of scale:{' '}
          {candidate.outOfScale.map((o) => o.note).join(', ')}
        </p>
      )}

      {/* Playback controls */}
      <div className="mt-3 flex gap-2" data-no-select>
        <button
          onClick={onPlayScale}
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${isPlayingScale
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
          className={`flex cursor-pointer items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-all ${isPlayingDrone
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
}

export function HarmonicFieldsPanel() {
  const { status, harmony, recording, features } = useAppState()
  const dispatch = useAppDispatch()

  // Track which scale/drone is playing
  const [playingScaleId, setPlayingScaleId] = useState<string | null>(null)
  const [activeDroneId, setActiveDroneId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const isLoading = ['decoding', 'transcribing'].includes(status)
  const hasResults = status === 'analyzed' && harmony

  // Cleanup drone when component unmounts or harmony changes
  useEffect(() => {
    return () => {
      midiPlayer.stopDrone()
      midiPlayer.stopScale()
    }
  }, [])

  // Handle selecting a harmonic field - regenerate chords
  const handleSelectCandidate = useCallback(
    (candidate: HarmonicFieldCandidate) => {
      if (!features) return

      // Generate new chords for this candidate
      const newChords = generateChordSuggestions(candidate, features)

      // Generate progressions for this candidate (pass features for on-the-fly scoring)
      const newProgressions = generateProgressions(candidate, newChords, features)

      dispatch({
        type: 'SELECT_HARMONIC_FIELD',
        payload: {
          candidateId: candidate.id,
          chords: newChords,
          progressions: newProgressions,
        },
      })
    },
    [features, dispatch]
  )

  const handlePlayScale = (candidate: HarmonicFieldCandidate) => {
    if (playingScaleId === candidate.id) {
      // Stop current scale
      midiPlayer.stopScale()
      setPlayingScaleId(null)
    } else {
      // Stop any playing scale first
      midiPlayer.stopScale()
      setPlayingScaleId(candidate.id)

      midiPlayer.playScale(candidate.scaleNotes, 4, 280, () => {
        setPlayingScaleId(null)
      })
    }
  }

  const handleToggleDrone = (candidate: HarmonicFieldCandidate) => {
    if (activeDroneId === candidate.id) {
      // Stop drone
      midiPlayer.stopDrone()
      setActiveDroneId(null)
      // Stop the audio playback if it's playing
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.currentTime = 0
      }
    } else {
      // Stop any existing drone
      midiPlayer.stopDrone()
      // Start new drone
      midiPlayer.startDrone(candidate.tonic, 2, 0.2)
      setActiveDroneId(candidate.id)

      // If we have a recording, play it alongside the drone
      if (recording?.audioUrl) {
        if (!audioRef.current) {
          audioRef.current = new Audio()
        }
        audioRef.current.src = recording.audioUrl
        audioRef.current.play()
        // When audio ends, keep the drone playing so user can replay
        audioRef.current.onended = () => {
          // Keep drone playing - user can manually stop it
        }
      }
    }
  }

  return (
    <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-5 shadow-xl shadow-black/20">
      <div className="mb-4 flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${hasResults ? 'bg-violet-500' : 'bg-stone-600'
            }`}
        />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
          Detected Keys / Modes
        </h2>
        {hasResults && (
          <span className="ml-auto text-xs text-stone-500">
            {harmony.candidates.length} candidates
          </span>
        )}
      </div>

      {/* Hint about drone feature */}
      {hasResults && recording?.audioUrl && (
        <div className="mb-3 rounded-lg bg-stone-800/30 px-3 py-2 text-xs text-stone-500">
          <span className="text-violet-400">Tip:</span> Click "Drone" to play your recording with a tonic bass note underneath
        </div>
      )}

      {isLoading ? (
        <div className="flex min-h-[120px] items-center justify-center">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-stone-600 border-t-violet-500" />
        </div>
      ) : hasResults ? (
        <div className="space-y-3">
          {harmony.candidates.map((candidate) => (
            <FieldCard
              key={candidate.id}
              candidate={candidate}
              isSelected={candidate.id === harmony.selectedCandidateId}
              isPlayingScale={playingScaleId === candidate.id}
              isPlayingDrone={activeDroneId === candidate.id}
              onSelect={() => handleSelectCandidate(candidate)}
              onPlayScale={() => handlePlayScale(candidate)}
              onToggleDrone={() => handleToggleDrone(candidate)}
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
              d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 1 1-.99-3.467l2.31-.66a2.25 2.25 0 0 0 1.632-2.163Zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 0 1-1.632 2.163l-1.32.377a1.803 1.803 0 0 1-.99-3.467l2.31-.66A2.25 2.25 0 0 0 9 15.553Z"
            />
          </svg>
          <p className="text-center text-sm text-stone-600">
            Record a riff to detect possible keys and modes
          </p>
        </div>
      )}
    </div>
  )
}
