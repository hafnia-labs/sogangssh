import { describe, expect, it } from 'vitest'
import type { Client } from 'ssh2'
import { RemoteShell } from '../../src/main/ssh/shell'
import { FakeChannel } from './helpers/fake-ssh'

/** A client whose PTY channel opens only when `open()` is called. */
function pendingClient() {
  const channel = new FakeChannel()
  let callback: ((err: Error | undefined, ch: FakeChannel) => void) | null = null
  const client = {
    exec: (_cmd: string, _opts: unknown, cb: typeof callback) => (callback = cb),
    shell: (_opts: unknown, cb: typeof callback) => (callback = cb),
  } as unknown as Client
  return { client, channel, open: () => callback?.(undefined, channel) }
}

describe('RemoteShell', () => {
  it('shows output and survives a channel error (B-006)', async () => {
    const data: string[] = []
    const exits: unknown[] = []
    const shell = new RemoteShell({ onData: (t) => data.push(t), onExit: (e) => exits.push(e) })
    const pending = pendingClient()
    const opened = shell.open(pending.client, 80, 24)
    pending.open()
    expect(await opened).toEqual({ ok: true, replay: '' })

    pending.channel.out('hello')
    expect(data).toEqual(['hello'])
    // With no 'error' listener, this emit would throw and take the main process down.
    expect(() => pending.channel.emit('error', new Error('reset'))).not.toThrow()
    pending.channel.finish(0)
    expect(exits).toEqual([{ code: 0 }])
  })

  // B-004: a shell that opened after the connection dropped became the terminal.
  it('throws away a shell that opens after a reset', async () => {
    const shell = new RemoteShell({ onData: () => {}, onExit: () => {} })
    const pending = pendingClient()
    const opened = shell.open(pending.client, 80, 24)
    shell.reset()
    pending.open()
    expect(await opened).toEqual({ ok: false, error: 'notConnected' })
    expect(shell.isOpen).toBe(false)
    expect(pending.channel.closeCalled).toBe(true)
  })
})
