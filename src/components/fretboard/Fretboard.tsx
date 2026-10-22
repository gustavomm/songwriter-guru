import { memo, useMemo } from 'react'
import { INLAY_FRETS, STANDARD_TUNING, type FretNote } from '../../services/fretboard'
import { degreeColor } from './degreeColors'

export type LabelMode = 'notes' | 'intervals'

interface FretboardProps {
  notes: FretNote[]
  fretCount: number
  labelMode: LabelMode
  /** True when a chord is focused: chord tones stand out, other scale notes recede */
  hasChord: boolean
  showRiff: boolean
  /** Key of the position currently sounding ("string-fret"), for a pulse */
  pulseKey: string | null
  onNoteClick: (note: FretNote) => void
}

// Geometry (SVG user units)
const WIDTH = 1000
const OPEN_ZONE = 46
const NUT_X = OPEN_ZONE + 4
const END_X = WIDTH - 12
const TOP = 22
const STRING_GAP = 30
const STRING_COUNT = STANDARD_TUNING.length
const BOARD_BOTTOM = TOP + (STRING_COUNT - 1) * STRING_GAP
const HEIGHT = BOARD_BOTTOM + 48
const RIFF_THRESHOLD = 0.12

/** Fret wire x position: real guitar spacing blended with equal spacing for readability */
function fretX(fret: number, fretCount: number): number {
  const real = (1 - Math.pow(2, -fret / 12)) / (1 - Math.pow(2, -fretCount / 12))
  const equal = fret / fretCount
  return NUT_X + (END_X - NUT_X) * (0.6 * real + 0.4 * equal)
}

function noteX(fret: number, fretCount: number): number {
  if (fret === 0) return OPEN_ZONE / 2
  return (fretX(fret - 1, fretCount) + fretX(fret, fretCount)) / 2
}

/** String 0 is the low E, drawn at the bottom like a tab */
function stringY(string: number): number {
  return TOP + (STRING_COUNT - 1 - string) * STRING_GAP
}

export const Fretboard = memo(function Fretboard({
  notes,
  fretCount,
  labelMode,
  hasChord,
  showRiff,
  pulseKey,
  onNoteClick,
}: FretboardProps) {
  const frets = useMemo(() => Array.from({ length: fretCount + 1 }, (_, i) => i), [fretCount])
  const inlays: number[] = INLAY_FRETS.filter((f) => f <= fretCount)
  const midY = (TOP + BOARD_BOTTOM) / 2

  return (
    <svg
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-auto w-full min-w-[720px] select-none"
      role="img"
      aria-label="Guitar fretboard"
    >
      <defs>
        <linearGradient id="fretboard-wood" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#292524" />
          <stop offset="100%" stopColor="#1c1917" />
        </linearGradient>
      </defs>

      {/* Board */}
      <rect
        x={NUT_X}
        y={TOP - 14}
        width={END_X - NUT_X}
        height={BOARD_BOTTOM - TOP + 28}
        rx={4}
        fill="url(#fretboard-wood)"
        stroke="#44403c"
      />

      {/* Inlays */}
      {inlays.map((fret) => {
        const x = (fretX(fret - 1, fretCount) + fretX(fret, fretCount)) / 2
        return fret % 12 === 0 ? (
          <g key={fret} fill="#44403c">
            <circle cx={x} cy={TOP + STRING_GAP * 1.5} r={5} />
            <circle cx={x} cy={BOARD_BOTTOM - STRING_GAP * 1.5} r={5} />
          </g>
        ) : (
          <circle key={fret} cx={x} cy={midY} r={5} fill="#44403c" />
        )
      })}

      {/* Frets and nut */}
      {frets.slice(1).map((fret) => (
        <line
          key={fret}
          x1={fretX(fret, fretCount)}
          x2={fretX(fret, fretCount)}
          y1={TOP - 14}
          y2={BOARD_BOTTOM + 14}
          stroke="#78716c"
          strokeWidth={2}
        />
      ))}
      <rect x={NUT_X - 4} y={TOP - 14} width={6} height={BOARD_BOTTOM - TOP + 28} fill="#e7e5e4" />

      {/* Strings (thicker toward the low E) */}
      {STANDARD_TUNING.map((_, string) => (
        <line
          key={string}
          x1={NUT_X}
          x2={END_X}
          y1={stringY(string)}
          y2={stringY(string)}
          stroke="#a8a29e"
          strokeOpacity={0.75}
          strokeWidth={0.8 + (STRING_COUNT - 1 - string) * 0.35}
        />
      ))}

      {/* Fret numbers */}
      {frets.map((fret) => (
        <text
          key={fret}
          x={noteX(fret, fretCount)}
          y={BOARD_BOTTOM + 36}
          textAnchor="middle"
          fontSize={12}
          fill={inlays.includes(fret) ? '#a8a29e' : '#57534e'}
          fontWeight={inlays.includes(fret) ? 600 : 400}
        >
          {fret}
        </text>
      ))}

      {/* Notes */}
      {notes.map((note) => (
        <NoteDot
          key={`${note.string}-${note.fret}`}
          note={note}
          x={noteX(note.fret, fretCount)}
          y={stringY(note.string)}
          labelMode={labelMode}
          hasChord={hasChord}
          showRiff={showRiff}
          isPulsing={pulseKey === `${note.string}-${note.fret}`}
          onClick={onNoteClick}
        />
      ))}
    </svg>
  )
})

interface NoteDotProps {
  note: FretNote
  x: number
  y: number
  labelMode: LabelMode
  hasChord: boolean
  showRiff: boolean
  isPulsing: boolean
  onClick: (note: FretNote) => void
}

function NoteDot({ note, x, y, labelMode, hasChord, showRiff, isPulsing, onClick }: NoteDotProps) {
  const inRiff = showRiff && note.riffWeight >= RIFF_THRESHOLD
  // Hide notes that are only here because of a faint riff weight we are not showing
  if (!note.inScale && !note.isChordTone && !inRiff) return null

  // With a chord focused, chord tones are coloured by their role in the chord
  const prominent = hasChord ? note.isChordTone : note.inScale
  const colorLabel = hasChord ? note.chordInterval : note.interval
  const color = degreeColor(colorLabel)
  const label = labelMode === 'notes' ? note.name : hasChord ? note.chordInterval : note.interval

  const radius = prominent ? 11 : 8
  const fill = prominent ? color.fill : '#292524'
  const textColor = prominent ? color.text : '#a8a29e'
  const opacity = prominent ? 1 : note.inScale ? 0.85 : 0.7

  return (
    <g
      onClick={() => onClick(note)}
      className="cursor-pointer"
      opacity={opacity}
      role="button"
      aria-label={`${note.name}${note.interval ? ` (${note.interval})` : ''}, string ${6 - note.string}, fret ${note.fret}`}
    >
      <title>
        {note.name}
        {note.interval ? ` · ${note.interval} of the key` : ''}
        {note.isChordTone && note.chordInterval ? ` · ${note.chordInterval} of the chord` : ''}
        {inRiff ? ' · in your riff' : ''}
      </title>
      {isPulsing && (
        <circle
          cx={x}
          cy={y}
          r={radius}
          fill={color.fill}
          className="animate-ping"
          style={{ transformBox: 'fill-box', transformOrigin: 'center' }}
        />
      )}
      {inRiff && (
        <circle
          cx={x}
          cy={y}
          r={radius + 3.5}
          fill="none"
          stroke="#fafaf9"
          strokeWidth={1.5 + note.riffWeight * 1.5}
          strokeOpacity={0.4 + note.riffWeight * 0.6}
        />
      )}
      <circle
        cx={x}
        cy={y}
        r={radius}
        fill={fill}
        stroke={prominent ? 'none' : note.inScale ? '#57534e' : '#78716c'}
        strokeDasharray={!note.inScale && !note.isChordTone ? '2 2' : undefined}
      />
      <text
        x={x}
        y={y}
        dy="0.35em"
        textAnchor="middle"
        fontSize={prominent ? 10 : 8}
        fontWeight={700}
        fill={textColor}
        pointerEvents="none"
      >
        {label}
      </text>
    </g>
  )
}
