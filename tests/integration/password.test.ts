import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { changePassword } from '../../src/main/ssh/password'
import { TEST_PASSWORD, TEST_USER, startFakeServer, type FakeServer } from '../fake-server/index.ts'
import { removeUserData } from './helpers/electron'
import { connected, until } from './helpers/util'

vi.mock('electron', () => import('./helpers/electron'))

const NEW = 'brand-new-pw-2'

let server: FakeServer
const cleanup: (() => void)[] = []

beforeEach(async () => {
  server = await startFakeServer()
})
afterEach(async () => {
  vi.useRealTimers()
  cleanup.splice(0).forEach((f) => f())
  await server.close()
})
afterAll(() => removeUserData())

async function setup() {
  const c = await connected(server)
  cleanup.push(() => c.conn.disconnect())
  return c
}

const account = () => server.ssh.accounts[TEST_USER]

describe('password change over a PTY', () => {
  // B-010: passwd prompts follow the server's locale.
  it('runs passwd in the C locale and answers its prompts (B-010)', async () => {
    const { client } = await setup()
    expect(await changePassword(client, { current: TEST_PASSWORD, next: NEW })).toEqual({
      ok: true,
    })
    const [run] = server.ssh.execsMatching('passwd')
    expect(run.command).toBe('env LC_ALL=C passwd')
    expect(run.pty).toBe(true)
    expect(run.env).toEqual({ LC_ALL: 'C', LANG: 'C' })
    expect(server.ssh.passwdAnswers.map((a) => a.step)).toEqual(['current', 'new', 'retype'])
    expect(account().password).toBe(NEW)
  })

  it('reports a wrong current password', async () => {
    const { client } = await setup()
    expect(await changePassword(client, { current: 'not-my-password', next: NEW })).toEqual({
      ok: false,
      error: 'wrongPassword',
    })
    expect(account().password).toBe(TEST_PASSWORD)
  })

  it('stops with Ctrl+C after a BAD PASSWORD line instead of retrying', async () => {
    const { client } = await setup()
    expect(await changePassword(client, { current: TEST_PASSWORD, next: 'Ab1!x' })).toEqual({
      ok: false,
      error: 'rejected',
      detail: 'BAD PASSWORD: The password is shorter than 8 characters',
    })
    // Sent once; the second "New password:" got Ctrl+C, which ended passwd.
    expect(server.ssh.passwdAnswers.filter((a) => a.step === 'new')).toHaveLength(1)
    await until(() => server.ssh.execsMatching('passwd')[0].closed)
    expect(account().password).toBe(TEST_PASSWORD)
  })

  it('times out when passwd never prompts, and closes the channel', async () => {
    account().passwdHang = 'start'
    const { client } = await setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const change = changePassword(client, { current: TEST_PASSWORD, next: NEW })
    await until(() => server.ssh.execsMatching('passwd').length === 1)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await change).toEqual({ ok: false, error: 'timeout' })
    vi.useRealTimers()
    await until(() => server.ssh.execsMatching('passwd')[0].closed)
    expect(server.ssh.passwdAnswers).toEqual([])
  })

  // B-012: a change cut off after the confirmation may have been saved already.
  it('says a change cut off after the confirmation may have gone through (B-012)', async () => {
    account().passwdHang = 'afterRetype'
    const { client } = await setup()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const change = changePassword(client, { current: TEST_PASSWORD, next: NEW })
    await until(() => server.ssh.passwdAnswers.length === 3)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await change).toEqual({ ok: false, error: 'maybeChanged' })
    expect(account().password).toBe(NEW)
  })

  // B-013: ssh2 throws from exec on a dead connection; that showed an Electron error.
  it('reports notConnected on a dropped connection (B-013)', async () => {
    const { client, statuses } = await setup()
    server.ssh.dropConnections()
    await until(() => statuses.some((s) => s.state === 'disconnected'))
    expect(await changePassword(client, { current: TEST_PASSWORD, next: NEW })).toEqual({
      ok: false,
      error: 'notConnected',
    })
  })
})
