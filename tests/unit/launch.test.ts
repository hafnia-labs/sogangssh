import { describe, expect, it } from 'vitest'
import { launchers, type LauncherConfig } from '../../src/main/launchers'
import { launch, launchScript } from '../../src/main/remote/launch'
import { FakeClient, whenInputEnds, type FakeChannel } from './helpers/fake-ssh'

const env = { display: ':21', xauthority: '/home/student/.sogangssh/session/Xauthority' }
const base: LauncherConfig = {
  id: 'test-app',
  label: 'Test',
  command: ['xterm'],
  env: { TOOL_HOME: '/opt/tool' },
  path: ['/opt/tool/bin'],
  cwd: '$HOME',
}

describe('launchScript', () => {
  it('builds a script for every built-in launcher', () => {
    for (const l of launchers) expect(launchScript(l, env)).toContain('LAUNCHED')
  })

  it('refuses words with shell syntax', () => {
    const bad = ['a b', 'a;b', 'a"b', "a'b", 'a`b`', 'a|b', 'a&b', 'a>b', '$(id)', 'a\nb']
    for (const word of bad) {
      expect(launchScript({ ...base, command: [word] }, env)).toBeNull()
      expect(launchScript({ ...base, env: { X: word } }, env)).toBeNull()
      expect(launchScript({ ...base, path: [word] }, env)).toBeNull()
      expect(launchScript({ ...base, cwd: word }, env)).toBeNull()
      expect(launchScript(base, { ...env, display: word })).toBeNull()
    }
  })

  it('refuses bad environment names, ids and an empty command', () => {
    expect(launchScript({ ...base, env: { 'A-B': 'x' } }, env)).toBeNull()
    expect(launchScript({ ...base, env: { lower: 'x' } }, env)).toBeNull()
    expect(launchScript({ ...base, id: 'a b' }, env)).toBeNull()
    expect(launchScript({ ...base, command: [] }, env)).toBeNull()
  })

  it('accepts a comma in a license file list (B-023)', () => {
    const license = '27000@a.example,27000@b.example,27000@c.example'
    const script = launchScript({ ...base, env: { SNPSLMD_LICENSE_FILE: license } }, env)
    expect(script).toContain(`SNPSLMD_LICENSE_FILE="${license}"; export SNPSLMD_LICENSE_FILE`)
  })

  it('marks the program and first looks for a running copy (B-019)', () => {
    const script = launchScript(base, env)!
    expect(script).toContain('SOGANGSSH_LAUNCHER=test-app; export SOGANGSSH_LAUNCHER')
    expect(script).toContain('grep -qx "SOGANGSSH_LAUNCHER=test-app"')
    expect(script).toContain('grep -qx "DISPLAY=:21"')
    expect(script).toContain('= "xterm" ] || continue')
    expect(script).toContain('echo "RUNNING $P"')
    // The check runs before the program starts.
    expect(script.indexOf('RUNNING')).toBeLessThan(script.indexOf('setsid nohup'))
    expect(script).toMatch(/setsid nohup xterm > "[^"]*launch-test-app\.log"/)
  })

  it('skips the check and appends to the log when forced (B-019, B-020)', () => {
    const script = launchScript(base, env, true)!
    expect(script).not.toContain('RUNNING')
    expect(script).toContain('SOGANGSSH_LAUNCHER=test-app; export SOGANGSSH_LAUNCHER')
    expect(script).toMatch(/setsid nohup xterm >> "[^"]*launch-test-app\.log"/)
  })

  it('matches the process name as the kernel shows it (file name, 15 characters)', () => {
    const script = launchScript({ ...base, command: ['/opt/tool/bin/averyverylongprogram'] }, env)!
    expect(script).toContain('= "averyverylongpr" ] || continue')
  })
})

describe('launch', () => {
  const run = (answer: (ch: FakeChannel) => void) =>
    launch(
      new FakeClient(({ channel }) => whenInputEnds(channel, () => answer(channel))).asClient,
      base,
      env,
    )
  const say = (line: string) => (ch: FakeChannel) => {
    ch.out(line)
    ch.finish()
  }

  it('reports LAUNCHED, RUNNING and errors', async () => {
    expect(await run(say('LAUNCHED 123\n'))).toEqual({ ok: true })
    expect(await run(say('RUNNING 99\n'))).toEqual({ ok: false, error: 'alreadyRunning' })
    expect(await run(say('ERROR notFound xterm\n'))).toEqual({
      ok: false,
      error: 'notFound',
      detail: 'xterm',
    })
  })

  it('survives a channel error instead of crashing the main process (B-006)', async () => {
    const result = await run((ch) => {
      ch.emit('error', new Error('channel broke'))
      ch.finish()
    })
    expect(result).toEqual({ ok: false, error: 'failed', detail: 'channel broke' })
  })
})
