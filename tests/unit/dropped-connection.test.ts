import { describe, expect, it } from 'vitest'
import type { Client } from 'ssh2'
import { launchers } from '../../src/main/launchers'
import { exec } from '../../src/main/remote/exec'
import { launch } from '../../src/main/remote/launch'
import { RemoteShell } from '../../src/main/ssh/shell'

// B-036: on a connection that has just dropped, ssh2 throws from exec/shell instead of calling
// back. Every caller must turn that into an ordinary error result, never a rejected promise.
const deadClient = {
  exec() {
    throw new Error('Not connected')
  },
  shell() {
    throw new Error('Not connected')
  },
} as unknown as Client

describe('a just-dropped connection (B-036)', () => {
  it('exec resolves with an error', async () => {
    expect(await exec(deadClient, 'echo hi', 1000)).toEqual({
      code: null,
      stdout: '',
      stderr: '',
      error: 'Not connected',
    })
  })

  it('launch resolves with failed', async () => {
    const env = { display: ':21', xauthority: '/home/student/.sogangssh/session/Xauthority' }
    expect(await launch(deadClient, launchers[0], env)).toEqual({
      ok: false,
      error: 'failed',
      detail: 'Not connected',
    })
  })

  it('opening a terminal resolves with failed', async () => {
    const shell = new RemoteShell({ onData: () => {}, onExit: () => {} })
    expect(await shell.open(deadClient, 80, 24)).toEqual({
      ok: false,
      error: 'failed',
      detail: 'Not connected',
    })
  })
})
