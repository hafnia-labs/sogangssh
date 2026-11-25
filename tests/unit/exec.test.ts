import { describe, expect, it } from 'vitest'
import { exec } from '../../src/main/remote/exec'
import { FakeClient, whenInputEnds } from './helpers/fake-ssh'

describe('exec', () => {
  it('feeds stdin and collects stdout, stderr and the exit code', async () => {
    const client = new FakeClient(({ channel }) =>
      whenInputEnds(channel, (stdin) => {
        channel.out(stdin.toUpperCase())
        channel.stderr.emit('data', Buffer.from('warn'))
        channel.finish(3)
      }),
    )
    const r = await exec(client.asClient, 'sh -s', 1000, 'hello')
    expect(r).toEqual({ code: 3, stdout: 'HELLO', stderr: 'warn' })
    expect(client.calls[0].command).toBe('sh -s')
  })

  it('survives a channel error instead of crashing the main process (B-006)', async () => {
    // With no 'error' listener, this emit would throw and take the main process down.
    const client = new FakeClient(({ channel }) => channel.emit('error', new Error('broken pipe')))
    const r = await exec(client.asClient, 'true', 1000)
    expect(r.error).toBe('broken pipe')
  })

  it('times out', async () => {
    const client = new FakeClient()
    const r = await exec(client.asClient, 'sleep 100', 20)
    expect(r.error).toBe('timeout')
    expect(client.calls[0].channel.closeCalled).toBe(true)
  })
})
