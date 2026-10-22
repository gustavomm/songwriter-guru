import { memo, useState } from 'react'
import { ChevronDownIcon, PlayIcon, StopIcon } from '../icons'
import type { HarmonizationResult, HarmonizedChord, RiffHarmonization } from '../../domain/types'

interface RiffHarmonySectionProps {
  result: HarmonizationResult
  /** Index of the option being played, or null */
  playingIndex: number | null
  /** Index of the sounding chord within the playing option */
  currentChordIndex: number
  /** Whether playback layers the transcribed riff over the chords */
  withRiff: boolean
  onToggleRiff: () => void
  onPlay: (index: number) => void
  onStop: () => void
}

// Static class lists so Tailwind keeps them: bars per row on phones / wider screens
const PHONE_COLS = ['grid-cols-1', 'grid-cols-2', 'grid-cols-3']
const WIDE_COLS = [
  'sm:grid-cols-1',
  'sm:grid-cols-2',
  'sm:grid-cols-3',
  'sm:grid-cols-4',
  'sm:grid-cols-5',
  'sm:grid-cols-6',
  'sm:grid-cols-7',
  'sm:grid-cols-8',
]

function gridClass(barCount: number): string {
  const phone = PHONE_COLS[Math.min(barCount, 3) - 1] ?? 'grid-cols-3'
  const wide = WIDE_COLS[Math.min(barCount, 8) - 1] ?? 'sm:grid-cols-8'
  return `${phone} ${wide}`
}

function timingLabel(result: HarmonizationResult, barCount: number): string {
  const bars = `${barCount} bar${barCount === 1 ? '' : 's'}`
  const { timing } = result
  if (timing.source === 'tempo' && timing.bpm) return `≈${Math.round(timing.bpm)} bpm · ${bars}`
  return `free time · ${bars} of ~${timing.barSec.toFixed(1)}s`
}

/**
 * "Harmonize my riff": bar-aligned chord progressions that follow the
 * recorded riff, with a short reason per chord (hover, or tap on touch).
 */
export const RiffHarmonySection = memo(function RiffHarmonySection({
  result,
  playingIndex,
  currentChordIndex,
  withRiff,
  onToggleRiff,
  onPlay,
  onStop,
}: RiffHarmonySectionProps) {
  const barCount = result.options[0] ? new Set(result.options[0].chords.map((c) => c.bar)).size : 0
  const [showMore, setShowMore] = useState(false)
  // Keep a playing alternative visible
  const visibleCount =
    showMore || (playingIndex !== null && playingIndex > 0) ? result.options.length : 1
  const moreCount = result.options.length - 1

  return (
    <section className="mb-6 rounded-xl border border-violet-500/30 bg-violet-500/5 p-3 sm:p-4">
      <div className="mb-1 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <div className="h-2 w-2 shrink-0 rounded-full bg-violet-400" />
          <h3 className="truncate text-sm font-semibold uppercase tracking-wider text-violet-300">
            Harmonize my riff
          </h3>
        </div>
        <button
          type="button"
          onClick={onToggleRiff}
          aria-pressed={withRiff}
          className={`shrink-0 cursor-pointer rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
            withRiff
              ? 'bg-violet-500/20 text-violet-300 hover:bg-violet-500/30'
              : 'bg-stone-800 text-stone-500 hover:bg-stone-700 hover:text-stone-400'
          }`}
          title="Play the recorded riff along with the chords"
        >
          {withRiff ? 'With riff' : 'Chords only'}
        </button>
      </div>
      <p className="mb-3 text-xs text-stone-500">
        <span className="text-stone-400">{timingLabel(result, barCount)}</span> · Chords that follow
        your riff bar by bar. Tap a chord to see why it fits.
      </p>

      <div className="space-y-2">
        {result.options.slice(0, visibleCount).map((option, i) => (
          <HarmonyOption
            key={option.chords.map((c) => c.chord.symbol).join('-')}
            option={option}
            label={i === 0 ? 'Best fit' : `Option ${i + 1}`}
            barCount={barCount}
            isPlaying={playingIndex === i}
            currentChordIndex={playingIndex === i ? currentChordIndex : -1}
            onPlay={() => onPlay(i)}
            onStop={onStop}
          />
        ))}
      </div>
      {moreCount > 0 && (
        <button
          type="button"
          onClick={() => setShowMore((on) => !on)}
          aria-expanded={visibleCount > 1}
          className="mt-2 flex cursor-pointer items-center gap-1 text-xs font-medium text-violet-300/80 hover:text-violet-300"
        >
          <ChevronDownIcon
            className={`h-3.5 w-3.5 transition-transform ${visibleCount > 1 ? 'rotate-180' : ''}`}
          />
          {visibleCount > 1
            ? 'Fewer options'
            : `${moreCount} more option${moreCount === 1 ? '' : 's'}`}
        </button>
      )}
    </section>
  )
})

interface HarmonyOptionProps {
  option: RiffHarmonization
  label: string
  barCount: number
  isPlaying: boolean
  currentChordIndex: number
  onPlay: () => void
  onStop: () => void
}

function HarmonyOption({
  option,
  label,
  barCount,
  isPlaying,
  currentChordIndex,
  onPlay,
  onStop,
}: HarmonyOptionProps) {
  // Tapped chord (sticky, works on touch) and hovered chord (desktop)
  const [selected, setSelected] = useState<number | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const shown = hovered ?? selected
  const shownChord = shown !== null ? option.chords[shown] : null

  // Group chord indexes by bar (a bar holds one chord, or two half-bar chords)
  const bars: { bar: number; indexes: number[] }[] = []
  option.chords.forEach((c, i) => {
    const last = bars[bars.length - 1]
    if (last && last.bar === c.bar) last.indexes.push(i)
    else bars.push({ bar: c.bar, indexes: [i] })
  })

  return (
    <div
      className={`rounded-lg border p-2.5 transition-all ${
        isPlaying
          ? 'border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/30'
          : 'border-stone-700/50 bg-stone-950/30'
      }`}
    >
      <div className="mb-2 flex items-center gap-2">
        <button
          type="button"
          onClick={isPlaying ? onStop : onPlay}
          className={`flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-full transition-all ${
            isPlaying
              ? 'bg-amber-500/30 text-amber-400'
              : 'bg-stone-800/80 text-stone-400 hover:bg-stone-700/80 hover:text-stone-300'
          }`}
          title={isPlaying ? 'Stop' : 'Play in time with the riff'}
          aria-label={isPlaying ? 'Stop' : `Play ${label}`}
        >
          {isPlaying ? <StopIcon className="h-3 w-3" /> : <PlayIcon className="h-3 w-3" />}
        </button>
        <span className="text-xs font-medium text-stone-300">{label}</span>
        {option.colorCount > 0 && (
          <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[10px] font-medium text-violet-300">
            {option.colorCount} colour
          </span>
        )}
        <span
          className="ml-auto rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-400"
          title="Share of the riff's notes that are chord tones"
        >
          {Math.round(option.fit * 100)}%
        </span>
      </div>

      <div className={`grid gap-1.5 ${gridClass(Math.max(1, barCount))}`}>
        {bars.map(({ bar, indexes }) => (
          <div
            key={bar}
            // A bar split into two chords takes two columns on phones
            className={`min-w-0 rounded-md border border-stone-800 bg-stone-900/60 px-1 pb-1 pt-0.5 ${
              indexes.length > 1 && barCount > 1 ? 'col-span-2 sm:col-span-1' : ''
            }`}
          >
            <div className="px-0.5 text-[10px] leading-4 text-stone-600">{bar}</div>
            <div className="flex gap-1">
              {indexes.map((i) => (
                <HarmonyChordButton
                  key={i}
                  harmonized={option.chords[i]}
                  compact={indexes.length > 1}
                  isActive={currentChordIndex === i}
                  isSelected={shown === i}
                  onTap={() => setSelected((s) => (s === i ? null : i))}
                  onHover={(on) => setHovered(on ? i : null)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-2 min-h-4 text-xs leading-4 text-stone-400" aria-live="polite">
        {shownChord ? (
          <>
            <span className="font-semibold text-stone-200">{shownChord.chord.symbol}</span>
            {shownChord.chord.roman && (
              <span className="text-stone-500"> ({shownChord.chord.roman})</span>
            )}
            {' · '}
            {shownChord.reason}
          </>
        ) : (
          <span className="text-stone-600">Tap a chord for the reason</span>
        )}
      </p>
    </div>
  )
}

interface HarmonyChordButtonProps {
  harmonized: HarmonizedChord
  compact: boolean
  isActive: boolean
  isSelected: boolean
  onTap: () => void
  onHover: (on: boolean) => void
}

function HarmonyChordButton({
  harmonized,
  compact,
  isActive,
  isSelected,
  onTap,
  onHover,
}: HarmonyChordButtonProps) {
  const { chord, isColor, empty } = harmonized
  return (
    <button
      type="button"
      onClick={onTap}
      // Hover only for real mouse pointers, so a tap doesn't leave a stuck hover
      onPointerEnter={(e) => e.pointerType === 'mouse' && onHover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && onHover(false)}
      aria-pressed={isSelected}
      aria-label={`${chord.symbol}${chord.roman ? `, ${chord.roman}` : ''}: ${harmonized.reason}`}
      className={`flex min-w-0 flex-1 cursor-pointer flex-col items-center rounded px-0.5 py-1 transition-all ${
        isActive
          ? 'bg-amber-500/20 ring-1 ring-amber-500/50'
          : isSelected
            ? 'bg-violet-500/15 ring-1 ring-violet-500/50'
            : 'hover:bg-stone-800'
      } ${empty ? 'opacity-60' : ''}`}
    >
      <span
        className={`max-w-full truncate font-bold ${compact ? 'text-sm' : 'text-base'} ${
          isActive ? 'text-amber-400' : isColor ? 'text-violet-300' : 'text-stone-100'
        }`}
      >
        {chord.symbol}
      </span>
      <span
        className={`max-w-full truncate text-[10px] leading-3 ${
          isActive ? 'text-amber-500/70' : 'text-stone-500'
        }`}
      >
        {chord.roman}
      </span>
    </button>
  )
}
