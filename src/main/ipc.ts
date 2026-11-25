import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  type IpcMainEvent,
  type IpcMainInvokeEvent,
} from 'electron'
import {
  IpcChannel,
  MAX_CLIPBOARD_TEXT,
  type CloseReason,
  type DisplayEndResult,
  type DisplayStartResult,
  type LaunchResult,
  type LauncherInfo,
  type PasswordChangeResult,
  type ServerStatus,
  type SshStatus,
  type TerminalOpenResult,
  type UpdateStatus,
} from '../shared/ipc'
import { isAppPage } from './app-page'
import { launchers } from './launchers'
import { RemoteDisplay } from './remote/display'
import { launch } from './remote/launch'
import { LicenseSetting } from './remote/license-setting'
import { ServerMonitor } from './remote/server-monitor'
import { SshConnection } from './ssh/connection'
import { changePassword, isValidPasswordRequest } from './ssh/password'
import { RemoteShell } from './ssh/shell'
import { Updater } from './updater'

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

// The user's license servers, read from their ~/.bash_profile and kept for this connection only.
const license = new LicenseSetting()

const monitor = new ServerMonitor(
  launchers,
  (client) => license.get(client),
  (status) => send(IpcChannel.serverStatus, status),
)

export const ssh = new SshConnection((status: SshStatus) => {
  // A dropped connection takes its channels with it. The remote desktop keeps running on the
  // server (an unexpected disconnect counts as "keep running").
  if (status.state === 'disconnected') {
    shell.reset()
    display.detach()
    monitor.stop()
    license.forget()
  } else {
    const client = ssh.activeClient
    if (client) monitor.start(client)
  }
  send(IpcChannel.sshStatus, status)
})

/** Installed app only: downloads new releases in the background (see DESIGN.md "Updates"). */
export const updater = new Updater({
  onStatus: (status: UpdateStatus) => send(IpcChannel.updateStatus, status),
})

let quitAllowed = false
/** The user asked to restart for an update; the quit installs it and starts the new version. */
let restartingForUpdate = false

/**
 * Called when a window closes or the app quits. While connected, the user first chooses
 * whether to keep the remote desktop running or end it, so this cancels the close and asks
 * the renderer. Returns true if the close must be prevented.
 */
export function askBeforeQuit(reason: CloseReason = 'quit'): boolean {
  // With no window left there is nobody to ask: treat it as "keep running".
  if (quitAllowed || !ssh.isConnected || BrowserWindow.getAllWindows().length === 0) return false
  send(IpcChannel.appCloseRequested, reason)
  return true
}

/** Quit once allowed: install the update and start again if that is why the app quits. */
function finishQuit(): void {
  quitAllowed = true
  if (restartingForUpdate && updater.installNow()) return
  app.quit()
}

/**
 * "Restart now" on the update notice. Never quits on its own while connected: the same exit
 * question as closing the window comes first, and the restart happens after its answer.
 */
function restartForUpdate(): void {
  if (!updater.isReady) return
  restartingForUpdate = true
  if (askBeforeQuit('update')) return
  ssh.disconnect()
  finishQuit()
}

async function closeApp(choice: unknown): Promise<DisplayEndResult> {
  if (choice !== 'keep' && choice !== 'end') {
    // Staying in the app also drops a pending update restart (the update still installs on quit).
    restartingForUpdate = false
    return { ok: true }
  }
  if (choice === 'end') {
    const client = ssh.activeClient
    if (!client) return { ok: false, error: 'notConnected' }
    const result = await display.end(client)
    if (!result.ok) return result
  }
  quitAllowed = true
  ssh.disconnect()
  finishQuit()
  return { ok: true }
}

export function registerIpcHandlers(): void {
  ipcMain.handle(IpcChannel.sshConnect, async (event, req: unknown) => {
    if (!isTrustedSender(event)) return { ok: false, error: 'unknown', detail: 'Untrusted sender' }
    // Nothing about the login is saved: the server, port and ID are typed every time.
    return ssh.connect(req)
  })

  ipcMain.handle(
    IpcChannel.sshChangeExpiredPassword,
    (event, req: unknown): Promise<PasswordChangeResult> | PasswordChangeResult => {
      if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
      return ssh.changeExpiredPassword(req)
    },
  )

  ipcMain.handle(IpcChannel.sshDisconnect, (event) => {
    if (!isTrustedSender(event)) return
    ssh.disconnect()
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

  ipcMain.handle(
    IpcChannel.launcherRun,
    async (event, id: unknown, force: unknown): Promise<LaunchResult> => {
      if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
      const launcher = launchers.find((l) => l.id === id)
      if (!launcher) return { ok: false, error: 'failed', detail: 'Unknown launcher' }
      const client = ssh.activeClient
      if (!client) return { ok: false, error: 'notConnected' }
      const env = await display.waitForEnvironment()
      if (ssh.activeClient !== client) return { ok: false, error: 'notConnected' }
      if (!env) return { ok: false, error: 'noDisplay' }
      // Licensed programs get the user's own license servers; without them they cannot start.
      let run = launcher
      if (launcher.licenseFeatures?.length) {
        const setting = await license.get(client)
        if (ssh.activeClient !== client) return { ok: false, error: 'notConnected' }
        // "Not set" points the user at their profile; a failed read is worth just trying again.
        if (!setting.ok)
          return {
            ok: false,
            error: setting.reason === 'notSet' ? 'noLicense' : 'licenseReadFailed',
          }
        run = { ...launcher, env: { ...launcher.env, SNPSLMD_LICENSE_FILE: setting.value } }
      }
      return launch(client, run, env, force === true)
    },
  )

  let changingPassword = false

  ipcMain.handle(
    IpcChannel.passwordChange,
    async (event, req: unknown): Promise<PasswordChangeResult> => {
      if (!isTrustedSender(event)) return { ok: false, error: 'failed', detail: 'Untrusted sender' }
      if (!isValidPasswordRequest(req)) return { ok: false, error: 'invalidInput' }
      const client = ssh.activeClient
      if (!client) return { ok: false, error: 'notConnected' }
      // One passwd at a time: a second dialog submit must not race the first.
      if (changingPassword) return { ok: false, error: 'busy' }
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

  ipcMain.handle(IpcChannel.updateGetStatus, (event): UpdateStatus | null => {
    if (!isTrustedSender(event)) return null
    return updater.status
  })

  ipcMain.handle(IpcChannel.updateRestart, (event) => {
    if (!isTrustedSender(event)) return
    restartForUpdate()
  })

  // Keystrokes and resizes are fire-and-forget to keep typing latency low.
  ipcMain.on(IpcChannel.terminalInput, (event, data: unknown) => {
    if (isTrustedSender(event)) shell.write(data)
  })

  ipcMain.on(IpcChannel.terminalResize, (event, cols: unknown, rows: unknown) => {
    if (isTrustedSender(event)) shell.resize(cols, rows)
  })

  // The PC clipboard is read only when the user pastes on the remote desktop. Text over the
  // limit is not sent at all (null), so a huge clipboard never crosses IPC. (Electron's clipboard
  // API is asynchronous.)
  ipcMain.handle(IpcChannel.clipboardReadText, async (event): Promise<string | null> => {
    if (!isTrustedSender(event)) return ''
    try {
      const text = await clipboard.readText()
      return text.length > MAX_CLIPBOARD_TEXT ? null : text
    } catch {
      return ''
    }
  })

  // Text copied on the remote desktop.
  ipcMain.on(IpcChannel.clipboardWriteText, (event, text: unknown) => {
    if (!isTrustedSender(event)) return
    if (typeof text === 'string' && text.length > 0 && text.length <= MAX_CLIPBOARD_TEXT) {
      clipboard.writeText(text).catch(() => {})
    }
  })
}
