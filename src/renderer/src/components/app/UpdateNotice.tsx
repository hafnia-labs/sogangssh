import { useEffect } from 'react'
import { toast } from 'sonner'
import { useI18n } from '@/i18n/context'
import { useUpdateStatus } from '@/lib/use-update-status'

const TOAST_ID = 'app-update'

/**
 * Shows a lasting notice once a newer version is downloaded. "Restart now" asks main to restart,
 * which first asks keep / end while connected (see DESIGN.md "Updates").
 */
export function UpdateNotice() {
  const { t } = useI18n()
  const readyVersion = useUpdateStatus()?.readyVersion ?? null

  useEffect(() => {
    if (!readyVersion) return
    toast.info(t.update.ready(readyVersion), {
      id: TOAST_ID,
      description: t.update.description,
      duration: Infinity,
      closeButton: true,
      action: {
        label: t.update.restart,
        onClick: (event) => {
          // Keep the notice: the user may cancel the exit question and restart later.
          event.preventDefault()
          void window.api.update.restart()
        },
      },
    })
  }, [readyVersion, t])

  return null
}

/** Small "Version x.y.z" label. */
export function AppVersion({ className }: { className?: string }) {
  const { t } = useI18n()
  const version = useUpdateStatus()?.currentVersion
  if (!version) return null
  return <span className={className}>{t.update.version(version)}</span>
}
