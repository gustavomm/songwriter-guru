import type { ReactNode } from 'react'

interface ToggleProps {
  isOn: boolean
  onToggle: () => void
  onLabel: string
  offLabel: string
  onIcon: ReactNode
  offIcon: ReactNode
  onColor: 'amber' | 'purple' | 'emerald' | 'blue' | 'teal'
  offColor: 'amber' | 'purple' | 'emerald' | 'blue' | 'teal'
  hint?: string
}

const colorClasses = {
  amber: {
    text: 'text-amber-400',
    dot: 'bg-amber-500',
  },
  purple: {
    text: 'text-purple-400',
    dot: 'bg-purple-500',
  },
  emerald: {
    text: 'text-emerald-400',
    dot: 'bg-emerald-500',
  },
  blue: {
    text: 'text-blue-400',
    dot: 'bg-blue-500',
  },
  teal: {
    text: 'text-teal-400',
    dot: 'bg-teal-500',
  },
}

export function Toggle({
  isOn,
  onToggle,
  onLabel,
  offLabel,
  onIcon,
  offIcon,
  onColor,
  offColor,
  hint,
}: ToggleProps) {
  const activeColor = isOn ? onColor : offColor
  const activeLabel = isOn ? onLabel : offLabel
  const activeIcon = isOn ? onIcon : offIcon

  return (
    <div className="flex flex-col items-center gap-1">
      <button
        onClick={onToggle}
        className="group flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-full border border-stone-700 bg-stone-900/50 px-2 py-1.5 text-[11px] transition-all hover:border-stone-600 hover:bg-stone-800/50 sm:w-auto sm:gap-2 sm:px-3 sm:text-xs"
      >
        <span className="text-sm leading-none sm:text-base">{activeIcon}</span>
        <span className={colorClasses[activeColor].text}>{activeLabel}</span>
        <div className="ml-0.5 flex h-3.5 w-6 items-center rounded-full bg-stone-700 p-0.5 transition-colors sm:ml-1 sm:h-4 sm:w-7">
          <div
            className={`h-2.5 w-2.5 rounded-full transition-all sm:h-3 sm:w-3 ${colorClasses[activeColor].dot} ${
              isOn
                ? 'translate-x-0'
                : 'translate-x-2.5 sm:translate-x-3'
            }`}
          />
        </div>
      </button>
      {hint && (
        <span className="text-[9px] text-stone-500 sm:text-[10px]">
          {hint}
        </span>
      )}
    </div>
  )
}
