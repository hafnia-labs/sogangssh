import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, Loader2 } from 'lucide-react'
import { BrandName } from '@/components/app/BrandName'
import { GuideMascot } from '@/components/app/GuideMascot'
import { GuideToggle } from '@/components/app/GuideToggle'
import { LanguageToggle } from '@/components/app/LanguageToggle'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useI18n } from '@/i18n/context'
import { serverDefaults } from '@/config'
import type { ConnectErrorCode, ConnectResult } from '../../../shared/ipc'

export type Session = { host: string; port: number; username: string }

type Props = {
  onLogin: (session: Session) => void
}

// Errors are stored as codes so they re-render in the new language after a switch.
type LoginError =
  | { kind: 'form'; key: 'errorEmpty' | 'errorPort' }
  | {
      kind: 'connect'
      code: ConnectErrorCode
      detail?: string
      fingerprint?: string
      savedFingerprint?: string
    }

type PendingHostKey = { fingerprint: string }

export function LoginScreen({ onLogin }: Props) {
  const { t } = useI18n()
  const [user, setUser] = useState('')
  const [password, setPassword] = useState('')
  const [host, setHost] = useState(serverDefaults.host)
  const [port, setPort] = useState(String(serverDefaults.port))
  const [error, setError] = useState<LoginError | null>(null)
  const [pending, setPending] = useState(false)
  const [hostKey, setHostKey] = useState<PendingHostKey | null>(null)
  const userRef = useRef<HTMLInputElement>(null)
  const passwordRef = useRef<HTMLInputElement>(null)

  // Prefill the server and ID from this user's last successful login; first launch uses defaults.
  useEffect(() => {
    let cancelled = false
    window.api.settings
      .getLastLogin()
      .then((last) => {
        if (cancelled) return
        if (last) {
          setHost(last.host)
          setPort(String(last.port))
          setUser(last.username)
          passwordRef.current?.focus()
        } else {
          userRef.current?.focus()
        }
      })
      .catch(() => userRef.current?.focus())
    return () => {
      cancelled = true
    }
  }, [])

  async function connect(trustFingerprint?: string) {
    const portNumber = Number(port)
    setError(null)
    setPending(true)
    let result: ConnectResult
    try {
      result = await window.api.ssh.connect({
        host: host.trim(),
        port: portNumber,
        username: user.trim(),
        password,
        trustFingerprint,
      })
    } catch (err) {
      result = { ok: false, error: 'unknown', detail: (err as Error).message }
    }
    setPending(false)

    if (result.ok) {
      setPassword('')
      onLogin({ host: result.host, port: result.port, username: result.username })
      return
    }
    if (result.error === 'hostKeyUnknown' && result.fingerprint) {
      setHostKey({ fingerprint: result.fingerprint })
      return
    }
    setError({
      kind: 'connect',
      code: result.error,
      detail: result.detail,
      fingerprint: result.fingerprint,
      savedFingerprint: result.savedFingerprint,
    })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!user.trim() || !password || !host.trim()) {
      setError({ kind: 'form', key: 'errorEmpty' })
      return
    }
    const portNumber = Number(port)
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      setError({ kind: 'form', key: 'errorPort' })
      return
    }
    void connect()
  }

  function trustHostKey() {
    const fingerprint = hostKey?.fingerprint
    setHostKey(null)
    if (fingerprint) void connect(fingerprint)
  }

  return (
    <main className="bg-muted/40 relative flex h-screen items-center justify-center p-6">
      <div className="absolute top-3 right-3 flex items-center gap-1">
        <GuideToggle />
        <LanguageToggle />
      </div>
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>
            <BrandName size="lg" />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="grid gap-4" noValidate data-tour="login-form">
            <div className="grid gap-2">
              <Label htmlFor="user">{t.login.user}</Label>
              <Input
                id="user"
                ref={userRef}
                autoComplete="username"
                value={user}
                onChange={(e) => setUser(e.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">{t.login.password}</Label>
              <Input
                id="password"
                ref={passwordRef}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <Collapsible>
              <CollapsibleTrigger className="text-muted-foreground hover:text-foreground group flex items-center gap-1 text-xs">
                {t.login.advanced}
                <ChevronDown className="size-3.5 transition-transform group-data-[state=open]:rotate-180" />
              </CollapsibleTrigger>
              <CollapsibleContent className="grid grid-cols-[1fr_5rem] gap-2 pt-3">
                <div className="grid gap-2">
                  <Label htmlFor="host">{t.login.host}</Label>
                  <Input id="host" value={host} onChange={(e) => setHost(e.target.value)} />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="port">{t.login.port}</Label>
                  <Input
                    id="port"
                    inputMode="numeric"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                  />
                </div>
              </CollapsibleContent>
            </Collapsible>

            {error && (
              <div role="alert" className="text-destructive grid gap-1 text-sm">
                <p>{error.kind === 'form' ? t.login[error.key] : t.connectError[error.code]}</p>
                {error.kind === 'connect' && error.code === 'hostKeyChanged' && (
                  <dl className="text-muted-foreground grid gap-0.5 font-mono text-[11px] break-all">
                    <dt className="font-sans">{t.hostKey.saved}</dt>
                    <dd>{error.savedFingerprint}</dd>
                    <dt className="font-sans">{t.hostKey.received}</dt>
                    <dd>{error.fingerprint}</dd>
                  </dl>
                )}
                {error.kind === 'connect' && error.detail && (
                  <details className="text-muted-foreground text-xs">
                    <summary className="cursor-pointer">{t.login.technicalDetail}</summary>
                    <p className="font-mono break-all">{error.detail}</p>
                  </details>
                )}
              </div>
            )}

            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" />}
              {pending ? t.login.submitting : t.login.submit}
            </Button>
            <p className="text-muted-foreground text-xs" data-tour="login-forgot">
              {t.login.forgotPassword}
            </p>
          </form>
        </CardContent>
      </Card>
      <GuideMascot screen="login" />

      <AlertDialog open={hostKey !== null} onOpenChange={(open) => !open && setHostKey(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t.hostKey.title}</AlertDialogTitle>
            <AlertDialogDescription>{t.hostKey.description(host.trim())}</AlertDialogDescription>
          </AlertDialogHeader>
          <p className="bg-muted rounded-md px-3 py-2 font-mono text-xs break-all">
            {hostKey?.fingerprint}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>{t.hostKey.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={trustHostKey}>{t.hostKey.trust}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}
