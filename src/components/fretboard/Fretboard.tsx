import { memo, useMemo } from 'react'
import type { Barre } from '../../services/chordVoicings'
import { INLAY_FRETS, STANDARD_TUNING, type FretNote } from '../../services/fretboard'
import { degreeColor } from './degreeColors'
import {
  BOARD_BOTTOM,
  END_X,
  fretX,
  HEIGHT,
  NUT_X,
  noteX,
  OPEN_ZONE,
  RIFF_THRESHOLD,
  STRING_COUNT,
  STRING_GAP,
  stringY,
  TOP,
  WIDTH,
} from './geometry'

export type LabelMode = 'notes' | 'intervals'

/** With a chord shape picked: the shape alone, plus the chord's other tones, or plus the scale */
export type ChordLayer = 'shape' | 'tones' | 'scale'

interface FretboardProps {
  notes: FretNote[]
  fretCount: number
  labelMode: LabelMode
  /** True when a chord is focused: chord tones stand out, other scale notes recede */
  hasChord: boolean
  /** Fret per string (low E first, null = muted) of the chord shape to highlight */
  shape: (number | null)[] | null
  /** Barre of that shape, drawn as a bar under the dots */
  barre?: Barre | null
  chordLayer: ChordLayer
  showRiff: boolean
  /** Key of the position currently sounding ("string-fret"), for a pulse */
  pulseKey: string | null
  onNoteClick: (note: FretNote) => void
}

export const Fretboard = memo(function Fretboard({
  notes,
  fretCount,
  labelMode,
  hasChord,
  shape,
  barre,
  chordLayer,
  showRiff,
  pulseKey,
  onNoteClick,
}: FretboardProps) {
  const shapeFrets = shape?.filter((f): f is number => f !== null && f > 0) ?? []
  const handFrom = shapeFrets.length ? Math.min(...shapeFrets) : null
  const handTo = shapeFrets.length ? Math.max(...shapeFrets) : null
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

      {/* Where the hand sits for the chosen shape */}
      {handFrom !== null && handTo !== null && (
        <rect
          x={fretX(handFrom - 1, fretCount)}
          y={TOP - 14}
          width={fretX(handTo, fretCount) - fretX(handFrom - 1, fretCount)}
          height={BOARD_BOTTOM - TOP + 28}
          fill="#fafaf9"
          opacity={0.06}
        />
      )}

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

      {/* Barre of the chosen shape */}
      {barre && (
        <rect
          x={noteX(barre.fret, fretCount) - 9}
          y={stringY(barre.toString) - 9}
          width={18}
          height={stringY(barre.fromString) - stringY(barre.toString) + 18}
          rx={9}
          fill="#e7e5e4"
          opacity={0.3}
        />
      )}

      {/* Muted strings of the chosen shape */}
      {shape?.map((fret, string) =>
        fret === null ? (
          <text
            key={string}
            x={OPEN_ZONE / 2}
            y={stringY(string)}
            dy="0.35em"
            textAnchor="middle"
            fontSize={16}
            fill="#78716c"
            aria-label={`string ${6 - string} not played`}
          >
            ×
          </text>
        ) : null
      )}

      {/* Notes */}
      {notes.map((note) => (
        <NoteDot
          key={`${note.string}-${note.fret}`}
          note={note}
          x={noteX(note.fret, fretCount)}
          y={stringY(note.string)}
          labelMode={labelMode}
          hasChord={hasChord}
          inShape={shape ? shape[note.string] === note.fret : false}
          hasShape={Boolean(shape)}
          chordLayer={chordLayer}
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
  inShape: boolean
  hasShape: boolean
  chordLayer: ChordLayer
  showRiff: boolean
  isPulsing: boolean
  onClick: (note: FretNote) => void
}

function NoteDot({
  note,
  x,
  y,
  labelMode,
  hasChord,
  inShape,
  hasShape,
  chordLayer,
  showRiff,
  isPulsing,
  onClick,
}: NoteDotProps) {
  // Riff rings belong to the scale view; with a chord shape they would only add noise
  const inRiff =
    showRiff && note.riffWeight >= RIFF_THRESHOLD && (!hasShape || chordLayer === 'scale')

  // How loudly to draw this note: full dot, coloured outline, faint dot, or not at all
  let emphasis: 'full' | 'outline' | 'faint' | null
  if (hasShape) {
    if (inShape) emphasis = 'full'
    else if (note.isChordTone && chordLayer !== 'shape') emphasis = 'outline'
    else if (note.inScale && chordLayer === 'scale') emphasis = 'faint'
    else emphasis = inRiff ? 'faint' : null
  } else if (hasChord) {
    emphasis = note.isChordTone ? 'full' : note.inScale || inRiff ? 'faint' : null
  } else {
    emphasis = note.inScale ? 'full' : inRiff ? 'faint' : null
  }
  if (!emphasis) return null

  // With a chord focused, notes are coloured and labelled by their role in the chord
  const colorLabel = hasChord ? note.chordInterval : note.interval
  const color = degreeColor(colorLabel)
  const label = labelMode === 'notes' ? note.name : colorLabel

  const radius = emphasis === 'full' ? 11 : emphasis === 'outline' ? 9 : 8
  const fill = emphasis === 'full' ? color.fill : '#292524'
  const textColor =
    emphasis === 'full' ? color.text : emphasis === 'outline' ? color.fill : '#a8a29e'
  const stroke =
    emphasis === 'full'
      ? 'none'
      : emphasis === 'outline'
        ? color.fill
        : note.inScale
          ? '#57534e'
          : '#78716c'
  const opacity = emphasis === 'faint' ? (note.inScale ? 0.8 : 0.7) : 1

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
        stroke={stroke}
        strokeWidth={emphasis === 'outline' ? 1.5 : 1}
        strokeDasharray={!note.inScale && !note.isChordTone ? '2 2' : undefined}
      />
      <text
        x={x}
        y={y}
        dy="0.35em"
        textAnchor="middle"
        fontSize={emphasis === 'full' ? 10 : 8}
        fontWeight={700}
        fill={textColor}
        pointerEvents="none"
      >
        {label}
      </text>
    </g>
  )
}
