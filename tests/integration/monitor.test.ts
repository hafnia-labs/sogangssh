import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launchers } from '../../src/main/launchers'
import { LicenseSetting } from '../../src/main/remote/license-setting'
import { ServerMonitor } from '../../src/main/remote/server-monitor'
import type { ServerStatus } from '../../src/shared/ipc'
import { startFakeServer, type FakeServer } from '../fake-server/index.ts'
import { removeUserData } from './helpers/electron'
import { connected, sleep, until } from './helpers/util'

vi.mock('electron', () => import('./helpers/electron'))

let server: FakeServer
const cleanup: (() => void)[] = []

beforeEach(async () => {
  server = await startFakeServer()
})
afterEach(async () => {
  cleanup.splice(0).forEach((f) => f())
  await server.close()
})
afterAll(() => removeUserData())

function monitor() {
  const statuses: ServerStatus[] = []
  const license = new LicenseSetting()
  const m = new ServerMonitor(
    launchers,
    (client) => license.get(client),
    (s) => statuses.push(s),
  )
  cleanup.push(() => m.stop())
  return { m, statuses }
}

const FEATURES = ['swb_all', 'sde_all', 'sprocess_all', 'sdevice_all', 'svisual_all']

describe('server monitor', () => {
  it('shows the status and the license use of the user’s own license servers', async () => {
    const { client } = await connected(server).then(
      (c) => (cleanup.push(() => c.conn.disconnect()), c),
    )
    const { m, statuses } = monitor()
    m.start(client)
    await until(() => statuses.some((s) => s.licenses !== null))
    const latest = statuses[statuses.length - 1]
    expect(latest).toMatchObject({
      host: 'fakehost',
      cores: 8,
      load: [0.1, 0.2, 0.3],
      disk: { kind: 'quota', usedKb: 1000000, limitKb: 9000000 },
      licenseMissing: false,
    })
    expect(latest.users[0]).toMatchObject({ name: 'tester', isMe: true })
    expect(latest.licenses?.map((l) => l.feature).sort()).toEqual([...FEATURES].sort())
  })

  // B-028: the license servers were on the command line, where every user can read them in `ps`.
  it('passes the license query arguments over stdin, never on the command line (B-028)', async () => {
    const { client } = await connected(server).then(
      (c) => (cleanup.push(() => c.conn.disconnect()), c),
    )
    const { m, statuses } = monitor()
    m.start(client)
    await until(() => statuses.some((s) => s.licenses !== null))

    const query = server.ssh.execs.find((e) => e.stdin.startsWith('set -- '))
    expect(query?.command).toBe('env SOGANGSSH_MONITOR=1 sh -s')
    expect(query?.stdin.split('\n')[0]).toBe(`set -- 27000@license.example ${FEATURES.join(' ')}`)
    for (const e of server.ssh.execs) {
      expect(e.command).not.toContain('license.example')
      expect(e.command).not.toContain('_all')
    }
  })

  // B-025: a value starting with `-` would be read as an option by `sh` and `lmstat`.
  it('never queries with a value that reads as an option (B-025)', async () => {
    server.ssh.licenseValue = '-c/etc/evil'
    const { client } = await connected(server).then(
      (c) => (cleanup.push(() => c.conn.disconnect()), c),
    )
    const { m, statuses } = monitor()
    m.start(client)
    await until(() => statuses.some((s) => s.licenseMissing))
    await sleep(50)
    expect(server.ssh.execs.some((e) => e.stdin.startsWith('set -- '))).toBe(false)
  })

  // B-009: a query on the old connection that never finished blocked every refresh afterwards.
  it('refreshes on a new connection while a query on the old one still hangs (B-009)', async () => {
    const first = await connected(server)
    cleanup.push(() => first.conn.disconnect())
    server.ssh.onExec({ command: 'SOGANGSSH_MONITOR', stdin: /^(?!set -- )/ }, 'hang', {
      once: true,
    })
    const { m, statuses } = monitor()
    m.start(first.client)
    // Let the license query finish first: only the hanging status query is left.
    await until(() => server.ssh.execs.some((e) => e.stdin.startsWith('set -- ') && e.closed))
    // Log out while the query hangs. ipc.ts stops the monitor from the status callback, before the
    // old query ends (a half-dead connection can keep it pending much longer).
    first.conn.disconnect()
    m.stop()

    const second = await connected(server)
    cleanup.push(() => second.conn.disconnect())
    m.start(second.client)
    await until(() => statuses.length > 0)
    expect(statuses[0].host).toBe('fakehost')
  })
})
