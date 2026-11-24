import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import type { CloseChoice, DisplayEndResult } from '../../../../shared/ipc'

/**
 * Asked when the app closes while connected: keep the remote desktop running on the server for
 * the next login, or end it and everything on it.
 */
export function ExitDialog() {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<CloseChoice | null>(null)
  const [failure, setFailure] = useState<Extract<DisplayEndResult, { ok: false }> | null>(null)
  // Technical detail as-is; "not connected" is a translated message.
  const error =
    failure && (failure.error === 'notConnected' ? t.display.errors.notConnected : failure.detail)

  useEffect(
    () =>
      window.api.app.onCloseRequested(() => {
        setFailure(null)
        setOpen(true)
      }),
    [],
  )

  const choose = async (choice: CloseChoice) => {
    if (choice === 'cancel') {
      setOpen(false)
      return
    }
    setBusy(choice)
    setFailure(null)
    const result = await window.api.app.close(choice)
    // On success the app quits; we only get here to show a failure.
    setBusy(null)
    if (!result.ok) setFailure(result)
  }

  return (
    <AlertDialog open={open} onOpenChange={(next) => !busy && setOpen(next)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.exit.title}</AlertDialogTitle>
          <AlertDialogDescription>{t.exit.description}</AlertDialogDescription>
        </AlertDialogHeader>
        {failure !== null && (
          <p className="text-destructive text-sm">
            {t.exit.failed}
            {error && <span className="block font-mono text-xs break-all">{error}</span>}
          </p>
        )}
        <AlertDialogFooter>
          <Button variant="outline" disabled={busy !== null} onClick={() => void choose('cancel')}>
            {t.exit.cancel}
          </Button>
          <Button variant="destructive" disabled={busy !== null} onClick={() => void choose('end')}>
            {busy === 'end' && <Loader2 className="animate-spin" />}
            {busy === 'end' ? t.exit.ending : t.exit.end}
          </Button>
          <Button disabled={busy !== null} onClick={() => void choose('keep')}>
            {t.exit.keep}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
