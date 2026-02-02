import { useState, useRef, useEffect, useCallback } from 'react'
import { useAppState, useAppDispatch } from '../../domain/state'
import type { HarmonicFieldCandidate } from '../../domain/types'
import { midiPlayer } from '../../services/midiPlayer'
import { generateChordSuggestions } from '../../services/chordSuggestion'
import { generateProgressions } from '../../services/progressionService'
import { MusicNoteIcon } from '../icons'
import { FieldCard } from './FieldCard'

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
        <div className={`h-2 w-2 rounded-full ${hasResults ? 'bg-violet-500' : 'bg-stone-600'}`} />
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
          <span className="text-violet-400">Tip:</span> Click "Drone" to play your recording with a
          tonic bass note underneath
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
          <MusicNoteIcon className="mb-2 h-8 w-8 text-stone-700" />
          <p className="text-center text-sm text-stone-600">
            Record a riff to detect possible keys and modes
          </p>
        </div>
      )}
    </div>
  )
}
