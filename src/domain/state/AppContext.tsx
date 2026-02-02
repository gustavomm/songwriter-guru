import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from 'react'
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
// Provider
// ─────────────────────────────────────────────────────────────────────────────

interface AppProviderProps {
  children: ReactNode
  /** Optional initial state for testing/mocking */
  initialState?: AppState
}

export function AppProvider({ children, initialState }: AppProviderProps) {
  const [state, dispatch] = useReducer(appReducer, initialState ?? initialAppState)

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
