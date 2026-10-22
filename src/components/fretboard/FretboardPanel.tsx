import { useCallback, useMemo, useRef, useState } from 'react'
import { Note, Scale } from 'tonal'
import { useAppDispatch, useAppState } from '../../domain/state'
import type { FocusedChord } from '../../domain/types'
import { diatonicChords, mapFretboard, type FretNote } from '../../services/fretboard'
import { midiPlayer } from '../../services/midiPlayer'
import { degreeColor, intervalNumber } from './degreeColors'
import { Fretboard, type LabelMode } from './Fretboard'

const FRET_COUNT = 15

const TONICS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

const SCALES = [
  { id: 'major', label: 'Major (Ionian)' },
  { id: 'minor', label: 'Minor (Aeolian)' },
  { id: 'dorian', label: 'Dorian' },
  { id: 'phrygian', label: 'Phrygian' },
  { id: 'lydian', label: 'Lydian' },
  { id: 'mixolydian', label: 'Mixolydian' },
  { id: 'locrian', label: 'Locrian' },
  { id: 'harmonic minor', label: 'Harmonic minor' },
  { id: 'melodic minor', label: 'Melodic minor' },
  { id: 'major pentatonic', label: 'Major pentatonic' },
  { id: 'minor pentatonic', label: 'Minor pentatonic' },
  { id: 'minor blues', label: 'Blues' },
]

interface KeyChoice {
  /** Detected candidate this choice was made against; a new detection resets it */
  candidateId: string | null
  tonic: string
  scale: string
}

export function FretboardPanel() {
  const { status, harmony, features, focusedChord } = useAppState()
  const dispatch = useAppDispatch()

  const [choice, setChoice] = useState<KeyChoice | null>(null)
  const [labelMode, setLabelMode] = useState<LabelMode>('notes')
  const [showRiff, setShowRiff] = useState(true)
  const [sevenths, setSevenths] = useState(false)
  const [pulseKey, setPulseKey] = useState<string | null>(null)
  const pulseTimeoutRef = useRef<number | null>(null)

  const candidate = useMemo(
    () =>
      status === 'analyzed'
        ? harmony?.candidates.find((c) => c.id === harmony.selectedCandidateId)
        : undefined,
    [status, harmony]
  )
  const candidateId = candidate?.id ?? null
  // A manual key choice only sticks until a different key is detected or selected
  const activeChoice = choice && choice.candidateId === candidateId ? choice : null
  const followsDetection = Boolean(candidate) && !activeChoice

  const tonic = activeChoice?.tonic ?? candidate?.tonic ?? 'A'
  const scaleId = activeChoice?.scale ?? candidate?.mode.toLowerCase() ?? 'minor'
  const scaleLabel = SCALES.find((s) => s.id === scaleId)?.label ?? scaleId

  const scaleNotes = useMemo(() => {
    if (followsDetection && candidate) return candidate.scaleNotes
    return Scale.get(`${tonic} ${scaleId}`).notes
  }, [followsDetection, candidate, tonic, scaleId])

  const chordChips = useMemo(() => diatonicChords(scaleNotes, sevenths), [scaleNotes, sevenths])

  const riffWeights = features?.pcWeights ?? null
  const hasRiff = status === 'analyzed' && Boolean(riffWeights)

  const notes = useMemo(
    () =>
      mapFretboard({
        scaleNotes,
        chordTones: focusedChord?.chordTones,
        riffWeights: hasRiff ? riffWeights : null,
        fretCount: FRET_COUNT,
      }),
    [scaleNotes, focusedChord, hasRiff, riffWeights]
  )

  // One note per pitch class, in scale order, for the formula line
  const formula = useMemo(() => {
    const seen = new Map<number, FretNote>()
    notes.forEach((n) => {
      if (n.inScale && !seen.has(n.pc)) seen.set(n.pc, n)
    })
    return [...seen.values()].sort((a, b) => (a.degree ?? 0) - (b.degree ?? 0))
  }, [notes])

  const chordFormula = useMemo(() => {
    if (!focusedChord) return []
    const seen = new Map<number, FretNote>()
    notes.forEach((n) => {
      if (n.isChordTone && !seen.has(n.pc)) seen.set(n.pc, n)
    })
    return focusedChord.chordTones
      .map((tone) => seen.get(Note.chroma(tone) ?? -1))
      .filter((n): n is FretNote => Boolean(n))
  }, [focusedChord, notes])

  const outsideRiffNotes = useMemo(() => {
    if (!hasRiff) return []
    const seen = new Map<number, string>()
    notes.forEach((n) => {
      if (!n.inScale && n.riffWeight >= 0.25) seen.set(n.pc, n.name)
    })
    return [...seen.values()]
  }, [notes, hasRiff])

  const setKey = useCallback(
    (next: Partial<Pick<KeyChoice, 'tonic' | 'scale'>>) => {
      setChoice({
        candidateId,
        tonic: next.tonic ?? tonic,
        scale: next.scale ?? scaleId,
      })
      dispatch({ type: 'FOCUS_CHORD', payload: null })
    },
    [candidateId, tonic, scaleId, dispatch]
  )

  const followDetected = useCallback(() => {
    setChoice(null)
    dispatch({ type: 'FOCUS_CHORD', payload: null })
  }, [dispatch])

  const handleChordChip = useCallback(
    (chord: FocusedChord) => {
      if (focusedChord?.symbol === chord.symbol) {
        dispatch({ type: 'FOCUS_CHORD', payload: null })
        return
      }
      dispatch({ type: 'FOCUS_CHORD', payload: chord })
      midiPlayer.playChord(chord.chordTones, 3, 800, 0.4)
    },
    [focusedChord, dispatch]
  )

  const handleNoteClick = useCallback((note: FretNote) => {
    midiPlayer.playNote(note.midi, 700, 0.7)
    if (pulseTimeoutRef.current !== null) clearTimeout(pulseTimeoutRef.current)
    setPulseKey(`${note.string}-${note.fret}`)
    pulseTimeoutRef.current = window.setTimeout(() => {
      setPulseKey(null)
      pulseTimeoutRef.current = null
    }, 600)
  }, [])

  const focusedIsChip = chordChips.some((c) => c.symbol === focusedChord?.symbol)
  const tonicOptions = TONICS.includes(tonic) ? TONICS : [...TONICS, tonic]

  return (
    <div className="rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-5 shadow-xl shadow-black/20">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-rose-500" />
          <h2 className="text-sm font-semibold uppercase tracking-wider text-stone-400">
            Fretboard
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tonic}
            onChange={(e) => setKey({ tonic: e.target.value })}
            className="cursor-pointer rounded-lg border border-stone-700 bg-stone-900 px-2 py-1 text-sm font-semibold text-stone-100 hover:border-stone-600"
            aria-label="Key"
          >
            {tonicOptions.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={scaleId}
            onChange={(e) => setKey({ scale: e.target.value })}
            className="cursor-pointer rounded-lg border border-stone-700 bg-stone-900 px-2 py-1 text-sm text-stone-200 hover:border-stone-600"
            aria-label="Scale"
          >
            {(SCALES.some((s) => s.id === scaleId)
              ? SCALES
              : [...SCALES, { id: scaleId, label: scaleLabel }]
            ).map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
          {followsDetection ? (
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-xs text-violet-300">
              Detected key
            </span>
          ) : (
            candidate && (
              <button
                onClick={followDetected}
                className="cursor-pointer rounded-full border border-violet-500/30 px-2 py-0.5 text-xs text-violet-300 hover:bg-violet-500/10"
              >
                Back to {candidate.tonic} {candidate.mode}
              </button>
            )
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Segmented
            options={[
              { id: 'notes', label: 'Notes' },
              { id: 'intervals', label: 'Intervals' },
            ]}
            value={labelMode}
            onChange={(v) => setLabelMode(v as LabelMode)}
          />
          {hasRiff && (
            <button
              onClick={() => setShowRiff((v) => !v)}
              className={`cursor-pointer rounded-full border px-3 py-1 text-xs transition-colors ${
                showRiff
                  ? 'border-stone-300/50 bg-stone-100/10 text-stone-100'
                  : 'border-stone-700 text-stone-500 hover:text-stone-300'
              }`}
              aria-pressed={showRiff}
            >
              ◯ My riff
            </button>
          )}
        </div>
      </div>

      {/* Neck */}
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <Fretboard
          notes={notes}
          fretCount={FRET_COUNT}
          labelMode={labelMode}
          hasChord={Boolean(focusedChord)}
          showRiff={hasRiff && showRiff}
          pulseKey={pulseKey}
          onNoteClick={handleNoteClick}
        />
      </div>

      {/* Chord chips */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <span className="mr-1 text-xs uppercase tracking-wider text-stone-500">Chords</span>
        {chordChips.length > 0 ? (
          <>
            {chordChips.map((chord) => {
              const isActive = focusedChord?.symbol === chord.symbol
              return (
                <button
                  key={chord.symbol}
                  onClick={() =>
                    handleChordChip({
                      symbol: chord.symbol,
                      roman: chord.roman,
                      chordTones: chord.tones,
                    })
                  }
                  className={`cursor-pointer rounded-lg border px-2.5 py-1 text-left transition-all ${
                    isActive
                      ? 'border-rose-400/60 bg-rose-500/15 ring-1 ring-rose-400/30'
                      : 'border-stone-700/60 bg-stone-950/40 hover:border-stone-500'
                  }`}
                  aria-pressed={isActive}
                >
                  <span className="text-sm font-bold text-stone-100">{chord.symbol}</span>
                  <span className="ml-1.5 text-xs text-stone-500">{chord.roman}</span>
                </button>
              )
            })}
            <Segmented
              options={[
                { id: 'triads', label: 'Triads' },
                { id: 'sevenths', label: '7ths' },
              ]}
              value={sevenths ? 'sevenths' : 'triads'}
              onChange={(v) => {
                setSevenths(v === 'sevenths')
                if (focusedIsChip) dispatch({ type: 'FOCUS_CHORD', payload: null })
              }}
            />
          </>
        ) : (
          <span className="text-xs text-stone-500">
            Pick a seven-note scale to see its chords. Pentatonic and blues scales are for soloing.
          </span>
        )}
        {focusedChord && !focusedIsChip && (
          <button
            onClick={() => dispatch({ type: 'FOCUS_CHORD', payload: null })}
            className="cursor-pointer rounded-lg border border-rose-400/60 bg-rose-500/15 px-2.5 py-1 text-sm font-bold text-stone-100"
            title="Clear chord"
          >
            {focusedChord.symbol}
            {focusedChord.roman && (
              <span className="ml-1.5 text-xs font-normal text-stone-400">
                {focusedChord.roman}
              </span>
            )}
            <span className="ml-1.5 text-stone-400">×</span>
          </button>
        )}
      </div>

      {/* What you are looking at */}
      <div className="mt-4 space-y-2 rounded-xl bg-stone-950/40 px-4 py-3 text-sm">
        {focusedChord ? (
          <p className="text-stone-300">
            <span className="font-semibold text-stone-100">{focusedChord.symbol}</span> is built
            from <FormulaChips notes={chordFormula} useChordIntervals />. The dimmed dots are the
            rest of {tonic} {scaleLabel.toLowerCase()}, counted from the chord root: use them as
            passing notes, or add a 2, 4 or 6 for colour.
          </p>
        ) : (
          <p className="text-stone-300">
            <span className="font-semibold text-stone-100">
              {tonic} {scaleLabel.toLowerCase()}
            </span>{' '}
            is <FormulaChips notes={formula} />.{' '}
            <span className="text-stone-500">
              Click a chord to see its tones inside the scale, or a dot to hear it.
            </span>
          </p>
        )}
        {hasRiff && showRiff && (
          <p className="text-xs text-stone-500">
            Ringed dots are notes you played; a thicker ring means you played it more.
            {outsideRiffNotes.length > 0 &&
              ` ${outsideRiffNotes.join(', ')} ${outsideRiffNotes.length === 1 ? 'is' : 'are'} outside this scale (dashed).`}
          </p>
        )}
      </div>
    </div>
  )
}

function FormulaChips({
  notes,
  useChordIntervals = false,
}: {
  notes: FretNote[]
  useChordIntervals?: boolean
}) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {notes.map((n) => {
        const label = useChordIntervals ? n.chordInterval : n.interval
        const color = degreeColor(label)
        return (
          <span
            key={n.pc}
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold"
            style={{ backgroundColor: `${color.fill}26`, color: color.fill }}
            title={intervalNumber(label) ? color.name : undefined}
          >
            {label}
            <span className="font-normal text-stone-400">{n.name}</span>
          </span>
        )
      })}
    </span>
  )
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { id: string; label: string }[]
  value: string
  onChange: (id: string) => void
}) {
  return (
    <div className="inline-flex rounded-full border border-stone-700 bg-stone-950/50 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`cursor-pointer rounded-full px-3 py-0.5 text-xs transition-colors ${
            value === o.id ? 'bg-stone-700 text-stone-100' : 'text-stone-500 hover:text-stone-300'
          }`}
          aria-pressed={value === o.id}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
