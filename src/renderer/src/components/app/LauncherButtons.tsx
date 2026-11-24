import { useEffect, useRef, useState } from 'react'
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

  // The toast's "Open another" can be pressed while another launch is still running. Launches run
  // one after another, so the first one to finish never re-enables the buttons too early and no
  // request is dropped.
  const queue = useRef<Promise<void>>(Promise.resolve())

  const run = (launcher: LauncherInfo, force = false) => {
    queue.current = queue.current.then(() => runNow(launcher, force))
    return queue.current
  }

  const runNow = async (launcher: LauncherInfo, force: boolean) => {
    const { id, label } = launcher
    setRunning(id)
    const result = await window.api.launcher.run(id, force).catch(() => ({
      ok: false as const,
      error: 'failed' as const,
      detail: undefined,
    }))
    setRunning(null)
    if (result.ok) {
      toast.success(t.launcher.started(label))
    } else if (result.error === 'alreadyRunning') {
      // A second copy takes another license, so only on request.
      toast.info(t.launcher.errors.alreadyRunning(label), {
        action: { label: t.launcher.openAnother, onClick: () => void run(launcher, true) },
      })
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
