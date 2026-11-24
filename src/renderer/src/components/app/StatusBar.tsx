import { useI18n } from '@/i18n/context'
import { mockSession } from '@/mocks/session'

type Props = { user: string; host: string; display: number | null }

export function StatusBar({ user, host, display }: Props) {
  const { t } = useI18n()

  return (
    <footer className="bg-muted/50 text-muted-foreground flex h-6 shrink-0 items-center gap-4 border-t px-3 text-xs tabular-nums">
      <span>
        {user}@{host}
      </span>
      {/* Latency is still mock data; measured from SSH keepalives in a later stage. */}
      <span>{t.statusBar.latency(mockSession.latencyMs)}</span>
      {display !== null && <span className="ml-auto">{t.statusBar.display(display)}</span>}
    </footer>
  )
}
