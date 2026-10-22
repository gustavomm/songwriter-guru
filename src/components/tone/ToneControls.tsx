import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { midiPlayer } from '../../services/midiPlayer'
import { DEFAULT_TONE, KNOB_RANGES, PICKUPS, type ToneKnob } from '../../services/guitarTone'
import { strum } from '../fretboard/strum'
import { Segmented } from '../ui/Segmented'

const AMP_KNOBS: ToneKnob[] = ['drive', 'bass', 'mid', 'treble', 'presence']
const ALL_KNOBS: ToneKnob[] = [...AMP_KNOBS, 'room']
// Open E major, low string to high
const TEST_CHORD = [40, 47, 52, 56, 59, 64]

/** Header button with a panel for the playback guitar tone: pickup and amp knobs */
export function ToneControls() {
  const tone = useSyncExternalStore(midiPlayer.subscribeTone, midiPlayer.getTone)
  const [open, setOpen] = useState(false)
  const panelId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const pickupName = PICKUPS.find((p) => p.position === tone.pickup)?.name

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => {
          midiPlayer.warmUp()
          setOpen((o) => !o)
        }}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex min-h-11 cursor-pointer items-center gap-2 rounded-full border border-stone-700 bg-stone-900/50 px-4 text-sm text-stone-300 transition-colors hover:border-amber-700/60 hover:text-amber-100"
      >
        <span
          aria-hidden
          className={`h-2 w-2 rounded-full ${tone.amp ? 'bg-red-500 shadow-[0_0_6px] shadow-red-500' : 'bg-stone-600'}`}
        />
        Tone
      </button>

      {open && (
        <div
          id={panelId}
          role="dialog"
          aria-label="Guitar tone"
          className="absolute right-0 z-30 mt-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-stone-700 bg-stone-900 p-4 shadow-2xl shadow-black/50"
        >
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-stone-100">Guitar tone</h2>
            <p className="text-xs text-stone-500">A Strat into a Silver Jubilee-style amp</p>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-stone-400">Amp</span>
              <Segmented
                label="Amp"
                options={[
                  { id: 'on', label: 'Jubilee' },
                  { id: 'off', label: 'Clean DI' },
                ]}
                value={tone.amp ? 'on' : 'off'}
                onChange={(id) => midiPlayer.setTone({ amp: id === 'on' })}
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs text-stone-400">Pickup</span>
                <span className="text-xs text-stone-500">{pickupName}</span>
              </div>
              <div
                role="radiogroup"
                aria-label="Strat pickup selector"
                className="grid grid-cols-5 rounded-full border border-stone-700 bg-stone-950/50 p-0.5"
              >
                {PICKUPS.map((p) => (
                  <button
                    key={p.position}
                    role="radio"
                    aria-checked={tone.pickup === p.position}
                    aria-label={`Position ${p.position}, ${p.name}`}
                    title={p.name}
                    onClick={() => midiPlayer.setTone({ pickup: p.position })}
                    className={`min-h-9 cursor-pointer rounded-full text-xs transition-colors ${
                      tone.pickup === p.position
                        ? 'bg-stone-700 text-stone-100'
                        : 'text-stone-400 hover:text-stone-200'
                    }`}
                  >
                    {p.position}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              {ALL_KNOBS.map((knob) => {
                const range = KNOB_RANGES[knob]
                const disabled = !tone.amp && AMP_KNOBS.includes(knob)
                const inputId = `${panelId}-${knob}`
                return (
                  <div key={knob} className={disabled ? 'opacity-40' : undefined}>
                    <label
                      htmlFor={inputId}
                      className="flex justify-between text-xs text-stone-400 tabular-nums"
                    >
                      <span>{range.label}</span>
                      <span className="text-stone-200">{tone[knob].toFixed(1)}</span>
                    </label>
                    <input
                      id={inputId}
                      type="range"
                      min={range.min}
                      max={range.max}
                      step={0.5}
                      value={tone[knob]}
                      disabled={disabled}
                      onChange={(e) => midiPlayer.setTone({ [knob]: Number(e.target.value) })}
                      className="h-8 w-full cursor-pointer accent-amber-500 disabled:cursor-not-allowed"
                    />
                  </div>
                )
              })}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => strum(TEST_CHORD)}
                className="min-h-10 flex-1 cursor-pointer rounded-full bg-amber-600 px-4 text-sm font-medium text-stone-950 transition-colors hover:bg-amber-500"
              >
                Strum E chord
              </button>
              <button
                onClick={() => midiPlayer.setTone(DEFAULT_TONE)}
                className="min-h-10 cursor-pointer rounded-full border border-stone-700 px-4 text-sm text-stone-300 transition-colors hover:border-stone-500"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
