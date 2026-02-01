export function Header() {
  return (
    <header className="border-b border-amber-900/30 bg-gradient-to-r from-stone-950 via-stone-900 to-stone-950">
      <div className="mx-auto max-w-7xl px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-600 shadow-lg shadow-amber-500/20">
            <svg
              className="h-6 w-6 text-stone-950"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 19V6l12-3v13M9 19c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zm12-3c0 1.105-1.343 2-3 2s-3-.895-3-2 1.343-2 3-2 3 .895 3 2zM9 10l12-3"
              />
            </svg>
          </div>
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-amber-50">
              Riff Harmonics
            </h1>
            <p className="text-xs text-stone-500">
              Discover chords for your melodies
            </p>
          </div>
        </div>
      </div>
    </header>
  )
}
