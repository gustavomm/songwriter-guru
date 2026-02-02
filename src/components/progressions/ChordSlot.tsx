import { useState } from 'react'
import type { ProgressionSlot } from '../../domain/types'

interface ChordSlotProps {
  slot: ProgressionSlot
  isActive: boolean
}

/**
 * Single chord slot with optional alternatives dropdown
 */
export function ChordSlot({ slot, isActive }: ChordSlotProps) {
  const [showAlternatives, setShowAlternatives] = useState(false)
  const hasAlternatives = slot.alternatives && slot.alternatives.length > 0

  return (
    <div
      className="relative"
      onMouseEnter={() => hasAlternatives && setShowAlternatives(true)}
      onMouseLeave={() => setShowAlternatives(false)}
    >
      <div
        className={`flex flex-col items-center rounded-lg px-2 py-1 transition-all ${
          isActive
            ? 'bg-amber-500/20 ring-1 ring-amber-500/50'
            : hasAlternatives
              ? 'cursor-help'
              : ''
        }`}
      >
        <span className={`text-lg font-bold ${isActive ? 'text-amber-400' : 'text-stone-100'}`}>
          {slot.chosen.symbol}
        </span>
        <span className={`text-xs ${isActive ? 'text-amber-500/70' : 'text-stone-500'}`}>
          {slot.role}
        </span>
        {/* Indicator for alternatives */}
        {hasAlternatives && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-stone-700 text-[8px] text-stone-400">
            +{slot.alternatives.length}
          </span>
        )}
      </div>

      {/* Alternatives dropdown */}
      {showAlternatives && hasAlternatives && (
        <div className="absolute left-1/2 top-full z-10 mt-1 -translate-x-1/2 rounded-lg border border-stone-700 bg-stone-900 p-2 shadow-lg">
          <p className="mb-1 text-center text-[10px] font-medium uppercase tracking-wider text-stone-500">
            Alternatives
          </p>
          <div className="flex flex-col gap-1">
            {slot.alternatives.map((alt, j) => (
              <div
                key={j}
                className="flex items-center justify-between gap-2 rounded px-2 py-0.5 text-sm hover:bg-stone-800"
              >
                <span className="font-medium text-stone-300">{alt.symbol}</span>
                <span className="text-[10px] text-stone-500">
                  {Math.round(alt.supportScore * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
