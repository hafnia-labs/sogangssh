import { useEffect, useState, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import type { ServerStatus, ServerUser } from '../../../../shared/ipc'

// Long user lists are cut here (me and the busiest come first).
const MAX_USERS = 12

const pct = (used: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0

/** kB → "2.5 GB" (no decimals from 100 GB up). */
function gb(kb: number) {
  const value = kb / 1024 / 1024
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} GB`
}

// Warn at 80%, critical at 95%, so a nearly full quota or license pool stands out.
function levelClass(percent: number) {
  if (percent >= 95) return '[&_[data-slot=progress-indicator]]:bg-red-500'
  if (percent >= 80) return '[&_[data-slot=progress-indicator]]:bg-amber-500'
  return ''
}

function Section({
  title,
  aside,
  children,
}: {
  title: string
  aside?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="grid gap-2 border-b px-3 py-3 last:border-b-0">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-muted-foreground text-xs font-medium">{title}</h3>
        {aside && <span className="text-muted-foreground text-xs tabular-nums">{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Meter({
  label,
  used,
  total,
  detail,
}: {
  label?: string
  used: number
  total: number
  detail: string
}) {
  const percent = pct(used, total)
  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2 text-sm tabular-nums">
        {label ? <span className="font-mono text-xs">{label}</span> : <span>{percent}%</span>}
        <span className="text-muted-foreground text-xs">{detail}</span>
      </div>
      <Progress value={percent} className={cn('h-1.5', levelClass(percent))} />
    </div>
  )
}

/** Latest status pushed from main (refreshed every 10 s while connected). */
function useServerStatus() {
  const [status, setStatus] = useState<ServerStatus | null>(null)
  useEffect(() => {
    let active = true
    void window.api.server.getStatus().then((s) => {
      if (active && s) setStatus((current) => current ?? s)
    })
    const off = window.api.server.onStatus(setStatus)
    return () => {
      active = false
      off()
    }
  }, [])
  return status
}

/** Seconds since `since`, re-rendered every second. */
function useSecondsSince(since: number | undefined) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])
  return since === undefined ? 0 : Math.max(0, Math.round((now - since) / 1000))
}

function UserRow({ user }: { user: ServerUser }) {
  const { t } = useI18n()
  const busy = (user.cores ?? 0) >= 0.1
  const active = busy || user.idle === '.'
  let detail: string
  if (busy) detail = t.server.cores(user.cores ?? 0)
  else if (user.sessions === 0) detail = t.server.noSession
  else if (user.idle === '.') detail = t.server.active
  else if (user.idle === 'old') detail = t.server.idleOld
  else detail = t.server.idle(user.idle ?? '')

  return (
    <li className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          'size-1.5 shrink-0 rounded-full',
          active ? 'bg-emerald-500' : 'bg-muted-foreground/40',
        )}
      />
      <span className="truncate font-mono text-xs">{user.name}</span>
      {user.isMe && (
        <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
          {t.server.you}
        </Badge>
      )}
      <span className="text-muted-foreground ml-auto shrink-0 text-xs tabular-nums">{detail}</span>
    </li>
  )
}

export function ServerPanel() {
  const { t } = useI18n()
  const s = useServerStatus()
  const secondsAgo = useSecondsSince(s?.updatedAt)

  if (!s) {
    return (
      <aside className="bg-background flex h-full flex-col" data-tour="server">
        <div className="flex h-9 shrink-0 items-center border-b px-3">
          <span className="text-sm font-semibold">{t.server.title}</span>
        </div>
        <div className="text-muted-foreground flex flex-1 items-center justify-center gap-2 text-xs">
          <Loader2 className="size-4 animate-spin" />
          {t.server.loading}
        </div>
      </aside>
    )
  }

  const [l1, l5, l15] = s.load
  const loadPercent = pct(l1, s.cores)
  const memUsed = s.memory.totalKb - s.memory.availableKb

  return (
    <aside className="bg-background flex h-full flex-col" data-tour="server">
      <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b px-3">
        <span className="text-sm font-semibold">{t.server.title}</span>
        <span className="text-muted-foreground truncate text-xs">
          {s.host} · {t.server.uptime(Math.floor(s.uptimeSeconds / 86400))}
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Section title={t.server.cpu} aside={`${loadPercent}%`}>
          <Progress value={loadPercent} className={cn('h-1.5', levelClass(loadPercent))} />
          <p className="text-muted-foreground text-xs tabular-nums">
            {t.server.cpuDetail(l1, l5, l15, s.cores)}
          </p>
        </Section>

        <Section title={t.server.memory}>
          <Meter
            used={memUsed}
            total={s.memory.totalKb}
            detail={t.server.usedOf(gb(memUsed), gb(s.memory.totalKb))}
          />
        </Section>

        {s.disk && (
          <Section title={s.disk.kind === 'quota' ? t.server.quota : t.server.homeDisk}>
            <Meter
              used={s.disk.usedKb}
              total={s.disk.limitKb}
              detail={t.server.usedOf(gb(s.disk.usedKb), gb(s.disk.limitKb))}
            />
          </Section>
        )}

        <Section title={t.server.licenses}>
          {s.licenses === null ? (
            <p className="text-muted-foreground flex items-center gap-2 text-xs">
              <Loader2 className="size-3 animate-spin" />
              {t.server.licenseLoading}
            </p>
          ) : s.licenses.length === 0 ? (
            <p className="text-muted-foreground text-xs">
              {t.server.licenseUnavailable}
              {s.licenseError && <span className="block font-mono">{s.licenseError}</span>}
            </p>
          ) : (
            <>
              {s.licenses.map((l) => (
                <Meter
                  key={l.feature}
                  label={l.feature}
                  used={l.used}
                  total={l.total}
                  detail={l.used >= l.total ? t.server.licenseFull : `${l.used} / ${l.total}`}
                />
              ))}
              <p className="text-muted-foreground text-[11px]">{t.server.licenseNote}</p>
            </>
          )}
        </Section>

        <Section title={t.server.users} aside={t.server.usersCount(s.users.length)}>
          <ul className="grid gap-1.5">
            {s.users.slice(0, MAX_USERS).map((u) => (
              <UserRow key={u.name} user={u} />
            ))}
          </ul>
          {s.users.length > MAX_USERS && (
            <p className="text-muted-foreground text-xs">
              {t.server.moreUsers(s.users.length - MAX_USERS)}
            </p>
          )}
        </Section>

        <Section title={t.server.processes}>
          {s.processes.length === 0 && (
            <p className="text-muted-foreground text-xs">{t.server.noProcesses}</p>
          )}
          <table className="w-full text-xs tabular-nums">
            <tbody>
              {s.processes.map((p) => (
                <tr key={p.pid}>
                  <td className="py-0.5 font-mono">{p.name}</td>
                  <td className="text-muted-foreground py-0.5 text-right">
                    {p.cores === null ? '–' : `${Math.round(p.cores * 100)}%`}
                  </td>
                  <td className="text-muted-foreground py-0.5 text-right">
                    {Math.round(p.rssKb / 1024)} MB
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      </div>

      <div className="text-muted-foreground shrink-0 border-t px-3 py-1.5 text-[11px]">
        {t.server.updated(secondsAgo)}
      </div>
    </aside>
  )
}
