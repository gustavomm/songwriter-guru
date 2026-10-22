import type { FretNote } from '../../services/fretboard'
import { degreeColor, intervalNumber } from './degreeColors'

/** Interval + note pills, e.g. "1 A  b3 C  5 E", coloured like the neck */
export function FormulaChips({
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
