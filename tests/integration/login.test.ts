import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TEST_PASSWORD, TEST_USER, startFakeServer, type FakeServer } from '../fake-server/index.ts'
import { login, sleep, until } from './helpers/util'

vi.mock('electron', () => import('./helpers/electron'))
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { knownHosts } = await import('../../src/main/ssh/known-hosts')
const { removeUserData, userData } = await import('./helpers/electron')

let server: FakeServer
const logins: { disconnect: () => void }[] = []

beforeEach(async () => {
  server = await startFakeServer()
})
afterEach(async () => {
  logins.splice(0).forEach((c) => c.disconnect())
  await server.close()
})
afterAll(() => removeUserData())

describe('host keys (trust on first use)', () => {
  it('asks about an unknown key, then logs in once it is trusted', async () => {
    const first = await login(server, { trust: false })
    logins.push(first.conn)
    expect(first.result).toEqual({
      ok: false,
      error: 'hostKeyUnknown',
      fingerprint: server.ssh.fingerprint,
    })
    // Blocked before any password was sent.
    expect(server.ssh.authAttempts).toEqual([])

    const second = await login(server)
    logins.push(second.conn)
    expect(second.result).toEqual({
      ok: true,
      host: '127.0.0.1',
      port: server.ssh.port,
      username: TEST_USER,
    })
    expect(second.statuses).toEqual([
      { state: 'connected', host: '127.0.0.1', port: server.ssh.port, username: TEST_USER },
    ])
    expect(knownHosts.get('127.0.0.1', server.ssh.port)).toBe(server.ssh.fingerprint)
    // Stored in the temporary user-data folder, never the user's own.
    expect(userData).toMatch(/sogangssh-test-/)

    // The saved key is used from now on without asking.
    second.conn.disconnect()
    const third = await login(server, { trust: false })
    logins.push(third.conn)
    expect(third.result).toMatchObject({ ok: true })
  })

  it('blocks a changed key', async () => {
    const saved = 'SHA256:someOtherKeyThatWasSavedBefore'
    knownHosts.set('127.0.0.1', server.ssh.port, saved)
    const r = await login(server)
    logins.push(r.conn)
    expect(r.result).toEqual({
      ok: false,
      error: 'hostKeyChanged',
      fingerprint: server.ssh.fingerprint,
      savedFingerprint: saved,
    })
    expect(server.ssh.authAttempts).toEqual([])
    // Trusting the new fingerprint in the request does not replace a saved key.
    expect(knownHosts.get('127.0.0.1', server.ssh.port)).toBe(saved)
  })

  it('saves a trusted key only after the login succeeds', async () => {
    const bad = await login(server, { password: 'wrong-password' })
    logins.push(bad.conn)
    expect(bad.result).toMatchObject({ ok: false, error: 'authFailed' })
    expect(knownHosts.get('127.0.0.1', server.ssh.port)).toBeUndefined()

    const good = await login(server)
    logins.push(good.conn)
    expect(good.result).toMatchObject({ ok: true })
    expect(knownHosts.get('127.0.0.1', server.ssh.port)).toBe(server.ssh.fingerprint)
  })
})

describe('login', () => {
  it('reports a wrong password as authFailed', async () => {
    const r = await login(server, { password: 'wrong-password' })
    logins.push(r.conn)
    expect(r.result).toMatchObject({ ok: false, error: 'authFailed' })
    expect(r.conn.isConnected).toBe(false)
  })

  it('reports an OTP prompt as otpRequired and never answers it', async () => {
    server.ssh.accounts[TEST_USER] = {
      password: TEST_PASSWORD,
      keyboardOnly: true,
      extraPrompts: ['Verification code: '],
    }
    const r = await login(server)
    logins.push(r.conn)
    expect(r.result).toMatchObject({ ok: false, error: 'otpRequired' })
    expect(server.ssh.keyboardAnswers).toEqual([
      { prompt: 'Password: ', answer: TEST_PASSWORD },
      { prompt: 'Verification code: ', answer: undefined },
    ])
  })

  // B-015: a "new password" prompt during login was answered with the login password.
  it('never answers a password-change prompt during login with the login password (B-015)', async () => {
    for (const prompt of ['New password: ', 'Retype new password: ', '(current) UNIX password: ']) {
      server.ssh.keyboardAnswers.length = 0
      server.ssh.accounts[TEST_USER] = {
        password: TEST_PASSWORD,
        keyboardOnly: true,
        extraPrompts: [prompt],
      }
      const r = await login(server)
      logins.push(r.conn)
      expect(r.result).toMatchObject({ ok: false })
      const answers = server.ssh.keyboardAnswers.filter((a) => a.prompt === prompt)
      expect(answers).toHaveLength(1)
      expect(answers[0].answer).not.toBe(TEST_PASSWORD)
    }
  })

  it('reports a dropped connection', async () => {
    const r = await login(server)
    logins.push(r.conn)
    server.ssh.dropConnections()
    await until(() => r.statuses.length === 2)
    // A reset socket is an `error`, then a `close`: reported once.
    expect(r.statuses[1]).toMatchObject({ state: 'disconnected', reason: 'error' })
    await sleep(50)
    expect(r.statuses).toHaveLength(2)
    expect(r.conn.isConnected).toBe(false)
  })
})

// B-014: on a first login with an expired password sshd ran `passwd` instead of every command,
// so the desktop never started.
describe('expired first-login password (B-014)', () => {
  const NEW = 'brand-new-pw-2'

  it('detects it before anything else runs, then changes it with passwd', async () => {
    server.ssh.accounts[TEST_USER] = { password: TEST_PASSWORD, expired: true }
    const r = await login(server)
    logins.push(r.conn)
    expect(r.result).toEqual({ ok: false, error: 'passwordExpired' })
    // Never "connected": nothing (display script, terminal, status panel) may run on it.
    expect(r.conn.isConnected).toBe(false)
    expect(r.statuses).toEqual([])
    expect(server.ssh.execs.map((e) => e.command)).toEqual(['echo SOGANGSSH_LOGIN_OK'])
    // The probe gave passwd no input, so no password was tried.
    expect(server.ssh.passwdAnswers).toEqual([])

    const change = await r.conn.changeExpiredPassword({ current: TEST_PASSWORD, next: NEW })
    expect(change).toEqual({ ok: true })
    expect(server.ssh.passwdAnswers).toEqual([
      { step: 'current', value: TEST_PASSWORD },
      { step: 'new', value: NEW },
      { step: 'retype', value: NEW },
    ])
    // The next login uses the new password.
    const again = await login(server, { password: NEW })
    logins.push(again.conn)
    expect(again.result).toMatchObject({ ok: true })
  })

  // B-016: sshd starts the forced passwd in the server's locale.
  it('answers the Korean prompts of a forced change (B-016)', async () => {
    server.ssh.accounts[TEST_USER] = { password: TEST_PASSWORD, expired: true, locale: 'ko' }
    const r = await login(server)
    logins.push(r.conn)
    expect(r.result).toEqual({ ok: false, error: 'passwordExpired' })
    expect(await r.conn.changeExpiredPassword({ current: TEST_PASSWORD, next: NEW })).toEqual({
      ok: true,
    })
    expect(server.ssh.accounts[TEST_USER]).toMatchObject({ password: NEW, expired: false })
  })

  it('reports a rejected new password and stops instead of retrying it', async () => {
    server.ssh.accounts[TEST_USER] = { password: TEST_PASSWORD, expired: true }
    const r = await login(server)
    logins.push(r.conn)
    const change = await r.conn.changeExpiredPassword({ current: TEST_PASSWORD, next: 'Ab1!x' })
    expect(change).toEqual({
      ok: false,
      error: 'rejected',
      detail: 'BAD PASSWORD: The password is shorter than 8 characters',
    })
    expect(server.ssh.passwdAnswers.filter((a) => a.step === 'new')).toHaveLength(1)
    expect(server.ssh.accounts[TEST_USER]).toMatchObject({ password: TEST_PASSWORD, expired: true })
  })
})
