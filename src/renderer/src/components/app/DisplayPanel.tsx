import { useEffect, useRef, useState } from 'react'
import RFB, { type RfbDisconnectEvent } from '@novnc/novnc'
import { Loader2, Monitor } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import type { ConnectionStatus } from '@/types'
import type { DisplayErrorCode } from '../../../../shared/ipc'

type State =
  | { kind: 'starting' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'error'; code: DisplayErrorCode | 'vncFailed'; detail?: string }
  | { kind: 'ended' }

type Props = {
  status: ConnectionStatus
  /** The user ended the session: show that instead of reattaching. */
  stopped: boolean
  onStartNew: () => void
  onDisplay: (display: number | null) => void
  onBackToLogin: () => void
}

// X servers prefer even sizes; keep within what Xvnc accepts.
const toSize = (n: number, fallback: number) => (n >= 320 ? Math.floor(n / 2) * 2 : fallback)

/**
 * The user's persistent remote desktop (Xvnc on the server), shown with noVNC through the SSH
 * tunnel. Mounting reattaches to the running desktop, or starts one if there is none.
 */
export function DisplayPanel({ status, stopped, onStartNew, onDisplay, onBackToLogin }: Props) {
  const { t } = useI18n()
  const screenRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>({ kind: 'starting' })
  // Bumping this restarts the display session.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const el = screenRef.current
    if (status !== 'connected' || stopped || !el) return

    let cancelled = false
    let rfb: RFB | null = null
    setState({ kind: 'starting' })

    void window.api.display
      .start(toSize(el.clientWidth, 1600), toSize(el.clientHeight, 900))
      .then((result) => {
        if (cancelled) return
        if (!result.ok) {
          setState({ kind: 'error', code: result.error, detail: result.detail })
          return
        }
        onDisplay(result.display)
        setState({ kind: 'connecting' })
        rfb = new RFB(el, result.url, {
          credentials: { password: result.password },
          wsProtocols: ['binary'],
          // Not shared: opening the session on another PC takes it over from this one.
          shared: false,
        })
        // Ask Xvnc to match the panel size; scale down if the server keeps its own size.
        rfb.resizeSession = true
        rfb.scaleViewport = true
        rfb.background = '#27272a'
        rfb.addEventListener('connect', () => {
          if (!cancelled) setState({ kind: 'connected' })
        })
        rfb.addEventListener('disconnect', (e) => {
          if (cancelled) return
          const clean = (e as RfbDisconnectEvent).detail.clean
          setState(clean ? { kind: 'ended' } : { kind: 'error', code: 'vncFailed' })
        })
        rfb.addEventListener('securityfailure', () => {
          if (!cancelled) setState({ kind: 'error', code: 'vncFailed', detail: 'security failure' })
        })
      })

    return () => {
      cancelled = true
      rfb?.disconnect()
      onDisplay(null)
    }
  }, [status, stopped, generation, onDisplay])

  const restart = () => setGeneration((g) => g + 1)

  let overlay: React.ReactNode = null
  if (status !== 'connected') {
    overlay = (
      <>
        <p>{status === 'reconnecting' ? t.display.reconnecting : t.display.disconnected}</p>
        {status === 'disconnected' && (
          <Button variant="secondary" size="sm" onClick={onBackToLogin}>
            {t.display.backToLogin}
          </Button>
        )}
      </>
    )
  } else if (stopped) {
    overlay = (
      <>
        <Monitor className="size-8 text-zinc-500" strokeWidth={1.5} />
        <p>{t.display.stopped}</p>
        <Button variant="secondary" size="sm" onClick={onStartNew}>
          {t.display.startNew}
        </Button>
      </>
    )
  } else if (state.kind === 'starting' || state.kind === 'connecting') {
    overlay = (
      <>
        <Loader2 className="size-6 animate-spin text-zinc-400" />
        <p>{state.kind === 'starting' ? t.display.starting : t.display.connecting}</p>
      </>
    )
  } else if (state.kind === 'error' || state.kind === 'ended') {
    overlay = (
      <>
        <Monitor className="size-8 text-zinc-500" strokeWidth={1.5} />
        <p>{state.kind === 'ended' ? t.display.ended : t.display.errors[state.code]}</p>
        {state.kind === 'error' && state.detail && (
          <p className="max-w-md font-mono text-xs break-all text-zinc-500">{state.detail}</p>
        )}
        <Button variant="secondary" size="sm" onClick={restart}>
          {t.display.restart}
        </Button>
      </>
    )
  }

  return (
    <section className="relative h-full bg-zinc-800">
      <div ref={screenRef} className="h-full w-full overflow-hidden" />
      {overlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/85 px-6 text-center text-sm text-zinc-200">
          {overlay}
        </div>
      )}
    </section>
  )
}
