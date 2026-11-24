import type { ReactNode } from 'react'
import {
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n/context'
import type { ConnectionStatus } from '@/types'
import type { DisplayEndResult } from '../../../../shared/ipc'
import { BrandName } from './BrandName'
import { ChangePasswordButton } from './ChangePasswordButton'
import { ConnectionBadge } from './ConnectionBadge'
import { EndSessionButton } from './EndSessionButton'
import { LanguageToggle } from './LanguageToggle'
import { LauncherButtons } from './LauncherButtons'

type Props = {
  status: ConnectionStatus
  serverCollapsed: boolean
  terminalCollapsed: boolean
  onToggleServer: () => void
  onToggleTerminal: () => void
  onDisconnect: () => void
  onEndSession: () => Promise<DisplayEndResult>
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={label}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  )
}

export function Toolbar({
  status,
  serverCollapsed,
  terminalCollapsed,
  onToggleServer,
  onToggleTerminal,
  onDisconnect,
  onEndSession,
}: Props) {
  const { t } = useI18n()

  return (
    <header className="bg-background flex h-11 shrink-0 items-center gap-2 border-b px-3">
      <IconButton
        label={serverCollapsed ? t.toolbar.showServer : t.toolbar.hideServer}
        onClick={onToggleServer}
      >
        {serverCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
      </IconButton>
      <BrandName className="mr-1" />
      <Separator orientation="vertical" className="mx-1 h-5!" />
      <LauncherButtons disabled={status !== 'connected'} />

      <div className="ml-auto flex items-center gap-1">
        <ConnectionBadge status={status} />
        <LanguageToggle />
        <ChangePasswordButton disabled={status !== 'connected'} />
        <EndSessionButton disabled={status !== 'connected'} onEnd={onEndSession} />
        <IconButton label={t.toolbar.disconnect} onClick={onDisconnect}>
          <LogOut />
        </IconButton>
        <IconButton
          label={terminalCollapsed ? t.toolbar.showTerminal : t.toolbar.hideTerminal}
          onClick={onToggleTerminal}
        >
          {terminalCollapsed ? <PanelRightOpen /> : <PanelRightClose />}
        </IconButton>
      </div>
    </header>
  )
}
