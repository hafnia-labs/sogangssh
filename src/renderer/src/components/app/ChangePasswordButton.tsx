import { useState, type FormEvent } from 'react'
import { KeyRound, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n/context'
import type { PasswordChangeErrorCode } from '../../../../shared/ipc'

// Errors are stored as codes so they re-render in the new language after a switch.
type ChangeError =
  | { kind: 'form'; key: 'errorEmpty' | 'errorMismatch' | 'errorSame' }
  | { kind: 'server'; code: PasswordChangeErrorCode; detail?: string }

type Props = { disabled: boolean }

/** Toolbar action that changes the user's server account password with `passwd`. */
export function ChangePasswordButton({ disabled }: Props) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<ChangeError | null>(null)

  // Passwords live only while the dialog is open.
  const reset = () => {
    setCurrent('')
    setNext('')
    setConfirm('')
    setError(null)
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!current || !next || !confirm) return setError({ kind: 'form', key: 'errorEmpty' })
    if (next !== confirm) return setError({ kind: 'form', key: 'errorMismatch' })
    if (next === current) return setError({ kind: 'form', key: 'errorSame' })
    setError(null)
    setPending(true)
    const result = await window.api.password.change({ current, next }).catch((err: Error) => ({
      ok: false as const,
      error: 'failed' as const,
      detail: err.message,
    }))
    setPending(false)
    if (result.ok) {
      reset()
      setOpen(false)
      toast.success(t.changePassword.success)
    } else {
      setError({ kind: 'server', code: result.error, detail: result.detail })
      // A wrong current password is the field to retype.
      if (result.error === 'wrongPassword') setCurrent('')
    }
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
              reset()
              setOpen(true)
            }}
            aria-label={t.toolbar.changePassword}
          >
            <KeyRound />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t.toolbar.changePassword}</TooltipContent>
      </Tooltip>
      <AlertDialog
        open={open}
        onOpenChange={(nextOpen) => {
          if (pending) return
          setOpen(nextOpen)
          if (!nextOpen) reset()
        }}
      >
        <AlertDialogContent>
          <form onSubmit={(e) => void submit(e)} className="grid gap-4" noValidate>
            <AlertDialogHeader>
              <AlertDialogTitle>{t.changePassword.title}</AlertDialogTitle>
              <AlertDialogDescription>{t.changePassword.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="grid gap-2">
              <Label htmlFor="password-current">{t.changePassword.current}</Label>
              <Input
                id="password-current"
                type="password"
                autoComplete="current-password"
                autoFocus
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password-new">{t.changePassword.next}</Label>
              <Input
                id="password-new"
                type="password"
                autoComplete="new-password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password-confirm">{t.changePassword.confirm}</Label>
              <Input
                id="password-confirm"
                type="password"
                autoComplete="new-password"
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
              <AlertDialogCancel type="button" disabled={pending}>
                {t.changePassword.cancel}
              </AlertDialogCancel>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {pending ? t.changePassword.submitting : t.changePassword.submit}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
