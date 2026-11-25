import { useEffect, useState } from 'react'
import type { UpdateStatus } from '../../../shared/ipc'

/** The app version and any downloaded update, as main reports them. */
export function useUpdateStatus(): UpdateStatus | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null)

  useEffect(() => {
    let active = true
    void window.api.update.getStatus().then((s) => {
      if (active && s) setStatus((current) => current ?? s)
    })
    const unsubscribe = window.api.update.onStatus(setStatus)
    return () => {
      active = false
      unsubscribe()
    }
  }, [])

  return status
}
