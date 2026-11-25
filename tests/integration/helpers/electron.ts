// Stand-in for the `electron` module in integration tests. Only what main's modules touch:
// `app` (electron-store keeps its files in a temporary user-data folder), `ipcMain` (handlers are
// kept so tests can call them), one fake window that records what main sends, and the clipboard.
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** A fresh folder per test file (each file has its own module registry). */
export const userData = mkdtempSync(join(tmpdir(), 'sogangssh-test-'))

export function removeUserData(): void {
  rmSync(userData, { recursive: true, force: true })
}

type Handler = (event: unknown, ...args: unknown[]) => unknown

export const handlers = new Map<string, Handler>()
export const listeners = new Map<string, Handler>()
/** Everything main sent to the window, in order. */
export const sent: { channel: string; payload: unknown }[] = []

export const app = {
  isPackaged: true,
  getPath: () => userData,
  getVersion: () => '0.0.0-test',
  quit: () => {},
}

export const ipcMain = {
  handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  on: (channel: string, handler: Handler) => listeners.set(channel, handler),
}

const fakeWindow = {
  webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
}

export const BrowserWindow = { getAllWindows: () => [fakeWindow] }

export const clipboard = {
  readText: async () => '',
  writeText: async () => {},
}

export const shell = { openPath: async () => '' }

export default { app, ipcMain, BrowserWindow, clipboard, shell }
