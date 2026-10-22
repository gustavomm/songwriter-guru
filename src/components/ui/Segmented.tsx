interface SegmentedProps<T extends string> {
  options: { id: T; label: string }[]
  value: T
  onChange: (id: T) => void
  /** Accessible name for the group */
  label: string
}

/** A small pill-shaped switch between a few options */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="inline-flex shrink-0 rounded-full border border-stone-700 bg-stone-950/50 p-0.5"
    >
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`min-h-8 cursor-pointer rounded-full px-3 text-xs whitespace-nowrap transition-colors ${
            value === o.id ? 'bg-stone-700 text-stone-100' : 'text-stone-400 hover:text-stone-200'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
