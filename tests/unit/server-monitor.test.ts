import { afterEach, describe, expect, it } from 'vitest'
import type { LauncherConfig } from '../../src/main/launchers'
import type { LicenseRead } from '../../src/main/remote/license-setting'
import { ServerMonitor, parseLicenses, parseStatus } from '../../src/main/remote/server-monitor'
import type { ServerStatus } from '../../src/shared/ipc'
import { FakeClient, whenInputEnds, type ExecCall } from './helpers/fake-ssh'

// A made-up sample in the STATUS_SCRIPT format (no real host or account names).
const SAMPLE = [
  'host testhost',
  'uptime 12345.67',
  'load 0.50 1.25 2.00',
  'cores 16',
  'mem 65000000 32000000',
  'quota 4000000 9000000 10000000',
  'me alice',
  'session alice 00:05',
  'session alice .',
  'session bob old',
  'usercpu alice 100 3',
  'usercpu carol 50 1',
  'proc 4242 30 120000 swb',
  'proc 4243 2 5000 svisual',
  'garbage line',
  'proc broken',
].join('\n')

describe('parseStatus', () => {
  it('reads every record and skips broken lines', () => {
    const p = parseStatus(SAMPLE)
    expect(p).toMatchObject({
      host: 'testhost',
      uptimeSeconds: 12345.67,
      load: [0.5, 1.25, 2],
      cores: 16,
      memory: { totalKb: 65000000, availableKb: 32000000 },
      disk: { kind: 'quota', usedKb: 4000000, limitKb: 9000000 },
      me: 'alice',
    })
    expect(p.sessions).toEqual([
      { user: 'alice', idle: '00:05' },
      { user: 'alice', idle: '.' },
      { user: 'bob', idle: 'old' },
    ])
    expect(p.userCpu.get('carol')).toEqual({ seconds: 50, processes: 1 })
    expect(p.procs).toEqual([
      { pid: 4242, seconds: 30, rssKb: 120000, name: 'swb' },
      { pid: 4243, seconds: 2, rssKb: 5000, name: 'svisual' },
    ])
  })

  it('falls back to the hard quota, then to the filesystem', () => {
    expect(parseStatus('quota 10 0 20').disk).toEqual({ kind: 'quota', usedKb: 10, limitKb: 20 })
    expect(parseStatus('quota 10 0 0').disk).toBeNull()
    expect(parseStatus('disk 10 30').disk).toEqual({ kind: 'filesystem', usedKb: 10, limitKb: 30 })
  })

  it('keeps safe defaults for missing or broken numbers', () => {
    const p = parseStatus('cores 0\nload x y z\n')
    expect(p.cores).toBe(1)
    expect(p.load).toEqual([0, 0, 0])
  })
})

describe('parseLicenses', () => {
  it('reads license lines and the error line', () => {
    expect(parseLicenses('license swb_all 2 10\nlicense svisual_all 0 5\n')).toEqual({
      licenses: [
        { feature: 'swb_all', used: 2, total: 10 },
        { feature: 'svisual_all', used: 0, total: 5 },
      ],
      error: undefined,
    })
    expect(parseLicenses('licenseError Cannot connect to license server\n').error).toBe(
      'Cannot connect to license server',
    )
  })
})

const launchers: LauncherConfig[] = [
  {
    id: 'a',
    label: 'A',
    command: ['a'],
    env: {},
    path: [],
    cwd: '$HOME',
    licenseFeatures: ['feat_a', 'feat_b'],
  },
]

describe('ServerMonitor', () => {
  const monitors: ServerMonitor[] = []
  afterEach(() => monitors.splice(0).forEach((m) => m.stop()))

  function monitor(setting: LicenseRead, onStatus: (s: ServerStatus) => void = () => {}) {
    const m = new ServerMonitor(launchers, async () => setting, onStatus)
    monitors.push(m)
    return m
  }

  const answering = (calls: ExecCall[] = []) =>
    new FakeClient((call) => {
      calls.push(call)
      whenInputEnds(call.channel, (stdin) => {
        call.channel.out(stdin.includes('set --') ? 'license feat_a 1 4\n' : SAMPLE)
        call.channel.finish()
      })
    })

  // B-028: the license servers were on the command line, where `ps` shows them to everyone.
  it('passes the license query arguments over stdin, never on the command line', async () => {
    const license = '27000@license.example'
    const client = answering()
    const statuses: ServerStatus[] = []
    monitor({ ok: true, value: license }, (s) => statuses.push(s)).start(client.asClient)
    await until(() => statuses.some((s) => s.licenses?.length === 1))

    for (const call of client.calls) expect(call.command).toBe('env SOGANGSSH_MONITOR=1 sh -s')
    const query = client.calls.find((c) => c.channel.written.join('').startsWith('set --'))!
    expect(query.channel.written.join('').split('\n')[0]).toBe(`set -- ${license} feat_a feat_b`)
    expect(statuses.at(-1)?.licenses).toEqual([{ feature: 'feat_a', used: 1, total: 4 }])
  })

  // B-025: a value that starts with `-` would be read as an option.
  it('does not query with a value that reads as an option', async () => {
    const client = answering()
    const statuses: ServerStatus[] = []
    monitor({ ok: true, value: '-x' }, (s) => statuses.push(s)).start(client.asClient)
    await until(() => statuses.some((s) => s.licenses !== null))
    expect(client.calls.every((c) => !c.channel.written.join('').startsWith('set --'))).toBe(true)
  })

  // B-009: a query still running on a dropped connection blocked refreshes after reconnecting.
  it('refreshes on a new connection while a query on the old one still hangs', async () => {
    const stuck = new FakeClient()
    const statuses: ServerStatus[] = []
    // The app keeps one monitor and restarts it for every connection.
    const m = monitor({ ok: false, reason: 'notSet' }, (s) => statuses.push(s))
    m.start(stuck.asClient)
    await until(() => stuck.calls.length === 1)

    const fresh = answering()
    m.start(fresh.asClient)
    await until(() => statuses.some((s) => s.host === 'testhost'))
    expect(fresh.calls.length).toBe(1)
  })
})

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}
