// "Restart now" on the update notice (src/main/ipc.ts) against the fake server: while connected
// it goes through the exit question and installs only after the answer. electron-updater is
// mocked; each test loads main's modules afresh, since an allowed quit stays allowed.
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannel } from '../../src/shared/ipc'
import { TEST_PASSWORD, TEST_USER, startFakeServer, type FakeServer } from '../fake-server/index.ts'

vi.mock('electron', () => import('./helpers/electron'))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

/** A minimal stand-in for electron-updater's autoUpdater. */
const fake = vi.hoisted(() => {
  const listeners = new Map<string, ((arg: unknown) => void)[]>()
  return {
    listeners,
    updater: {
      logger: null as unknown,
      allowPrerelease: false,
      autoDownload: false,
      autoInstallOnAppQuit: false,
      on(name: string, fn: (arg: unknown) => void) {
        listeners.set(name, [...(listeners.get(name) ?? []), fn])
      },
      checkForUpdates: async () => null,
      quitAndInstall: vi.fn<(silent: boolean, runAfter: boolean) => void>(),
    },
  }
})
vi.mock('electron-updater', () => ({ autoUpdater: fake.updater }))

type Handler = (event: unknown, ...args: unknown[]) => unknown

const appFrame = { url: '' }
const trusted = { senderFrame: appFrame, sender: { mainFrame: appFrame } }
const droppedFile = { url: pathToFileURL('/tmp/dropped.html').href }
const untrusted = { senderFrame: droppedFile, sender: { mainFrame: droppedFile } }

let server: FakeServer
let handlers: Map<string, Handler>
let sent: { channel: string; payload: unknown }[]
let removeUserData: () => void
let quit: ReturnType<typeof vi.fn<() => void>>
const quitAndInstall = fake.updater.quitAndInstall

const call = (channel: string, ...args: unknown[]) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(handler(trusted, ...args))
}
const closeRequests = () => sent.filter((s) => s.channel === IpcChannel.appCloseRequested)

/** Fresh main modules with a downloaded update ready ("9.9.9"). */
async function load(downloaded = true) {
  vi.resetModules()
  fake.listeners.clear()
  // The module main sees (the mock), so handlers and sends land in the same place.
  const electron = (await import('electron')) as unknown as typeof import('./helpers/electron')
  ;({ handlers, sent, removeUserData } = electron)
  quit = vi.fn<() => void>()
  electron.app.quit = quit
  const { rendererFile } = await import('../../src/main/app-page')
  appFrame.url = pathToFileURL(rendererFile).href
  const ipc = await import('../../src/main/ipc')
  ipc.registerIpcHandlers()
  await ipc.updater.start()
  ipc.updater.stop()
  if (downloaded)
    for (const fn of fake.listeners.get('update-downloaded') ?? []) fn({ version: '9.9.9' })
}

beforeEach(async () => {
  quitAndInstall.mockClear()
  server = await startFakeServer()
})
afterEach(async () => {
  await call(IpcChannel.sshDisconnect)
  await server.close()
  removeUserData()
})

async function connect() {
  const r = await call(IpcChannel.sshConnect, {
    host: '127.0.0.1',
    port: server.ssh.port,
    username: TEST_USER,
    password: TEST_PASSWORD,
    trustFingerprint: server.ssh.fingerprint,
  })
  expect(r).toMatchObject({ ok: true })
  sent.length = 0
}

describe('update restart', () => {
  it('reports the version and the downloaded update to the app page only', async () => {
    await load()
    expect(await call(IpcChannel.updateGetStatus)).toEqual({
      currentVersion: '0.0.0-test',
      readyVersion: '9.9.9',
    })
    expect(await handlers.get(IpcChannel.updateGetStatus)!(untrusted)).toBeNull()
    await handlers.get(IpcChannel.updateRestart)!(untrusted)
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('does nothing before an update is downloaded', async () => {
    await load(false)
    await call(IpcChannel.updateRestart)
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()
  })

  it('restarts at once when not connected', async () => {
    await load()
    await call(IpcChannel.updateRestart)
    expect(quitAndInstall).toHaveBeenCalledWith(true, true)
    expect(quit).not.toHaveBeenCalled()
  })

  it('while connected asks first, and installs after "keep running"', async () => {
    await load()
    await connect()
    await call(IpcChannel.updateRestart)
    expect(closeRequests()).toEqual([{ channel: IpcChannel.appCloseRequested, payload: 'update' }])
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()

    expect(await call(IpcChannel.appClose, 'keep')).toEqual({ ok: true })
    expect(quitAndInstall).toHaveBeenCalledWith(true, true)
    // The desktop was not ended: no stop script ran.
    expect(server.ssh.execs.some((e) => / stop$/.test(e.command))).toBe(false)
  })

  it('installs after "end everything" once the desktop has ended', async () => {
    await load()
    await connect()
    expect(await call(IpcChannel.displayStart, 1600, 900)).toMatchObject({ ok: true })
    await call(IpcChannel.updateRestart)
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(await call(IpcChannel.appClose, 'end')).toEqual({ ok: true })
    expect(quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('cancel installs nothing and forgets the restart; a later close is a normal quit', async () => {
    await load()
    await connect()
    await call(IpcChannel.updateRestart)
    await call(IpcChannel.appClose, 'cancel')
    expect(quitAndInstall).not.toHaveBeenCalled()
    expect(quit).not.toHaveBeenCalled()

    // Closing the window later (the update then installs on quit, without starting again).
    await call(IpcChannel.appClose, 'keep')
    expect(quit).toHaveBeenCalledTimes(1)
    expect(quitAndInstall).not.toHaveBeenCalled()
  })
})
