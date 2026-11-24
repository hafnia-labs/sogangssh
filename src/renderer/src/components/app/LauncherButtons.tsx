import { useEffect, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n/context'
import type { LauncherInfo } from '../../../../shared/ipc'

type Props = { disabled: boolean }

/** One toolbar button per launcher; each starts its program on the remote desktop. */
export function LauncherButtons({ disabled }: Props) {
  const { t } = useI18n()
  const [launchers, setLaunchers] = useState<LauncherInfo[]>([])
  const [running, setRunning] = useState<string | null>(null)

  useEffect(() => {
    void window.api.launcher.list().then(setLaunchers)
  }, [])

  const run = async ({ id, label }: LauncherInfo) => {
    setRunning(id)
    const result = await window.api.launcher.run(id)
    setRunning(null)
    if (result.ok) {
      toast.success(t.launcher.started(label))
    } else {
      toast.error(t.launcher.errors[result.error](label), { description: result.detail })
    }
  }

  return launchers.map((launcher) => (
    <Button
      key={launcher.id}
      variant="outline"
      size="sm"
      disabled={disabled || running !== null}
      onClick={() => void run(launcher)}
    >
      {running === launcher.id ? <Loader2 className="animate-spin" /> : <Play />}
      {t.toolbar.openApp(launcher.label)}
    </Button>
  ))
}
