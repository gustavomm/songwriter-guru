import { memo } from 'react'
import { Note } from 'tonal'
import type { ChordVoicing } from '../../services/chordVoicings'
import { chordIntervalLabel, STANDARD_TUNING } from '../../services/fretboard'
import { degreeColor } from './degreeColors'
import type { LabelMode } from './Fretboard'

interface ChordDiagramProps {
  voicing: ChordVoicing
  /** Chord tones, root first; used to spell and colour each string's note */
  chordTones: string[]
  /** What to print under each string; omit to hide the row */
  labelMode?: LabelMode
  className?: string
}

// Geometry (SVG user units): a standard vertical chord box, low E on the left
const STRING_GAP = 12
const FRET_GAP = 15
const LEFT = 16
const TOP = 16
const MIN_ROWS = 4
const DOT_R = 5.2

/** Chord box as printed in songbooks: strings vertical, finger numbers in the dots */
export const ChordDiagram = memo(function ChordDiagram({
  voicing,
  chordTones,
  labelMode,
  className,
}: ChordDiagramProps) {
  const strings = voicing.frets.length
  const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0)
  const highest = fretted.length ? Math.max(...fretted) : 0
  // Open-position shapes start at the nut; higher shapes start at their lowest fret
  const startFret = highest <= MIN_ROWS ? 1 : voicing.baseFret
  const rows = Math.max(MIN_ROWS, highest - startFret + 1)
  const width = LEFT + (strings - 1) * STRING_GAP + 10
  const boardBottom = TOP + rows * FRET_GAP
  const height = boardBottom + (labelMode ? 16 : 6)

  const root = chordTones[0]
  const nameByPc = new Map(chordTones.map((t) => [Note.chroma(t), Note.pitchClass(t)]))
  const stringInfo = voicing.frets.map((fret, s) => {
    const midi = fret === null ? null : STANDARD_TUNING[s] + fret
    const name = midi === null ? '' : (nameByPc.get(midi % 12) ?? '')
    const interval = name && root ? chordIntervalLabel(root, name) : ''
    return { fret, name, interval, color: degreeColor(interval) }
  })

  const x = (s: number) => LEFT + s * STRING_GAP
  const y = (fret: number) => TOP + (fret - startFret + 0.5) * FRET_GAP

  const description = voicing.frets.map((f) => (f === null ? 'x' : f)).join(' ')

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`${voicing.label}: ${description}`}
    >
      {/* Frets */}
      {Array.from({ length: rows + 1 }, (_, i) => (
        <line
          key={i}
          x1={x(0)}
          x2={x(strings - 1)}
          y1={TOP + i * FRET_GAP}
          y2={TOP + i * FRET_GAP}
          stroke="#57534e"
          strokeWidth={1}
        />
      ))}
      {/* Nut, or the starting fret number */}
      {startFret === 1 ? (
        <rect
          x={x(0) - 0.5}
          y={TOP - 3}
          width={x(strings - 1) - x(0) + 1}
          height={3}
          fill="#e7e5e4"
        />
      ) : (
        <text
          x={LEFT - 6}
          y={y(startFret)}
          dy="0.35em"
          textAnchor="end"
          fontSize={8}
          fill="#a8a29e"
        >
          {startFret}
        </text>
      )}
      {/* Strings */}
      {stringInfo.map((_, s) => (
        <line
          key={s}
          x1={x(s)}
          x2={x(s)}
          y1={TOP}
          y2={boardBottom}
          stroke="#a8a29e"
          strokeWidth={0.6 + (strings - 1 - s) * 0.12}
        />
      ))}

      {/* Barre */}
      {voicing.barre && (
        <rect
          x={x(voicing.barre.fromString) - DOT_R}
          y={y(voicing.barre.fret) - DOT_R + 1.5}
          width={x(voicing.barre.toString) - x(voicing.barre.fromString) + DOT_R * 2}
          height={DOT_R * 2 - 3}
          rx={DOT_R - 1.5}
          fill="#d6d3d1"
          opacity={0.35}
        />
      )}

      {stringInfo.map((info, s) => {
        if (info.fret === null) {
          return (
            <text
              key={s}
              x={x(s)}
              y={TOP - 7}
              textAnchor="middle"
              fontSize={8}
              fill="#78716c"
              aria-hidden
            >
              ×
            </text>
          )
        }
        if (info.fret === 0) {
          return (
            <circle
              key={s}
              cx={x(s)}
              cy={TOP - 9}
              r={3}
              fill="none"
              stroke={info.color.fill}
              strokeWidth={1.4}
            />
          )
        }
        const finger = voicing.fingers[s]
        return (
          <g key={s}>
            <circle cx={x(s)} cy={y(info.fret)} r={DOT_R} fill={info.color.fill} />
            {finger && (
              <text
                x={x(s)}
                y={y(info.fret)}
                dy="0.36em"
                textAnchor="middle"
                fontSize={7}
                fontWeight={700}
                fill={info.color.text}
              >
                {finger}
              </text>
            )}
          </g>
        )
      })}

      {/* Note or interval under each string */}
      {labelMode &&
        stringInfo.map((info, s) => (
          <text
            key={s}
            x={x(s)}
            y={boardBottom + 11}
            textAnchor="middle"
            fontSize={labelMode === 'notes' && info.name.length > 1 ? 6 : 7}
            fontWeight={600}
            fill={info.fret === null ? '#57534e' : info.color.fill}
          >
            {labelMode === 'notes' ? info.name : info.interval}
          </text>
        ))}
    </svg>
  )
})
