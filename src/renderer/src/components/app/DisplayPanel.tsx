import { useEffect, useRef, useState } from 'react'
import RFB, { type RfbClipboardEvent, type RfbDisconnectEvent } from '@novnc/novnc'
import { Loader2, Monitor } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import type { ConnectionStatus } from '@/types'
import type { DisplayErrorCode } from '../../../../shared/ipc'

type State =
  | { kind: 'starting' }
  | { kind: 'connecting' }
  | { kind: 'connected' }
  | { kind: 'error'; code: DisplayErrorCode | 'vncFailed' | 'vncAuthFailed'; detail?: string }
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

/** The paste keys of X programs, as the key to send after the clipboard (X keysym and code). */
function pasteKey(e: KeyboardEvent): { keysym: number; code: string } | null {
  if (e.altKey || e.metaKey) return null
  // Ctrl+V (editors) and Ctrl+Shift+V (terminals): the keysym is the letter as typed. Some
  // keyboards and input methods leave `code` empty, so the key itself is checked too.
  const isV = e.code === 'KeyV' || e.key === 'v' || e.key === 'V'
  if (e.ctrlKey && isV) return { keysym: e.shiftKey ? 0x56 : 0x76, code: 'KeyV' }
  if (e.shiftKey && !e.ctrlKey && (e.code === 'Insert' || e.key === 'Insert')) {
    return { keysym: 0xff63, code: 'Insert' }
  }
  return null
}

/** Modifiers a paste key needs: their X keysyms, and the one sent when the server lacks it. */
const MODIFIERS = [
  { flag: 'ctrlKey', keysyms: [0xffe3, 0xffe4], keysym: 0xffe3, code: 'ControlLeft' },
  { flag: 'shiftKey', keysyms: [0xffe1, 0xffe2], keysym: 0xffe1, code: 'ShiftLeft' },
] as const

/** Characters the server's VNC clipboard (Latin-1 only) cannot carry; they arrive as `?`. */
const hasNonLatin1 = (text: string) => [...text].some((c) => (c.codePointAt(0) ?? 0) > 0xff)

/** The text as the server receives it: noVNC turns characters beyond Latin-1 into `?`. */
const asLatin1 = (text: string) =>
  [...text].map((c) => ((c.codePointAt(0) ?? 0) > 0xff ? '?' : c)).join('')

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
  // Messages for event handlers set up once per display session.
  const tRef = useRef(t)
  useEffect(() => {
    tRef.current = t
  }, [t])

  useEffect(() => {
    const el = screenRef.current
    if (status !== 'connected' || stopped || !el) return

    let cancelled = false
    let rfb: RFB | null = null
    // Set while noVNC is connected; before that a paste key reads nothing.
    let connected = false
    // The last text pasted from the PC, as the server got it. If the server echoes it back once,
    // it must not replace the PC clipboard (it may have lost characters on the way).
    let lastPasted: string | null = null
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
        // Keep track of the keys the server holds down: every key noVNC forwards goes through
        // sendKey, so a paste can tell whether Ctrl or Shift still has to be pressed for it.
        const send = rfb.sendKey.bind(rfb)
        rfb.sendKey = (keysym, code, down) => {
          if (down === true) serverDown.add(keysym)
          if (down === false) serverDown.delete(keysym)
          send(keysym, code, down)
        }
        rfb.addEventListener('connect', () => {
          connected = true
          if (!cancelled) setState({ kind: 'connected' })
        })
        rfb.addEventListener('disconnect', (e) => {
          connected = false
          if (cancelled) return
          const clean = (e as RfbDisconnectEvent).detail.clean
          setState(clean ? { kind: 'ended' } : { kind: 'error', code: 'vncFailed' })
        })
        rfb.addEventListener('securityfailure', () => {
          if (!cancelled) setState({ kind: 'error', code: 'vncAuthFailed' })
        })
        // Copied on the desktop (Ctrl+C, the CLIPBOARD selection) → the PC clipboard.
        rfb.addEventListener('clipboard', (e) => {
          const text = (e as RfbClipboardEvent).detail.text
          if (text === lastPasted) {
            lastPasted = null
            return
          }
          if (!cancelled) window.api.clipboard.writeText(text)
        })
      })

    // Paste on the desktop: the paste key is held back, the PC clipboard is read (only now) and
    // sent to Xvnc, and then the key goes out, in that order over the same connection, so the
    // program pastes the new text. Runs in the capture phase, before noVNC's own key handler.
    const serverDown = new Set<number>()
    let pasting = Promise.resolve()
    let warnedNotLatin1 = false
    const paste = async (
      key: { keysym: number; code: string },
      mods: (typeof MODIFIERS)[number][],
    ) => {
      const read = await window.api.clipboard.readText()
      if (cancelled || !rfb || !connected) return
      if (read === null) {
        toast.error(tRef.current.display.clipboardTooLong)
        return
      }
      const text = read.replace(/\r\n?/g, '\n')
      if (text) {
        lastPasted = asLatin1(text)
        rfb.clipboardPasteFrom(text)
        if (hasNonLatin1(text) && !warnedNotLatin1) {
          warnedNotLatin1 = true
          toast.warning(tRef.current.display.clipboardNotLatin1)
        }
      }
      // Press the modifiers the server does not hold (noVNC may not have sent them yet, e.g. a
      // Ctrl it holds back on Windows to tell it from AltGr), and release only those afterwards.
      const missing = mods.filter((m) => !m.keysyms.some((k) => serverDown.has(k)))
      for (const m of missing) rfb.sendKey(m.keysym, m.code, true)
      rfb.sendKey(key.keysym, key.code, true)
      rfb.sendKey(key.keysym, key.code, false)
      for (const m of missing.reverse()) rfb.sendKey(m.keysym, m.code, false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      const key = pasteKey(e)
      if (!key || !connected) return
      e.preventDefault()
      e.stopPropagation()
      const mods = MODIFIERS.filter((m) => e[m.flag])
      // One paste after another, in key order.
      pasting = pasting.then(() => paste(key, mods)).catch(() => {})
    }
    el.addEventListener('keydown', onKeyDown, true)

    return () => {
      cancelled = true
      el.removeEventListener('keydown', onKeyDown, true)
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
    <section className="relative h-full bg-zinc-800" data-tour="display">
      <div ref={screenRef} className="h-full w-full overflow-hidden" />
      {overlay && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-900/85 px-6 text-center text-sm text-zinc-200">
          {overlay}
        </div>
      )}
    </section>
  )
}
