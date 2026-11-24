import { useCallback, useState } from 'react'
import { usePanelRef } from 'react-resizable-panels'
import { DisplayPanel } from '@/components/app/DisplayPanel'
import { ServerPanel } from '@/components/app/ServerPanel'
import { StatusBar } from '@/components/app/StatusBar'
import { TerminalPanel } from '@/components/app/TerminalPanel'
import { Toolbar } from '@/components/app/Toolbar'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import type { ConnectionStatus } from '@/types'
import type { Session } from './LoginScreen'

type PanelRef = ReturnType<typeof usePanelRef>

function toggle(ref: PanelRef) {
  const panel = ref.current
  if (!panel) return
  if (panel.isCollapsed()) panel.expand()
  else panel.collapse()
}

type Props = {
  session: Session
  status: ConnectionStatus
  onDisconnect: () => void
  onBackToLogin: () => void
}

// Layout: server status (left) | TCAD display (center) | terminal (right).
export function MainScreen({ session, status, onDisconnect, onBackToLogin }: Props) {
  const serverRef = usePanelRef()
  const terminalRef = usePanelRef()
  const [serverCollapsed, setServerCollapsed] = useState(false)
  const [terminalCollapsed, setTerminalCollapsed] = useState(false)
  const [display, setDisplay] = useState<number | null>(null)
  const handleDisplay = useCallback((d: number | null) => setDisplay(d), [])
  // True after the user ended the session, until they start a new one.
  const [stopped, setStopped] = useState(false)

  const endSession = async () => {
    // Disconnect the viewer first, then stop everything on the server.
    setStopped(true)
    const result = await window.api.display.end()
    if (!result.ok) setStopped(false)
    return result
  }

  return (
    <div className="flex h-screen flex-col">
      <Toolbar
        status={status}
        serverCollapsed={serverCollapsed}
        terminalCollapsed={terminalCollapsed}
        onToggleServer={() => toggle(serverRef)}
        onToggleTerminal={() => toggle(terminalRef)}
        onDisconnect={onDisconnect}
        onEndSession={endSession}
      />
      <ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1">
        <ResizablePanel
          panelRef={serverRef}
          defaultSize="20%"
          minSize="14%"
          maxSize="35%"
          collapsible
          collapsedSize={0}
          onResize={() => setServerCollapsed(serverRef.current?.isCollapsed() ?? false)}
        >
          <ServerPanel />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel minSize="30%">
          <DisplayPanel
            status={status}
            stopped={stopped}
            onStartNew={() => setStopped(false)}
            onDisplay={handleDisplay}
            onBackToLogin={onBackToLogin}
          />
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel
          panelRef={terminalRef}
          defaultSize="28%"
          minSize="15%"
          maxSize="50%"
          collapsible
          collapsedSize={0}
          onResize={() => setTerminalCollapsed(terminalRef.current?.isCollapsed() ?? false)}
        >
          <TerminalPanel />
        </ResizablePanel>
      </ResizablePanelGroup>
      <StatusBar user={session.username} host={session.host} display={display} />
    </div>
  )
}
