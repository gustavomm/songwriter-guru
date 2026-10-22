import type { FocusedChord } from '../../domain/types'
import { describeVoicing, type ChordVoicing } from '../../services/chordVoicings'
import type { FretNote } from '../../services/fretboard'
import { PlayIcon } from '../icons'
import { Segmented } from '../ui/Segmented'
import { ChordDiagram } from './ChordDiagram'
import type { ChordLayer, LabelMode } from './Fretboard'
import { FormulaChips } from './FormulaChips'

interface ChordInspectorProps {
  chord: FocusedChord
  /** One note per chord tone, for the "built from" line */
  formula: FretNote[]
  voicings: ChordVoicing[]
  selectedIndex: number
  onSelect: (index: number) => void
  labelMode: LabelMode
  chordLayer: ChordLayer
  onLayerChange: (layer: ChordLayer) => void
  onStrum: () => void
  onClose: () => void
}

/** The selected chord: what it is made of, and the shapes to play it with */
export function ChordInspector({
  chord,
  formula,
  voicings,
  selectedIndex,
  onSelect,
  labelMode,
  chordLayer,
  onLayerChange,
  onStrum,
  onClose,
}: ChordInspectorProps) {
  const selected = voicings[selectedIndex]

  return (
    <section
      aria-label={`${chord.symbol} chord`}
      className="mt-4 rounded-xl border border-stone-800 bg-stone-950/40 p-3 sm:p-4"
    >
      {/* Name, makeup and actions */}
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <h3 className="text-2xl leading-tight font-bold text-stone-50">{chord.symbol}</h3>
            {chord.roman && <span className="text-sm text-stone-500">{chord.roman}</span>}
          </div>
          <p className="mt-1 text-sm text-stone-400">
            Built from <FormulaChips notes={formula} useChordIntervals />
          </p>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            onClick={onStrum}
            className="flex min-h-10 cursor-pointer items-center gap-2 rounded-full bg-rose-500 px-4 text-sm font-semibold text-white transition-colors hover:bg-rose-400"
          >
            <PlayIcon className="h-3 w-3" />
            Strum
          </button>
          <button
            onClick={onClose}
            className="flex h-10 w-10 cursor-pointer items-center justify-center rounded-full text-lg text-stone-500 transition-colors hover:bg-stone-800 hover:text-stone-200"
            aria-label="Close chord"
          >
            ×
          </button>
        </div>
      </div>

      {voicings.length > 0 ? (
        <>
          {/* Shape picker */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs tracking-wider text-stone-500 uppercase">Ways to play it</h4>
            <Segmented
              label="Show on the neck"
              options={[
                { id: 'shape', label: 'Shape' },
                { id: 'tones', label: '+ Chord tones' },
                { id: 'scale', label: '+ Scale' },
              ]}
              value={chordLayer}
              onChange={onLayerChange}
            />
          </div>
          <div
            role="radiogroup"
            aria-label="Chord shapes"
            className="scrollbar-hide -mx-3 mt-2 flex snap-x gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
          >
            {voicings.map((v, i) => {
              const isSelected = i === selectedIndex
              return (
                <button
                  key={v.frets.join(',')}
                  role="radio"
                  aria-checked={isSelected}
                  onClick={() => onSelect(i)}
                  className={`w-32 shrink-0 sm:w-36 cursor-pointer snap-start rounded-xl border p-2 text-left transition-all ${
                    isSelected
                      ? 'border-rose-400/60 bg-rose-500/10 ring-1 ring-rose-400/30'
                      : 'border-stone-800 bg-stone-900/50 hover:border-stone-600'
                  }`}
                >
                  <span className="block text-xs font-semibold text-stone-200">{v.label}</span>
                  <span className="block text-[11px] text-stone-500">
                    {v.frets.some((f) => f === 0) && v.baseFret <= 4
                      ? 'First position'
                      : `Fret ${v.baseFret}`}
                  </span>
                  <ChordDiagram
                    voicing={v}
                    chordTones={chord.chordTones}
                    labelMode={labelMode}
                    className="mt-1 h-auto w-full"
                  />
                </button>
              )
            })}
          </div>
          {selected && <p className="mt-2 text-sm text-stone-400">{describeVoicing(selected)}</p>}
        </>
      ) : (
        <p className="mt-3 text-sm text-stone-400">
          There is no compact shape for this chord, so the neck shows every place its notes sit.
        </p>
      )}
    </section>
  )
}
