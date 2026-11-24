import { app, BrowserWindow, ipcMain, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import {
  IpcChannel,
  type DisplayEndResult,
  type DisplayStartResult,
  type LaunchResult,
  type LauncherInfo,
  type PasswordChangeResult,
  type ServerStatus,
  type SshStatus,
  type TerminalOpenResult,
} from '../shared/ipc'
import { isAppPage } from './app-page'
import { launchers } from './launchers'
import { RemoteDisplay } from './remote/display'
import { launch } from './remote/launch'
import { ServerMonitor } from './remote/server-monitor'
import { settings } from './settings'
import { SshConnection } from './ssh/connection'
import { changePassword, isValidPasswordRequest } from './ssh/password'
import { RemoteShell } from './ssh/shell'

function send(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload)
  }
}

// Only accept IPC from the main frame of the app's own page (the exact bundled index.html, or
// the dev server). Other file:// pages and subframes are rejected.
function isTrustedSender(event: IpcMainInvokeEvent | IpcMainEvent): boolean {
  const frame = event.senderFrame
  if (!frame || frame !== event.sender.mainFrame) return false
  return isAppPage(frame.url)
}

const shell = new RemoteShell({
  onData: (data) => send(IpcChannel.terminalData, data),
  onExit: (exit) => send(IpcChannel.terminalExit, exit),
})

const display = new RemoteDisplay()

const monitor = new ServerMonitor(launchers, (status) => send(IpcChannel.serverStatus, status))

export const ssh = new SshConnection((status: SshStatus) => {
  // A dropped connection takes its channels with it. The remote desktop keeps running on the
  // server (an unexpected disconnect counts as "keep running").
  if (status.state === 'disconnected') {
    shell.reset()
    display.detach()
    monitor.stop()
  } else {
    const client = ssh.activeClient
    if (client) monitor.start(client)
  }
  send(IpcChannel.sshStatus, status)
})

let quitAllowed = false

/**
 * Called when a window closes or the app quits. While connected, the user first chooses
 * whether to keep the remote desktop running or end it, so this cancels the close and asks
 * the renderer. Returns true if the close must be prevented.
 */
export function askBeforeQuit(): boolean {
  // With no window left there is nobody to ask: treat it as "keep running".
  if (quitAllowed || !ssh.isConnected || BrowserWindow.getAllWindows().length === 0) return false
  send(IpcChannel.appCloseRequested, undefined)
  return true
}

async function closeApp(choice: unknown): Promise<DisplayEndResult> {
  if (choice !== 'keep' && choice !== 'end') return { ok: true }
  if (choice === 'end') {
    const client = ssh.activeClient
    if (!client) return { ok: false, error: 'notConnected' }
    const result = await display.end(client)
    if (!result.ok) return result
  }
  quitAllowed = true
  ssh.disconnect()
  app.quit()
  return { ok: true }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.sshConnect, async (event, req: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'unknown', detail: 'Untrusted sender' }
    const result = await ssh.connect(req)
    if (result.ok) {
      settings.setLastLogin({ host: result.host, port: result.port, username: result.username })
    }
    return result
  })

  ipcMain.handle(IpcChannel.sshDisconnect, (event) => {
    if (!isTrustedSender(event)) return
    ssh.disconnect()
  })

  ipcMain.handle(IpcChannel.settingsGetLastLogin, (event) => {
    if (!isTrustedSender(event)) return null
    return settings.getLastLogin()
  })

  ipcMain.handle(
    IpcChannel.terminalOpen,
    async (event, cols: unknown, rows: unknown): Promise<TerminalOpenResult> => {
      if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
      const client = ssh.activeClient
      if (!client) return { ok: false, error: 'notConnected' }
      // A new shell gets the desktop's DISPLAY; an open one is only redrawn.
      const env = shell.isOpen ? null : await display.waitForEnvironment()
      // The wait can take a while: the connection may have dropped (or been replaced) meanwhile.
      if (ssh.activeClient !== client) return { ok: false, error: 'notConnected' }
      return shell.open(client, cols, rows, env)
    },
  )

  ipcMain.handle(
    IpcChannel.displayStart,
    (event, width: unknown, height: unknown): Promise<DisplayStartResult> | DisplayStartResult => {
      if (!isTrustedSender(event))
        return { ok: false, error: 'startFailed', detail: 'Untrusted sender' }
      const client = ssh.activeClient
      if (!client) return { ok: false, error: 'notConnected' }
      return display.attach(client, width, height)
    },
  )

  ipcMain.handle(IpcChannel.displayEnd, (event): Promise<DisplayEndResult> | DisplayEndResult => {
    if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
    const client = ssh.activeClient
    if (!client) return { ok: false, error: 'notConnected' }
    return display.end(client)
  })

  ipcMain.handle(IpcChannel.serverGetStatus, (event): ServerStatus | null => {
    if (!isTrustedSender(event)) return null
    return monitor.status
  })

  ipcMain.handle(IpcChannel.launcherList, (event): LauncherInfo[] => {
    if (!isTrustedSender(event)) return []
    return launchers.map(({ id, label }) => ({ id, label }))
  })

  ipcMain.handle(IpcChannel.launcherRun, async (event, id: unknown): Promise<LaunchResult> => {
    if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
    const launcher = launchers.find((l) => l.id === id)
    if (!launcher) return { ok: false, error: 'failed', detail: 'Unknown launcher' }
    const client = ssh.activeClient
    if (!client) return { ok: false, error: 'notConnected' }
    const env = await display.waitForEnvironment()
    if (ssh.activeClient !== client) return { ok: false, error: 'notConnected' }
    if (!env) return { ok: false, error: 'noDisplay' }
    return launch(client, launcher, env)
  })

  let changingPassword = false

  ipcMain.handle(
    IpcChannel.passwordChange,
    async (event, req: unknown): Promise<PasswordChangeResult> => {
      if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
      if (!isValidPasswordRequest(req)) return { ok: false, error: 'invalidInput' }
      const client = ssh.activeClient
      if (!client) return { ok: false, error: 'notConnected' }
      // One passwd at a time: a second dialog submit must not race the first.
      if (changingPassword) return { ok: false, error: 'failed', detail: 'busy' }
      changingPassword = true
      try {
        return await changePassword(client, req)
      } finally {
        changingPassword = false
      }
    },
  )

  ipcMain.handle(IpcChannel.appClose, (event, choice: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
    return closeApp(choice)
  })

  // Keystrokes and resizes are fire-and-forget to keep typing latency low.
  ipcMain.on(IpcChannel.terminalInput, (event, data: unknown) => {
    if (isTrustedSender(event)) shell.write(data)
  })

  ipcMain.on(IpcChannel.terminalResize, (event, cols: unknown, rows: unknown) => {
    if (isTrustedSender(event)) shell.resize(cols, rows)
  })
}
