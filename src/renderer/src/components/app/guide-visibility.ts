import { useSyncExternalStore } from 'react'

// Whether the user hid the guide character. Shared by the mascot and its toggle buttons, and
// remembered in local storage (a convenience: losing it only shows 서강이 again).
const HIDDEN_KEY = 'sogangssh.guide.hidden'

function readHidden(): boolean {
  try {
    return localStorage.getItem(HIDDEN_KEY) === '1'
  } catch {
    return false
  }
}

let hidden = readHidden()
const listeners = new Set<() => void>()

export function setGuideHidden(value: boolean): void {
  hidden = value
  try {
    if (value) localStorage.setItem(HIDDEN_KEY, '1')
    else localStorage.removeItem(HIDDEN_KEY)
  } catch {
    // Storage unavailable: the choice lasts until the app closes.
  }
  listeners.forEach((listener) => listener())
}

export function useGuideHidden(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => hidden,
  )
}
