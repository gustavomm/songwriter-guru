import { useEffect } from 'react'
import { Header } from '../components/Header'
import { Footer } from '../components/Footer'
import { RecorderCard } from '../components/recorder'
import { HarmonicFieldsPanel } from '../components/harmony'
import { ChordsPanel } from '../components/chords'
import { ProgressionsPanel } from '../components/progressions'
import { AppProvider, mockAnalyzedState, useAppState } from '../domain/state'
import { transcriptionService } from '../services/transcriptionService'

// Toggle this to test with mock data (set to false for real recording)
const USE_MOCK_DATA = false

function MainContent() {
  const { status } = useAppState()
  const hasAnalysis = status === 'analyzed'

  // Preload the Basic Pitch model on app mount
  // This warms up the model cache so the first transcription is faster
  useEffect(() => {
    // Start loading the model in the background
    // Don't await - let it load while user records
    transcriptionService.ensureModelLoaded().catch(() => {
      // Silently handle preload errors - will retry when user transcribes
    })
  }, [])

  return (
    <main className="flex-1 px-6 py-8">
      <div className="mx-auto max-w-7xl">
        {/* Top row: Recorder + Detected Keys (always 2 columns on desktop) */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <RecorderCard />
          <HarmonicFieldsPanel />
        </div>

        {/* Bottom section: Chords + Progressions (full width after analysis) */}
        {hasAnalysis && (
          <div className="mt-6 space-y-6">
            <ChordsPanel />
            <ProgressionsPanel />
          </div>
        )}
      </div>
    </main>
  )
}

export default function App() {
  return (
    <AppProvider initialState={USE_MOCK_DATA ? mockAnalyzedState : undefined}>
      <div className="flex min-h-screen flex-col bg-stone-950 text-stone-100">
        <Header />
        <MainContent />
        <Footer />
      </div>
    </AppProvider>
  )
}
