import {
  createContext,
  useContext,
  useReducer,
  useEffect,
  type ReactNode,
  type Dispatch,
} from 'react'
import { appReducer, initialAppState, type AppState, type AppAction } from './AppState'

// ─────────────────────────────────────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────────────────────────────────────

interface AppContextValue {
  state: AppState
  dispatch: Dispatch<AppAction>
}

const AppContext = createContext<AppContextValue | null>(null)

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

  // Expose state to window for debugging (development only)
  useEffect(() => {
    if (import.meta.env.DEV) {
      window.__APP_DEBUG__ = {
        getState: () => state,
        getStateJSON: () => {
          // Create a serializable copy (Maps -> Objects)
          const serializable = {
            ...state,
            chordSuggestions: state.chordSuggestions
              ? {
                  diatonic: state.chordSuggestions.diatonic,
                  secondary: state.chordSuggestions.secondary,
                  borrowed: state.chordSuggestions.borrowed,
                  ranked: state.chordSuggestions.ranked,
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
  }, [state])

  return <AppContext.Provider value={{ state, dispatch }}>{children}</AppContext.Provider>
}

// ─────────────────────────────────────────────────────────────────────────────
// Hook
// ─────────────────────────────────────────────────────────────────────────────

export function useApp() {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useApp must be used within an AppProvider')
  }
  return context
}

// Convenience hooks for specific slices
export function useAppState() {
  return useApp().state
}

export function useAppDispatch() {
  return useApp().dispatch
}
