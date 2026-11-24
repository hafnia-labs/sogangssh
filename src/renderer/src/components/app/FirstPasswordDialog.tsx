import { useState, type FormEvent } from 'react'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/i18n/context'
import type { PasswordChangeErrorCode } from '../../../../shared/ipc'

// Errors are stored as codes so they re-render in the new language after a switch.
type ChangeError =
  | { kind: 'form'; key: 'errorEmpty' | 'errorMismatch' | 'errorSame' }
  | { kind: 'server'; code: PasswordChangeErrorCode; detail?: string }

type Props = {
  /** The password the user just logged in with (the expired initial one). */
  current: string
  /** The password was changed (or may have been): log in again with `next`. */
  onChanged: (next: string) => void
  onCancel: () => void
}

/**
 * First login: the initial password has expired, so the server lets the user do nothing but
 * change it. Asks only for the new password; the current one is what was just typed.
 */
export function FirstPasswordDialog({ current, onChanged, onCancel }: Props) {
  const { t } = useI18n()
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ChangeError | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!next || !confirm) return setError({ kind: 'form', key: 'errorEmpty' })
    if (next !== confirm) return setError({ kind: 'form', key: 'errorMismatch' })
    if (next === current) return setError({ kind: 'form', key: 'errorSame' })
    setError(null)
    setPending(true)
    // A thrown IPC call carries Electron's English text, so show only the translated message.
    const result = await window.api.ssh.changeExpiredPassword({ current, next }).catch(() => ({
      ok: false as const,
      error: 'failed' as const,
      detail: undefined,
    }))
    setPending(false)
    // Cut off after the confirmation: the new password is the likelier one, so try it first.
    if (result.ok || result.error === 'maybeChanged') {
      onChanged(next)
      return
    }
    setError({ kind: 'server', code: result.error, detail: result.detail })
  }

  return (
    <AlertDialog open onOpenChange={(open) => !open && !pending && onCancel()}>
      <AlertDialogContent>
        <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.firstPassword.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.firstPassword.description}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="text-muted-foreground text-xs">{t.firstPassword.hint}</p>
          <div className="grid gap-2">
            <Label htmlFor="first-password-new">{t.changePassword.next}</Label>
            <Input
              id="first-password-new"
              type="password"
              autoComplete="off"
              autoFocus
              value={next}
              onChange={(e) => setNext(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="first-password-confirm">{t.changePassword.confirm}</Label>
            <Input
              id="first-password-confirm"
              type="password"
              autoComplete="off"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
          {error && (
            <div role="alert" className="text-destructive grid gap-1 text-sm">
              <p>
                {error.kind === 'form'
                  ? t.changePassword[error.key]
                  : t.changePassword.errors[error.code]}
              </p>
              {/* Server output as-is (passwords removed in main), e.g. "BAD PASSWORD: …". */}
              {error.kind === 'server' && error.detail && (
                <p className="font-mono text-xs break-all">{error.detail}</p>
              )}
            </div>
          )}
          <AlertDialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={onCancel}>
              {t.changePassword.cancel}
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? t.changePassword.submitting : t.firstPassword.submit}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  )
}
