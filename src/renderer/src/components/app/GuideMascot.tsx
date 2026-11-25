import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
} from 'react'
import { X } from 'lucide-react'
import cheerUrl from '@/assets/mascot/cheer.png'
import idleUrl from '@/assets/mascot/idle.png'
import joyUrl from '@/assets/mascot/joy.png'
import lookUrl from '@/assets/mascot/look.png'
import teachUrl from '@/assets/mascot/teach.png'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n/context'
import type { Messages } from '@/i18n/ko'
import { cn } from '@/lib/utils'
import { isGuideHidden, setGuideHidden, useGuideHidden } from './guide-visibility'

// The official 서강이 poses (sogang.ac.kr character download), only scaled down.
const POSES = {
  idle: idleUrl,
  joy: joyUrl,
  look: lookUrl,
  teach: teachUrl,
  cheer: cheerUrl,
} as const
type Pose = keyof typeof POSES

type Screen = 'login' | 'main'
type StepKey<S extends Screen> = keyof Messages['guide'][S]

/** A tutorial step: its text key, the pose, and the element it outlines (`data-tour`). */
type Step<S extends Screen> = { key: StepKey<S>; pose: Pose; target?: string }

const STEPS: { [S in Screen]: Step<S>[] } = {
  login: [
    { key: 'welcome', pose: 'joy' },
    { key: 'account', pose: 'teach', target: 'login-form' },
    { key: 'hostKey', pose: 'look', target: 'login-form' },
    { key: 'forgot', pose: 'teach', target: 'login-forgot' },
  ],
  main: [
    { key: 'welcome', pose: 'joy' },
    { key: 'launchers', pose: 'teach', target: 'launchers' },
    { key: 'display', pose: 'look', target: 'display' },
    { key: 'workbenchSave', pose: 'teach', target: 'display' },
    { key: 'workbenchTyping', pose: 'look', target: 'display' },
    { key: 'terminal', pose: 'teach', target: 'terminal' },
    { key: 'server', pose: 'look', target: 'server' },
    { key: 'endSession', pose: 'teach', target: 'end-session' },
    { key: 'done', pose: 'cheer' },
  ],
}

/** The mascot's box (the image is fitted inside), the bubble width, and the window margin. */
const SIZE = 64
const BUBBLE_WIDTH = 288
const MARGIN = 8
/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD = 5

// Local storage, for conveniences only: losing it just brings back the defaults.
const SEEN_KEY = 'sogangssh.guide.mainSeen'
const positionKey = (screen: Screen) => `sogangssh.guide.position.${screen}`

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Storage unavailable: nothing is remembered, which is harmless.
  }
}

type Point = { x: number; y: number }

function readPosition(screen: Screen): Point | null {
  try {
    const p = JSON.parse(readStorage(positionKey(screen)) ?? 'null') as Partial<Point> | null
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? { x: p.x!, y: p.y! } : null
  } catch {
    return null
  }
}

type Viewport = { width: number; height: number }

function subscribeResize(listener: () => void): () => void {
  window.addEventListener('resize', listener)
  return () => window.removeEventListener('resize', listener)
}

/** The window size, re-rendering on resize. */
function useViewport(): Viewport {
  const size = useSyncExternalStore(
    subscribeResize,
    () => `${window.innerWidth}x${window.innerHeight}`,
  )
  const [width, height] = size.split('x').map(Number)
  return { width, height }
}

/** Keep the mascot fully inside the window. */
function clampPoint(p: Point, view: Viewport): Point {
  return {
    x: Math.min(Math.max(p.x, 0), Math.max(0, view.width - SIZE)),
    y: Math.min(Math.max(p.y, 0), Math.max(0, view.height - SIZE)),
  }
}

/**
 * Default corner. Login screen: bottom right (nothing else there). Main screen: bottom left
 * above the status bar, so it never covers the terminal's prompt line.
 */
function defaultPoint(screen: Screen, view: Viewport): Point {
  return screen === 'main'
    ? { x: 12, y: view.height - 32 - SIZE }
    : { x: view.width - 16 - SIZE, y: view.height - 16 - SIZE }
}

/** Place the bubble beside the mascot: toward the wider side, above it when there is room. */
function bubbleStyle(p: Point, view: Viewport): CSSProperties {
  const onLeftHalf = p.x + SIZE / 2 < view.width / 2
  const left = Math.min(
    Math.max(onLeftHalf ? p.x : p.x + SIZE - BUBBLE_WIDTH, MARGIN),
    Math.max(MARGIN, view.width - BUBBLE_WIDTH - MARGIN),
  )
  return p.y > 240
    ? { left, bottom: view.height - p.y + MARGIN }
    : { left, top: p.y + SIZE + MARGIN }
}

type Rect = { top: number; left: number; width: number; height: number }

/** Where the outlined element is now, or null when it is hidden (e.g. a collapsed panel). */
function useTargetRect(target: string | undefined, active: boolean): Rect | null {
  const [rect, setRect] = useState<Rect | null>(null)
  useLayoutEffect(() => {
    if (!active || !target) return
    const update = () => {
      const el = document.querySelector(`[data-tour="${target}"]`)
      const r = el?.getBoundingClientRect()
      setRect((prev) => {
        if (!r || r.width < 4 || r.height < 4) return null
        const next = { top: r.top, left: r.left, width: r.width, height: r.height }
        const same =
          prev &&
          prev.top === next.top &&
          prev.left === next.left &&
          prev.width === next.width &&
          prev.height === next.height
        return same ? prev : next
      })
    }
    update()
    // Panels resize and collapse without window events, so follow the element while open.
    const timer = setInterval(update, 250)
    window.addEventListener('resize', update)
    return () => {
      clearInterval(timer)
      window.removeEventListener('resize', update)
    }
  }, [target, active])
  // A stale rect from an earlier step or tour is never shown.
  return active && target ? rect : null
}

type Props = {
  screen: Screen
  /** Open the tour by itself the first time this screen is shown (main screen only). */
  autoStart?: boolean
}

/**
 * The guide character 서강이. It idles in a corner and can be dragged anywhere; clicking it
 * makes it hop and opens a short tutorial for the current screen in a speech bubble, outlining
 * what each step talks about. It can be hidden (and brought back with GuideToggle).
 */
export function GuideMascot({ screen, autoStart = false }: Props) {
  const { t } = useI18n()
  const hidden = useGuideHidden()
  const view = useViewport()
  const steps = STEPS[screen] as Step<Screen>[]
  const texts = t.guide[screen] as Record<string, { title: string; text: string }>

  const [tourOpen, setTourOpen] = useState(false)
  const [index, setIndex] = useState(0)
  const [poked, setPoked] = useState(false)
  const [saved, setSaved] = useState<Point | null>(() => readPosition(screen))
  const [dragging, setDragging] = useState(false)
  const pokeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const drag = useRef<{ start: Point; origin: Point; moved: boolean } | null>(null)
  const suppressClick = useRef(false)

  // Hiding ends the tour, so showing 서강이 again does not reopen it halfway through.
  const [wasHidden, setWasHidden] = useState(hidden)
  if (hidden !== wasHidden) {
    setWasHidden(hidden)
    if (hidden) {
      setTourOpen(false)
      setPoked(false)
    }
  }

  const open = tourOpen && !hidden
  const step = steps[index]
  const rect = useTargetRect(step.target, open)
  const pose: Pose = poked ? 'joy' : open ? step.pose : 'idle'
  const isLast = index === steps.length - 1
  const point = clampPoint(saved ?? defaultPoint(screen, view), view)

  const start = useCallback(() => {
    if (pokeTimer.current) clearTimeout(pokeTimer.current)
    setPoked(true)
    setIndex(0)
    // Hop and smile first, then start talking.
    pokeTimer.current = setTimeout(() => {
      setPoked(false)
      // Hidden during the hop: do not open the tour behind the user's back.
      if (!isGuideHidden()) setTourOpen(true)
    }, 500)
  }, [])

  const close = useCallback(() => {
    if (pokeTimer.current) clearTimeout(pokeTimer.current)
    setPoked(false)
    setTourOpen(false)
  }, [])

  useEffect(() => {
    if (!autoStart || hidden || readStorage(SEEN_KEY) === '1') return
    // Mark it only once the tour really opens: an effect that is cleaned up early (unmount,
    // React's development double run) must not use up the first-run tour.
    const timer = setTimeout(() => {
      writeStorage(SEEN_KEY, '1')
      start()
    }, 800)
    return () => clearTimeout(timer)
  }, [autoStart, hidden, start])

  // Esc closes the tour only when it is pressed on the guide itself (the bubble or 서강이), never
  // when it is meant for the terminal, the remote desktop or a dialog.
  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation()
      close()
    }
  }

  useEffect(
    () => () => {
      if (pokeTimer.current) clearTimeout(pokeTimer.current)
    },
    [],
  )

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return
    // A drag that ended in pointercancel never got its click: do not swallow this one.
    suppressClick.current = false
    drag.current = { start: { x: e.clientX, y: e.clientY }, origin: point, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const dragTo = (e: ReactPointerEvent<HTMLButtonElement>): Point | null => {
    const d = drag.current
    if (!d) return null
    const dx = e.clientX - d.start.x
    const dy = e.clientY - d.start.y
    if (!d.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return null
    d.moved = true
    return clampPoint({ x: d.origin.x + dx, y: d.origin.y + dy }, view)
  }

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const next = dragTo(e)
    if (!next) return
    setDragging(true)
    setSaved(next)
  }

  const onPointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const next = dragTo(e)
    const moved = drag.current?.moved ?? false
    drag.current = null
    if (!moved) return
    // The press ended a drag: the click that follows must not open the tour.
    suppressClick.current = true
    setDragging(false)
    if (next) setSaved(next)
    writeStorage(positionKey(screen), JSON.stringify(next ?? point))
  }

  /** The browser took the pointer over (e.g. a system gesture): keep where it was dragged to. */
  const onPointerCancel = () => {
    const moved = drag.current?.moved ?? false
    drag.current = null
    if (!moved) return
    setDragging(false)
    writeStorage(positionKey(screen), JSON.stringify(point))
  }

  const onClick = (e: ReactMouseEvent) => {
    // detail is 0 for a keyboard click (Enter or Space): never the end of a drag.
    if (e.detail === 0) suppressClick.current = false
    if (suppressClick.current) {
      suppressClick.current = false
      return
    }
    if (open) close()
    else start()
  }

  if (hidden) return null

  const { title, text } = texts[step.key as string]

  return (
    <>
      {open && rect && (
        <div
          aria-hidden
          className="border-guide ring-guide/25 pointer-events-none fixed z-40 rounded-md border-2 ring-4 transition-all duration-200 motion-reduce:transition-none"
          style={{
            top: Math.max(1, rect.top - 3),
            left: Math.max(1, rect.left - 3),
            width:
              Math.min(view.width - 1, rect.left + rect.width + 3) - Math.max(1, rect.left - 3),
            height:
              Math.min(view.height - 1, rect.top + rect.height + 3) - Math.max(1, rect.top - 3),
          }}
        />
      )}

      {open && (
        <div
          role="dialog"
          aria-label={t.guide.name}
          aria-live="polite"
          onKeyDown={onKeyDown}
          className="bg-background text-foreground fixed z-50 rounded-xl border p-3 shadow-lg"
          style={{ width: BUBBLE_WIDTH, ...bubbleStyle(point, view) }}
        >
          <div className="mb-1 flex items-start justify-between gap-2">
            <p className="text-sm font-semibold">{title}</p>
            <button
              type="button"
              onClick={close}
              aria-label={t.guide.close}
              className="text-muted-foreground hover:text-foreground -mt-0.5 -mr-1 rounded p-0.5"
            >
              <X className="size-4" />
            </button>
          </div>
          <p className="text-muted-foreground text-sm leading-relaxed">{text}</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <div className="text-muted-foreground flex items-center gap-2 text-xs">
              <span className="tabular-nums">{t.guide.progress(index + 1, steps.length)}</span>
              <button
                type="button"
                onClick={() => setGuideHidden(true)}
                className="hover:text-foreground underline-offset-2 hover:underline"
              >
                {t.guide.hide}
              </button>
            </div>
            <div className="flex gap-1">
              {index > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setIndex(index - 1)}>
                  {t.guide.back}
                </Button>
              )}
              <Button size="sm" onClick={() => (isLast ? close() : setIndex(index + 1))}>
                {isLast ? t.guide.done : t.guide.next}
              </Button>
            </div>
          </div>
        </div>
      )}

      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onKeyDown={onKeyDown}
            aria-label={t.guide.hint}
            aria-expanded={open}
            className={cn(
              'focus-visible:ring-ring fixed z-50 flex touch-none items-end justify-center rounded-full outline-none focus-visible:ring-2',
              dragging ? 'cursor-grabbing' : 'cursor-grab',
            )}
            style={{ left: point.x, top: point.y, width: SIZE, height: SIZE }}
          >
            <img
              src={POSES[pose]}
              alt={t.guide.name}
              draggable={false}
              className={cn(
                'pointer-events-none max-h-full max-w-full drop-shadow-md select-none',
                dragging
                  ? 'scale-110'
                  : poked
                    ? 'motion-safe:animate-guide-hop'
                    : 'motion-safe:animate-guide-bob',
              )}
            />
          </button>
        </TooltipTrigger>
        {!open && !dragging && <TooltipContent side="top">{t.guide.hint}</TooltipContent>}
      </Tooltip>
    </>
  )
}
