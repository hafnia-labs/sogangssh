import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import {
  IpcChannel,
  type CloseChoice,
  type ConnectRequest,
  type DisplayEndResult,
  type DisplayStartResult,
  type ConnectResult,
  type LastLogin,
  type PasswordChangeRequest,
  type PasswordChangeResult,
  type LauncherInfo,
  type ServerStatus,
  type LaunchResult,
  type SshStatus,
  type TerminalExit,
  type TerminalOpenResult,
} from '../shared/ipc'

// Sandboxed preload: only `electron` can be required at runtime. Local imports such as
// ../shared/ipc are bundled into this file at build time, so keep them dependency-free.

/** Subscribe to a main → renderer channel. Returns an unsubscribe function. */
function subscribe<T>(channel: string, listener: (payload: T) => void): () => void {
  const handler = (_event: IpcRendererEvent, payload: T) => listener(payload)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api = {
  platform: process.platform,
  ssh: {
    connect: (req: ConnectRequest): Promise<ConnectResult> =>
      ipcRenderer.invoke(IpcChannel.sshConnect, req),
    disconnect: (): Promise<void> => ipcRenderer.invoke(IpcChannel.sshDisconnect),
    onStatus: (listener: (status: SshStatus) => void) =>
      subscribe<SshStatus>(IpcChannel.sshStatus, listener),
  },
  password: {
    /** Change the server account password (current and new are sent to `passwd` only). */
    change: (req: PasswordChangeRequest): Promise<PasswordChangeResult> =>
      ipcRenderer.invoke(IpcChannel.passwordChange, req),
  },
  settings: {
    getLastLogin: (): Promise<LastLogin | null> =>
      ipcRenderer.invoke(IpcChannel.settingsGetLastLogin),
  },
  terminal: {
    open: (cols: number, rows: number): Promise<TerminalOpenResult> =>
      ipcRenderer.invoke(IpcChannel.terminalOpen, cols, rows),
    input: (data: string): void => ipcRenderer.send(IpcChannel.terminalInput, data),
    resize: (cols: number, rows: number): void =>
      ipcRenderer.send(IpcChannel.terminalResize, cols, rows),
    onData: (listener: (data: string) => void) =>
      subscribe<string>(IpcChannel.terminalData, listener),
    onExit: (listener: (exit: TerminalExit) => void) =>
      subscribe<TerminalExit>(IpcChannel.terminalExit, listener),
  },
  display: {
    start: (width: number, height: number): Promise<DisplayStartResult> =>
      ipcRenderer.invoke(IpcChannel.displayStart, width, height),
    end: (): Promise<DisplayEndResult> => ipcRenderer.invoke(IpcChannel.displayEnd),
  },
  server: {
    getStatus: (): Promise<ServerStatus | null> => ipcRenderer.invoke(IpcChannel.serverGetStatus),
    onStatus: (listener: (status: ServerStatus) => void) =>
      subscribe<ServerStatus>(IpcChannel.serverStatus, listener),
  },
  launcher: {
    list: (): Promise<LauncherInfo[]> => ipcRenderer.invoke(IpcChannel.launcherList),
    /** `force` starts another copy even if one is already running. */
    run: (id: string, force = false): Promise<LaunchResult> =>
      ipcRenderer.invoke(IpcChannel.launcherRun, id, force),
  },
  app: {
    /** Main asks the renderer whether to keep or end the remote desktop before closing. */
    onCloseRequested: (listener: () => void) =>
      subscribe<void>(IpcChannel.appCloseRequested, listener),
    close: (choice: CloseChoice): Promise<DisplayEndResult> =>
      ipcRenderer.invoke(IpcChannel.appClose, choice),
  },
}

export type Api = typeof api

contextBridge.exposeInMainWorld('api', api)
