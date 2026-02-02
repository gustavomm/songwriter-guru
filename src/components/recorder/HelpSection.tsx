import { useState } from 'react'
import { HelpIcon, ChevronDownIcon, LightbulbIcon, ShieldIcon, ClockIcon } from '../icons'

export function HelpSection() {
  const [isHelpOpen, setIsHelpOpen] = useState(false)

  return (
    <div className="mt-4 border-t border-stone-800 pt-3 sm:mt-6 sm:pt-4">
      <button
        onClick={() => setIsHelpOpen(!isHelpOpen)}
        className="flex w-full cursor-pointer items-center justify-center gap-1.5 text-[11px] text-stone-500 transition-colors hover:text-stone-400 sm:gap-2 sm:text-xs"
      >
        <HelpIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span>Tips for best results</span>
        <ChevronDownIcon
          className={`h-2.5 w-2.5 transition-transform sm:h-3 sm:w-3 ${isHelpOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {isHelpOpen && (
        <div className="mt-2 space-y-1.5 text-[11px] text-stone-500 sm:mt-3 sm:space-y-2 sm:text-xs">
          <HelpTip
            icon={
              <LightbulbIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 sm:h-4 sm:w-4" />
            }
            text="Record one instrument at a time for best pitch detection."
          />
          <HelpTip
            icon={
              <ShieldIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500 sm:h-4 sm:w-4" />
            }
            text="Everything runs locally — your audio never leaves your device."
          />
          <HelpTip
            icon={<ClockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-500 sm:h-4 sm:w-4" />}
            text="Keep recordings short (5-15s) for faster results."
          />
        </div>
      )}
    </div>
  )
}

function HelpTip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-lg bg-stone-900/50 p-2.5 sm:p-3">
      {icon}
      <p>{text}</p>
    </div>
  )
}
