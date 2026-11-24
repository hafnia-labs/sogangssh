import { useState } from 'react'
import { Loader2, Power } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n/context'
import type { DisplayEndResult } from '../../../../shared/ipc'

type Props = {
  disabled: boolean
  onEnd: () => Promise<DisplayEndResult>
}

/** Toolbar action that ends the remote desktop and everything on it, after a confirmation. */
export function EndSessionButton({ disabled, onEnd }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [ending, setEnding] = useState(false)
  const [failure, setFailure] = useState<Extract<DisplayEndResult, { ok: false }> | null>(null)
  // Technical detail as-is; "not connected" is a translated message.
  const error =
    failure && (failure.error === 'notConnected' ? t.display.errors.notConnected : failure.detail)

  const end = async () => {
    setEnding(true)
    setFailure(null)
    const result = await onEnd()
    setEnding(false)
    if (result.ok) setOpen(false)
    else setFailure(result)
  }

  return (
    <>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            onClick={() => {
              setFailure(null)
              setOpen(true)
            }}
            aria-label={t.toolbar.endSession}
          >
            <Power />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t.toolbar.endSession}</TooltipContent>
      </Tooltip>
      <AlertDialog open={open} onOpenChange={(next) => !ending && setOpen(next)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.endSession.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.endSession.description}</AlertDialogDescription>
          </AlertDialogHeader>
          {failure !== null && (
            <p className="text-destructive text-sm">
              {t.endSession.failed}
              {error && <span className="block font-mono text-xs break-all">{error}</span>}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={ending}>{t.endSession.cancel}</AlertDialogCancel>
            <Button variant="destructive" disabled={ending} onClick={() => void end()}>
              {ending && <Loader2 className="animate-spin" />}
              {ending ? t.endSession.ending : t.endSession.confirm}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
