import { useReducer, useEffect, useRef, useMemo, type ReactNode } from 'react'
import { appReducer, initialAppState, type AppState } from './AppState'
import { AppContext } from './appContextValue'

// ─────────────────────────────────────────────────────────────────────────────
// Debug Helper (development only)
// ─────────────────────────────────────────────────────────────────────────────

// Expose debug functions on window in development
declare global {
  interface Window {
    __APP_DEBUG__?: {
      getState: () => AppState
      getStateJSON: () => string
      copyState: () => void
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface AppProviderProps {
  children: ReactNode
  /** Optional initial state for testing/mocking */
  initialState?: AppState
}

export function AppProvider({ children, initialState }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState ?? initialAppState)

  // Use ref to access latest state without re-running effects
  const stateRef = useRef(state)
  stateRef.current = state

  // Expose state to window for debugging (development only) - runs only once on mount
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__APP_DEBUG__ = {
        getState: () => stateRef.current,
        getStateJSON: () => {
          const currentState = stateRef.current
          // Create a serializable copy (Maps -> Objects)
          const serializable = {
            ...currentState,
            chords: currentState.chords
              ? {
                  diatonic: currentState.chords.diatonic,
                  secondary: currentState.chords.secondary,
                  borrowed: currentState.chords.borrowed,
                  ranked: currentState.chords.ranked,
                }
              : null,
          }
          return JSON.stringify(serializable, null, 2)
        },
        copyState: () => {
          const json = window.__APP_DEBUG__?.getStateJSON() || '{}'
          navigator.clipboard.writeText(json)
          console.log('State copied to clipboard!')
        },
      }
      console.log(
        '%c🎸 Debug helper available: __APP_DEBUG__.copyState() to copy state to clipboard',
        'color: #10b981; font-weight: bold'
      )
    }
  }, []) // Empty deps - only runs once on mount

  // Memoize context value to prevent unnecessary re-renders when only dispatch changes
  const contextValue = useMemo(() => ({ state, dispatch }), [state])

  return <AppContext.Provider value={contextValue}>{children}</AppContext.Provider>
}
