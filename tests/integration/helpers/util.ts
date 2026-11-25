import { expect } from 'vitest'
import { SshConnection } from '../../../src/main/ssh/connection'
import type { ConnectResult, SshStatus } from '../../../src/shared/ipc'
import { TEST_PASSWORD, TEST_USER, type FakeServer } from '../../fake-server/index.ts'

// Kept before any test installs fake timers, so waiting keeps working with them.
const realSetTimeout = globalThis.setTimeout

export const sleep = (ms: number) => new Promise<void>((r) => realSetTimeout(r, ms))

/** Wait until `check` holds (real time, also under fake timers). */
export async function until(check: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await sleep(5)
  }
}

export type Login = { conn: SshConnection; statuses: SshStatus[]; result: ConnectResult }

/** Log in to the fake server through the app's real SshConnection, trusting its host key. */
export async function login(
  server: FakeServer,
  overrides: Partial<{ username: string; password: string; trust: boolean }> = {},
): Promise<Login> {
  const statuses: SshStatus[] = []
  const conn = new SshConnection((s) => statuses.push(s))
  const result = await conn.connect({
    host: '127.0.0.1',
    port: server.ssh.port,
    username: overrides.username ?? TEST_USER,
    password: overrides.password ?? TEST_PASSWORD,
    trustFingerprint: overrides.trust === false ? undefined : server.ssh.fingerprint,
  })
  return { conn, statuses, result }
}

/** Log in and return the live ssh2 client. */
export async function connected(server: FakeServer) {
  const l = await login(server)
  expect(l.result).toMatchObject({ ok: true })
  const client = l.conn.activeClient
  if (!client) throw new Error('not connected')
  return { ...l, client }
}

/**
 * Collect uncaught exceptions and unhandled rejections while a test runs. A missing `error`
 * listener on an ssh2 channel would show up here (and would quit the real app).
 */
export function watchUncaught() {
  const errors: unknown[] = []
  const onError = (e: unknown) => errors.push(e)
  process.on('uncaughtException', onError)
  process.on('unhandledRejection', onError)
  return {
    errors,
    stop: () => {
      process.off('uncaughtException', onError)
      process.off('unhandledRejection', onError)
    },
  }
}
