import { useEffect, useRef, useState } from 'react'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'

type State = 'opening' | 'open' | 'exited' | 'error'

// Fixed dark palette: the terminal stays dark whatever the app theme is.
const theme = {
  background: '#09090b',
  foreground: '#e4e4e7',
  cursor: '#e4e4e7',
  cursorAccent: '#09090b',
  selectionBackground: '#3f3f46',
}

/** The server's bash shell (SSH PTY) rendered with xterm.js. Server output is never translated. */
export function TerminalPanel() {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<State>('opening')
  // Bumping this tears the terminal down and opens a fresh shell.
  const [generation, setGeneration] = useState(0)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const term = new Terminal({
      fontFamily: '"Cascadia Mono", Consolas, D2Coding, "Malgun Gothic", monospace',
      fontSize: 13,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      theme,
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(el)

    // Skip fitting while the panel is collapsed (zero size) so the PTY keeps its last size.
    const safeFit = () => {
      if (el.clientWidth === 0 || el.clientHeight === 0) return
      try {
        fit.fit()
      } catch {
        // The renderer may not be ready on the very first frame; the observer retries.
      }
    }
    safeFit()

    let disposed = false
    const offData = window.api.terminal.onData((data) => term.write(data))
    const offExit = window.api.terminal.onExit(() => setState('exited'))
    const input = term.onData((data) => window.api.terminal.input(data))
    const resize = term.onResize(({ cols, rows }) => window.api.terminal.resize(cols, rows))

    // Windows-style clipboard: Ctrl+C copies when text is selected (otherwise it interrupts),
    // Ctrl+V pastes through the browser's paste event, which xterm handles.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !e.ctrlKey || e.altKey || e.metaKey) return true
      const key = e.key.toLowerCase()
      if (key === 'c' && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection())
        term.clearSelection()
        return false
      }
      if (key === 'v') return false
      return true
    })

    void window.api.terminal.open(term.cols, term.rows).then((result) => {
      if (disposed) return
      if (!result.ok) {
        setState('error')
        return
      }
      if (result.replay) term.write(result.replay)
      setState('open')
      term.focus()
    })

    const observer = new ResizeObserver(safeFit)
    observer.observe(el)

    return () => {
      disposed = true
      observer.disconnect()
      offData()
      offExit()
      input.dispose()
      resize.dispose()
      term.dispose()
    }
  }, [generation])

  function reopen() {
    setState('opening')
    setGeneration((g) => g + 1)
  }

  return (
    <section className="flex h-full flex-col bg-zinc-950 text-zinc-200">
      <div className="flex h-7 shrink-0 items-center border-b border-zinc-800 px-3 text-xs text-zinc-400">
        {t.terminal.title}
      </div>
      <div className="relative min-h-0 flex-1 px-2 py-1">
        <div ref={containerRef} className="h-full w-full" />
        {(state === 'exited' || state === 'error') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-zinc-950/85 px-6 text-center text-sm">
            <p>{state === 'exited' ? t.terminal.exited : t.terminal.openFailed}</p>
            <Button variant="secondary" size="sm" onClick={reopen}>
              {t.terminal.reopen}
            </Button>
          </div>
        )}
      </div>
    </section>
  )
}
