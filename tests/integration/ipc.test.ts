// main's IPC handlers (src/main/ipc.ts) against the fake server, with `electron` replaced by
// tests/integration/helpers/electron.ts: the handlers are called the way the renderer's
// `ipcRenderer.invoke` would reach them.
import { pathToFileURL } from 'node:url'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannel } from '../../src/shared/ipc'
import { TEST_PASSWORD, TEST_USER, startFakeServer, type FakeServer } from '../fake-server/index.ts'
import { until } from './helpers/util'

vi.mock('electron', () => import('./helpers/electron'))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { handlers, removeUserData, sent } = await import('./helpers/electron')
const { rendererFile } = await import('../../src/main/app-page')
const { registerIpcHandlers } = await import('../../src/main/ipc')

const appFrame = { url: pathToFileURL(rendererFile).href }
const trusted = { senderFrame: appFrame, sender: { mainFrame: appFrame } }
const droppedFile = { url: pathToFileURL('/tmp/dropped.html').href }
const untrusted = { senderFrame: droppedFile, sender: { mainFrame: droppedFile } }

const call = (channel: string, ...args: unknown[]) => {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`no handler for ${channel}`)
  return Promise.resolve(handler(trusted, ...args)) as Promise<Record<string, unknown>>
}

let server: FakeServer

beforeAll(() => registerIpcHandlers())
beforeEach(async () => {
  server = await startFakeServer()
  sent.length = 0
})
afterEach(async () => {
  await call(IpcChannel.sshDisconnect)
  await server.close()
})
afterAll(() => removeUserData())

async function connect() {
  const r = await call(IpcChannel.sshConnect, {
    host: '127.0.0.1',
    port: server.ssh.port,
    username: TEST_USER,
    password: TEST_PASSWORD,
    trustFingerprint: server.ssh.fingerprint,
  })
  expect(r).toMatchObject({ ok: true })
  expect(await call(IpcChannel.displayStart, 1600, 900)).toMatchObject({ ok: true })
}

const launchScripts = () =>
  server.ssh.execs.filter((e) => e.command === 'sh -s' && e.stdin.includes('SOGANGSSH_LAUNCHER='))

describe('IPC handlers', () => {
  it('refuses a page that is not the app before contacting the server', async () => {
    const handler = handlers.get(IpcChannel.sshConnect)!
    const r = await handler(untrusted, {
      host: '127.0.0.1',
      port: server.ssh.port,
      username: TEST_USER,
      password: TEST_PASSWORD,
    })
    expect(r).toEqual({ ok: false, error: 'unknown', detail: 'Untrusted sender' })
    expect(server.ssh.authAttempts).toEqual([])
  })

  it('connects, starts the status panel and opens the terminal on the desktop', async () => {
    await connect()
    expect(sent).toContainEqual({
      channel: IpcChannel.sshStatus,
      payload: {
        state: 'connected',
        host: '127.0.0.1',
        port: server.ssh.port,
        username: TEST_USER,
      },
    })
    await until(() => sent.some((s) => s.channel === IpcChannel.serverStatus))

    expect(await call(IpcChannel.terminalOpen, 80, 24)).toEqual({ ok: true, replay: '' })
    const [shell] = server.ssh.execsMatching('$SHELL -l')
    expect(shell.command).toContain('env DISPLAY=:20 ')

    await call(IpcChannel.sshDisconnect)
    expect(sent).toContainEqual({
      channel: IpcChannel.sshStatus,
      payload: { state: 'disconnected', reason: 'user' },
    })
    expect(await call(IpcChannel.terminalOpen, 80, 24)).toEqual({
      ok: false,
      error: 'notConnected',
    })
  })

  it('gives licensed launchers the user’s license setting, a server triad too (B-023)', async () => {
    server.ssh.licenseValue = '27000@a.example,27001@b.example,27002@c.example'
    await connect()
    expect(await call(IpcChannel.launcherRun, 'sentaurus-workbench', false)).toEqual({ ok: true })
    const [run] = launchScripts()
    expect(run.stdin).toContain(
      'SNPSLMD_LICENSE_FILE="27000@a.example,27001@b.example,27002@c.example"; ' +
        'export SNPSLMD_LICENSE_FILE',
    )
    expect(run.command).toBe('sh -s')
  })

  it('does not launch a licensed program without a license setting', async () => {
    server.ssh.licenseValue = null
    await connect()
    expect(await call(IpcChannel.launcherRun, 'sentaurus-visual', false)).toEqual({
      ok: false,
      error: 'noLicense',
    })
    expect(launchScripts()).toEqual([])
  })

  // B-027: a failed read is not "not set".
  it('tells a failed license read apart from a missing setting (B-027)', async () => {
    server.ssh.onExec({ command: /^sh -s$/, stdin: "printf 'LICENSE" }, 'close')
    await connect()
    expect(await call(IpcChannel.launcherRun, 'sentaurus-visual', false)).toEqual({
      ok: false,
      error: 'licenseReadFailed',
    })
    expect(launchScripts()).toEqual([])
  })

  // B-019 / B-020 through IPC: `force` is passed only when it is exactly true.
  it('reports alreadyRunning and opens another copy only when forced', async () => {
    await connect()
    expect(await call(IpcChannel.launcherRun, 'sentaurus-visual', false)).toEqual({ ok: true })
    expect(await call(IpcChannel.launcherRun, 'sentaurus-visual', 'yes')).toEqual({
      ok: false,
      error: 'alreadyRunning',
    })
    expect(await call(IpcChannel.launcherRun, 'sentaurus-visual', true)).toEqual({ ok: true })
    expect(await call(IpcChannel.launcherRun, 'no-such-launcher', true)).toEqual({
      ok: false,
      error: 'failed',
      detail: 'Unknown launcher',
    })
  })

  // B-011: submitting the dialog twice started two passwd runs that raced each other.
  it('refuses a second password change while one runs (B-011)', async () => {
    await connect()
    const req = { current: TEST_PASSWORD, next: 'brand-new-pw-2' }
    const first = call(IpcChannel.passwordChange, req)
    const second = call(IpcChannel.passwordChange, req)
    expect(await second).toEqual({ ok: false, error: 'busy' })
    expect(await first).toEqual({ ok: true })
    expect(server.ssh.execsMatching('passwd')).toHaveLength(1)
    // Free again afterwards.
    expect(
      await call(IpcChannel.passwordChange, { current: 'brand-new-pw-2', next: TEST_PASSWORD }),
    ).toEqual({ ok: true })
  })
})
