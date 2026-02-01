export function Footer() {
  return (
    <footer className="border-t border-stone-800/50 bg-stone-950/80 backdrop-blur">
      <div className="mx-auto max-w-7xl px-6 py-4">
        <p className="text-center text-xs text-stone-600">
          <span className="inline-flex items-center gap-1.5">
            <svg
              className="h-3.5 w-3.5 text-emerald-600"
              fill="currentColor"
              viewBox="0 0 20 20"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z"
                clipRule="evenodd"
              />
            </svg>
            Runs 100% locally in your browser — your audio never leaves your device
          </span>
        </p>
        <p className="mt-2 text-center text-xs text-stone-700">
          Built by{' '}
          <a
            href="https://github.com/gustavomm"
            target="_blank"
            rel="noopener noreferrer"
            className="text-stone-500 transition-colors hover:text-amber-500"
          >
            Gustavo Moreira
          </a>
        </p>
      </div>
    </footer>
  )
}
