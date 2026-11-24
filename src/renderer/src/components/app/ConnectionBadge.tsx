import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n/context'
import { cn } from '@/lib/utils'
import type { ConnectionStatus } from '@/types'

const dotColors: Record<ConnectionStatus, string> = {
  connected: 'bg-emerald-500',
  reconnecting: 'bg-amber-500 animate-pulse',
  disconnected: 'bg-red-500',
}

export function ConnectionBadge({ status }: { status: ConnectionStatus }) {
  const { t } = useI18n()

  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn('size-2 rounded-full', dotColors[status])} />
      {t.connection[status]}
    </Badge>
  )
}
