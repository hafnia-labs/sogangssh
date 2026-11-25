import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { exec } from '../../src/main/remote/exec'
import { LicenseSetting } from '../../src/main/remote/license-setting'
import { RemoteShell } from '../../src/main/ssh/shell'
import type { TerminalExit } from '../../src/shared/ipc'
import { startFakeServer, type FakeServer } from '../fake-server/index.ts'
import { removeUserData } from './helpers/electron'
import { connected, sleep, until, watchUncaught } from './helpers/util'

vi.mock('electron', () => import('./helpers/electron'))

let server: FakeServer
let uncaught: ReturnType<typeof watchUncaught>
const cleanup: (() => void)[] = []

beforeEach(async () => {
  server = await startFakeServer()
  uncaught = watchUncaught()
})
afterEach(async () => {
  vi.useRealTimers()
  cleanup.splice(0).forEach((f) => f())
  await server.close()
  uncaught.stop()
  // B-006: a channel error without a listener would crash the main process.
  expect(uncaught.errors).toEqual([])
})
afterAll(() => removeUserData())

async function setup() {
  const c = await connected(server)
  cleanup.push(() => c.conn.disconnect())
  return c
}

// B-006: an exec channel the server breaks must end the call, never the app.
describe('exec channels the server breaks (B-006)', () => {
  it('reports a refused exec', async () => {
    const { client } = await setup()
    server.ssh.rejectExec('refused-command')
    const r = await exec(client, 'refused-command', 2000)
    expect(r).toMatchObject({ code: null, stdout: '' })
    expect(r.error).toBeTruthy()
  })

  it('ends when the server closes the channel without an exit status', async () => {
    const { client } = await setup()
    server.ssh.onExec('closes-early', 'close')
    expect(await exec(client, 'closes-early', 2000)).toEqual({ code: null, stdout: '', stderr: '' })
  })

  it('ends when the connection drops during the command, and the drop is reported', async () => {
    const { client, statuses } = await setup()
    server.ssh.onExec('drops-connection', 'drop')
    const r = await exec(client, 'drops-connection', 2000)
    expect(r.code).toBeNull()
    await until(() => statuses.some((s) => s.state === 'disconnected'))
    // Found in stage 2: on a dead client ssh2 throws from `exec` and `exec()` rejects (like
    // B-013 for the password change) instead of resolving with an error. Recorded here so a fix
    // shows up as a change: see BUGS.md B-036.
    await expect(exec(client, 'echo hi', 2000)).rejects.toThrow('Not connected')
  })

  it('times out a command that never answers and closes its channel', async () => {
    const { client } = await setup()
    server.ssh.onExec('never-answers', 'hang')
    const r = await exec(client, 'never-answers', 200)
    expect(r).toMatchObject({ code: null, error: 'timeout' })
    await until(() => server.ssh.execsMatching('never-answers')[0].closed)
  })

  it('passes stdin and reads stdout, stderr and the exit code', async () => {
    const { client } = await setup()
    server.ssh.onExec('sh -s', (req) => ({
      stdout: `got ${req.stdin.length} bytes\n`,
      stderr: 'warning\n',
      code: 3,
    }))
    expect(await exec(client, 'sh -s', 2000, 'x'.repeat(100_000))).toEqual({
      code: 3,
      stdout: 'got 100000 bytes\n',
      stderr: 'warning\n',
    })
  })
})

describe('license setting', () => {
  it('reads the value from the read script over stdin', async () => {
    const { client } = await setup()
    const license = new LicenseSetting()
    expect(await license.get(client)).toEqual({ ok: true, value: '27000@license.example' })
    const [read] = server.ssh.execsMatching('sh -s')
    // The command stays plain for the csh login shell; the script goes over stdin.
    expect(read.command).toBe('sh -s')
    expect(read.stdin).toContain('source ~/.bash_profile')
  })

  // B-024 / B-027: csh sourcing the profile could hang; a failed read must not count as
  // "not set" and must be tried again.
  it('times out a hanging read, then retries it (B-024, B-027)', async () => {
    const { client } = await setup()
    server.ssh.onExec({ command: /^sh -s$/, stdin: 'LICENSE' }, 'hang', { once: true })
    const license = new LicenseSetting()
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const reading = license.get(client)
    await until(() => server.ssh.execsMatching('sh -s').length === 1)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await reading).toEqual({ ok: false, reason: 'failed', detail: 'timeout' })
    vi.useRealTimers()
    await until(() => server.ssh.execsMatching('sh -s')[0].closed)

    expect(await license.get(client)).toEqual({ ok: true, value: '27000@license.example' })
  })

  it('tells "not set" apart (B-027)', async () => {
    server.ssh.licenseValue = null
    const { client } = await setup()
    expect(await new LicenseSetting().get(client)).toEqual({ ok: false, reason: 'notSet' })
  })
})

describe('terminal shell', () => {
  it('opens a login shell with the desktop environment on a PTY', async () => {
    const { client } = await setup()
    let output = ''
    const exits: TerminalExit[] = []
    const shell = new RemoteShell({ onData: (d) => (output += d), onExit: (e) => exits.push(e) })
    cleanup.push(() => shell.reset())
    const env = { display: ':20', xauthority: '/home/tester/.sogangssh/session/Xauthority' }
    expect(await shell.open(client, 100, 30, env)).toEqual({ ok: true, replay: '' })

    const [req] = server.ssh.execsMatching('$SHELL -l')
    expect(req.command).toBe(
      'env DISPLAY=:20 XAUTHORITY=/home/tester/.sogangssh/session/Xauthority ' +
        'SOGANGSSH_TERMINAL=1 $SHELL -l',
    )
    expect(req.pty).toBe(true)

    shell.write('echo $DISPLAY\r')
    await until(() => output.includes(':20\r\n'))
    // A re-mounted terminal gets the output so far.
    expect(await shell.open(client, 100, 30, env)).toEqual({ ok: true, replay: output })

    shell.write('exit\r')
    await until(() => exits.length === 1)
    expect(exits).toEqual([{ code: 0 }])
    expect(shell.isOpen).toBe(false)
  })

  it('ends when the connection drops, and ignores input afterwards', async () => {
    const { client } = await setup()
    const exits: TerminalExit[] = []
    const shell = new RemoteShell({ onData: () => {}, onExit: (e) => exits.push(e) })
    cleanup.push(() => shell.reset())
    await shell.open(client, 80, 24)
    server.ssh.dropConnections()
    await until(() => exits.length === 1)
    shell.write('ls\r')
    shell.resize(100, 40)
    await sleep(20)
  })
})
