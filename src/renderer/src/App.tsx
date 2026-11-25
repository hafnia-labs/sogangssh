import { useEffect, useState } from 'react'
import { ExitDialog } from '@/components/app/ExitDialog'
import { UpdateNotice } from '@/components/app/UpdateNotice'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { I18nProvider } from '@/i18n/I18nProvider'
import { LoginScreen, type Session } from '@/screens/LoginScreen'
import { MainScreen } from '@/screens/MainScreen'
import type { ConnectionStatus } from '@/types'

function App() {
  const [session, setSession] = useState<Session | null>(null)
  const [status, setStatus] = useState<ConnectionStatus>('connected')

  // Follow the real SSH connection state pushed from the main process.
  useEffect(
    () =>
      window.api.ssh.onStatus((s) => {
        if (s.state === 'connected') setStatus('connected')
        else if (s.reason === 'user') setSession(null)
        else setStatus('disconnected')
      }),
    [],
  )

  return (
    <I18nProvider>
      <TooltipProvider>
        {session ? (
          <MainScreen
            session={session}
            status={status}
            onDisconnect={() => void window.api.ssh.disconnect()}
            onBackToLogin={() => setSession(null)}
          />
        ) : (
          <LoginScreen
            onLogin={(s) => {
              setStatus('connected')
              setSession(s)
            }}
          />
        )}
        <ExitDialog />
        <UpdateNotice />
        <Toaster position="bottom-center" richColors />
      </TooltipProvider>
    </I18nProvider>
  )
}

export default App
