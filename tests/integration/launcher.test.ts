import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launchers } from '../../src/main/launchers'
import { launch } from '../../src/main/remote/launch'
import { startFakeServer, type FakeServer } from '../fake-server/index.ts'
import { removeUserData } from './helpers/electron'
import { connected } from './helpers/util'

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

const env = { display: ':20', xauthority: '/home/tester/.sogangssh/session/Xauthority' }
const workbench = launchers.find((l) => l.id === 'sentaurus-workbench')!
const LOG = '"$HOME/.sogangssh/session/launch-sentaurus-workbench.log"'

async function setup() {
  const c = await connected(server)
  cleanup.push(() => c.conn.disconnect())
  return c.client
}

describe('launcher', () => {
  it('starts the program through sh -s with the script over stdin', async () => {
    const client = await setup()
    expect(await launch(client, workbench, env)).toEqual({ ok: true })
    const [run] = server.ssh.execsMatching('sh -s')
    // Nothing on the command line: other users can read it in `ps`.
    expect(run.command).toBe('sh -s')
    expect(run.stdin).toContain('DISPLAY=":20"; export DISPLAY')
    expect(run.stdin).toContain(`setsid nohup swb > ${LOG}`)
  })

  // B-019: a double click opened two copies, each holding a license.
  it('reports alreadyRunning for a second copy on the same desktop (B-019)', async () => {
    const client = await setup()
    expect(await launch(client, workbench, env)).toEqual({ ok: true })
    expect(await launch(client, workbench, env)).toEqual({ ok: false, error: 'alreadyRunning' })
    // Another desktop is another copy.
    expect(await launch(client, workbench, { ...env, display: ':21' })).toEqual({ ok: true })
  })

  // B-020: a forced second copy truncated the first copy's log.
  it('opens another copy when forced, appending to the log (B-020)', async () => {
    const client = await setup()
    await launch(client, workbench, env)
    expect(await launch(client, workbench, env, true)).toEqual({ ok: true })
    const forced = server.ssh.execsMatching('sh -s')[1]
    expect(forced.stdin).toContain(`setsid nohup swb >> ${LOG}`)
    expect(forced.stdin).not.toContain('RUNNING')
  })

  it('reports a program that is not installed', async () => {
    const client = await setup()
    server.ssh.onExec(
      { command: 'sh -s', stdin: 'SOGANGSSH_LAUNCHER=' },
      {
        stdout: 'ERROR notFound swb\n',
      },
    )
    expect(await launch(client, workbench, env)).toEqual({
      ok: false,
      error: 'notFound',
      detail: 'swb',
    })
  })

  // B-006: a launch channel the server breaks must not crash main.
  it('reports a launch whose channel the server closes', async () => {
    const client = await setup()
    server.ssh.onExec({ command: 'sh -s', stdin: 'SOGANGSSH_LAUNCHER=' }, 'close')
    expect(await launch(client, workbench, env)).toEqual({ ok: false, error: 'failed' })
  })
})
