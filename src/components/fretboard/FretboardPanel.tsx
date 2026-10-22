import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Note, Scale } from 'tonal'
import { useAppDispatch, useAppState } from '../../domain/state'
import type { FocusedChord } from '../../domain/types'
import { findVoicings } from '../../services/chordVoicings'
import { diatonicChords, mapFretboard, type FretNote } from '../../services/fretboard'
import { midiPlayer } from '../../services/midiPlayer'
import { Segmented } from '../ui/Segmented'
import { ChordInspector } from './ChordInspector'
import { FormulaChips } from './FormulaChips'
import { Fretboard, type ChordLayer, type LabelMode } from './Fretboard'
import { noteX, WIDTH } from './geometry'
import { strum } from './strum'

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
  const [chordLayer, setChordLayer] = useState<ChordLayer>('shape')
  // Picked shape, remembered per chord so switching chords starts at the best shape
  const [shapePick, setShapePick] = useState<{ symbol: string; index: number } | null>(null)
  const [pulseKey, setPulseKey] = useState<string | null>(null)
  const pulseTimeoutRef = useRef<number | null>(null)
  const neckRef = useRef<HTMLDivElement>(null)

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
  const keyName = `${tonic} ${scaleLabel.replace(/ \(.*\)/, '').toLowerCase()}`

  const scaleNotes = useMemo(() => {
    if (followsDetection && candidate) return candidate.scaleNotes
    return Scale.get(`${tonic} ${scaleId}`).notes
  }, [followsDetection, candidate, tonic, scaleId])

  const chordChips = useMemo(() => diatonicChords(scaleNotes, sevenths), [scaleNotes, sevenths])

  const voicings = useMemo(
    () => (focusedChord ? findVoicings(focusedChord.chordTones) : []),
    [focusedChord]
  )
  const shapeIndex =
    focusedChord && shapePick?.symbol === focusedChord.symbol
      ? Math.min(shapePick.index, voicings.length - 1)
      : 0
  const selectedVoicing = voicings[shapeIndex] ?? null

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

  // On narrow screens the neck scrolls: bring the chosen shape into view
  const shapeKey = selectedVoicing?.frets.join(',') ?? null
  useEffect(() => {
    const neck = neckRef.current
    if (!neck || !shapeKey || neck.scrollWidth <= neck.clientWidth) return
    const fretted = shapeKey
      .split(',')
      .map(Number)
      .filter((f) => f > 0)
    const center = fretted.length ? (Math.min(...fretted) + Math.max(...fretted)) / 2 : 0
    const x = (noteX(Math.round(center), FRET_COUNT) / WIDTH) * neck.scrollWidth
    neck.scrollTo({ left: Math.max(0, x - neck.clientWidth / 2), behavior: 'smooth' })
  }, [shapeKey])

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
      const [best] = findVoicings(chord.chordTones)
      if (best) strum(best.midi)
      else midiPlayer.playChord(chord.chordTones, 3, 1000, 0.4)
    },
    [focusedChord, dispatch]
  )

  const handleSelectShape = useCallback(
    (index: number) => {
      if (!focusedChord) return
      setShapePick({ symbol: focusedChord.symbol, index })
      const voicing = voicings[index]
      if (voicing) strum(voicing.midi)
    },
    [focusedChord, voicings]
  )

  const handleStrum = useCallback(() => {
    if (selectedVoicing) strum(selectedVoicing.midi)
    else if (focusedChord) midiPlayer.playChord(focusedChord.chordTones, 3, 1000, 0.4)
  }, [selectedVoicing, focusedChord])

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
  const scaleOptions = SCALES.some((s) => s.id === scaleId)
    ? SCALES
    : [...SCALES, { id: scaleId, label: scaleLabel }]

  return (
    <section
      id="fretboard"
      aria-label="Fretboard"
      className="scroll-mt-4 rounded-2xl border border-stone-800 bg-gradient-to-b from-stone-900 to-stone-900/50 p-4 shadow-xl shadow-black/20 sm:p-5"
    >
      {/* Header: key and display controls */}
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-3">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-rose-500" />
          <h2 className="text-sm font-semibold tracking-wider text-stone-400 uppercase">
            Fretboard
          </h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={tonic}
            onChange={(e) => setKey({ tonic: e.target.value })}
            className="min-h-9 cursor-pointer rounded-lg border border-stone-700 bg-stone-900 px-2 text-sm font-semibold text-stone-100 hover:border-stone-600"
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
            className="min-h-9 cursor-pointer rounded-lg border border-stone-700 bg-stone-900 px-2 text-sm text-stone-200 hover:border-stone-600"
            aria-label="Scale"
          >
            {scaleOptions.map((s) => (
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
                className="min-h-8 cursor-pointer rounded-full border border-violet-500/30 px-3 text-xs text-violet-300 hover:bg-violet-500/10"
              >
                Back to {candidate.tonic} {candidate.mode}
              </button>
            )
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <Segmented
            label="Dot labels"
            options={[
              { id: 'notes', label: 'Notes' },
              { id: 'intervals', label: 'Intervals' },
            ]}
            value={labelMode}
            onChange={setLabelMode}
          />
          {hasRiff && (
            <button
              onClick={() => setShowRiff((v) => !v)}
              className={`min-h-8 cursor-pointer rounded-full border px-3 text-xs transition-colors ${
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
      <div ref={neckRef} className="-mx-4 overflow-x-auto px-4 pb-1 sm:-mx-1 sm:px-1">
        <Fretboard
          notes={notes}
          fretCount={FRET_COUNT}
          labelMode={labelMode}
          hasChord={Boolean(focusedChord)}
          shape={selectedVoicing?.frets ?? null}
          barre={selectedVoicing?.barre ?? null}
          chordLayer={chordLayer}
          showRiff={hasRiff && showRiff}
          pulseKey={pulseKey}
          onNoteClick={handleNoteClick}
        />
      </div>

      {/* Chord picker */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs tracking-wider text-stone-500 uppercase">Chords in {keyName}</h3>
          {chordChips.length > 0 && (
            <Segmented
              label="Chord size"
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
          )}
        </div>
        {chordChips.length > 0 ? (
          <div className="scrollbar-hide -mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:px-0">
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
                  className={`flex min-h-11 shrink-0 cursor-pointer snap-start flex-col items-start justify-center rounded-lg border px-3 py-1 transition-all ${
                    isActive
                      ? 'border-rose-400/60 bg-rose-500/15 ring-1 ring-rose-400/30'
                      : 'border-stone-700/60 bg-stone-950/40 hover:border-stone-500'
                  }`}
                  aria-pressed={isActive}
                >
                  <span className="text-sm leading-tight font-bold text-stone-100">
                    {chord.symbol}
                  </span>
                  <span className="text-[11px] leading-tight text-stone-500">{chord.roman}</span>
                </button>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-stone-500">
            Pentatonic and blues scales are for soloing; pick a seven-note scale to see its chords.
          </p>
        )}
      </div>

      {focusedChord ? (
        <ChordInspector
          chord={focusedChord}
          formula={chordFormula}
          voicings={voicings}
          selectedIndex={shapeIndex}
          onSelect={handleSelectShape}
          labelMode={labelMode}
          chordLayer={chordLayer}
          onLayerChange={setChordLayer}
          onStrum={handleStrum}
          onClose={() => dispatch({ type: 'FOCUS_CHORD', payload: null })}
        />
      ) : (
        <div className="mt-4 space-y-2 rounded-xl bg-stone-950/40 px-4 py-3 text-sm">
          <p className="text-stone-300">
            <span className="font-semibold text-stone-100">{keyName}</span> is{' '}
            <FormulaChips notes={formula} />.{' '}
            <span className="text-stone-500">
              Pick a chord to see how to play it, or tap a dot to hear it.
            </span>
          </p>
          {hasRiff && showRiff && (
            <p className="text-xs text-stone-500">
              Ringed dots are notes you played; a thicker ring means you played it more.
              {outsideRiffNotes.length > 0 &&
                ` ${outsideRiffNotes.join(', ')} ${outsideRiffNotes.length === 1 ? 'is' : 'are'} outside this scale (dashed).`}
            </p>
          )}
        </div>
      )}
    </section>
  )
}
