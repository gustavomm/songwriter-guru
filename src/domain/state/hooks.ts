import { useContext } from 'react'
import { AppContext } from './appContextValue'

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
