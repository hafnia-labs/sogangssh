import { describe, expect, it } from 'vitest'
import type { Client } from 'ssh2'
import { changePassword, isValidPasswordRequest } from '../../src/main/ssh/password'
import { FakeClient, type FakeChannel } from './helpers/fake-ssh'

const req = { current: 'old-Secret1', next: 'new-Secret2' }

/**
 * A scripted `passwd`: it prints `steps[0]` at once, and each later text after the app's next
 * answer. A function step runs right after the text before it (to close the channel or raise an
 * error); as the first step, or after a text that needs an answer, it waits for that answer.
 */
function passwd(steps: (string | ((ch: FakeChannel) => void))[]) {
  const client = new FakeClient(({ channel }) => {
    let i = 0
    const next = () => {
      const step = steps[i++]
      if (step === undefined) return
      if (typeof step === 'function') {
        step(channel)
        return
      }
      channel.out(step)
      // A closing step after a final message does not wait for an answer.
      const after = steps[i]
      if (typeof after === 'function' && !/:\s*$/.test(step)) {
        i++
        after(channel)
      }
    }
    channel.on('input', () => queueMicrotask(next))
    // After an interrupt (Ctrl+C + end), passwd exits.
    channel.on('ended', () => queueMicrotask(() => channel.finish(1)))
    next()
  })
  return { client, result: changePassword(client.asClient, req) }
}

const close = (ch: FakeChannel) => ch.finish(1)

describe('isValidPasswordRequest', () => {
  it('accepts two different one-line passwords', () => {
    expect(isValidPasswordRequest(req)).toBe(true)
  })

  it('refuses control characters, empty, too long, equal or missing values', () => {
    expect(isValidPasswordRequest({ current: 'a', next: 'b\nc' })).toBe(false)
    expect(isValidPasswordRequest({ current: 'a', next: 'b\x15' })).toBe(false)
    expect(isValidPasswordRequest({ current: 'a', next: 'b\x7f' })).toBe(false)
    expect(isValidPasswordRequest({ current: '', next: 'b' })).toBe(false)
    expect(isValidPasswordRequest({ current: 'a', next: 'b'.repeat(257) })).toBe(false)
    expect(isValidPasswordRequest({ current: 'same', next: 'same' })).toBe(false)
    expect(isValidPasswordRequest({ current: 'a' })).toBe(false)
    expect(isValidPasswordRequest(null)).toBe(false)
    expect(isValidPasswordRequest('a')).toBe(false)
  })
})

describe('changePassword', () => {
  it('answers the English prompts and asks for the C locale (B-010)', async () => {
    const { client, result } = passwd([
      'Changing password for user student.\n(current) UNIX password: ',
      'New password: ',
      'Retype new password: ',
      'passwd: all authentication tokens updated successfully.\n',
      close,
    ])
    expect(await result).toEqual({ ok: true })
    const call = client.calls[0]
    expect(call.command).toBe('env LC_ALL=C passwd')
    expect(call.options).toMatchObject({ env: { LC_ALL: 'C', LANG: 'C' } })
    expect(call.channel.written).toEqual([`${req.current}\n`, `${req.next}\n`, `${req.next}\n`])
  })

  it('answers the Korean prompts of a forced change (B-016)', async () => {
    const { result } = passwd([
      '(현재) UNIX 암호:',
      '새 암호:',
      '새 암호 재입력:',
      'passwd: 모든 인증 토큰이 성공적으로 업데이트 되었습니다.\n',
      close,
    ])
    expect(await result).toEqual({ ok: true })
  })

  it('reports a wrong current password', async () => {
    const { result } = passwd([
      '(current) UNIX password: ',
      'passwd: Authentication token manipulation error\n',
      close,
    ])
    expect(await result).toEqual({ ok: false, error: 'wrongPassword' })
  })

  it('stops at a rejected new password and shows only the server line', async () => {
    const { client, result } = passwd([
      '(current) UNIX password: ',
      'New password: ',
      'BAD PASSWORD: The password is shorter than 8 characters\nNew password: ',
    ])
    const r = await result
    expect(r).toEqual({
      ok: false,
      error: 'rejected',
      detail: 'BAD PASSWORD: The password is shorter than 8 characters',
    })
    // Ctrl+C instead of sending the same password again.
    expect(client.calls[0].channel.written.at(-1)).toBe('\x03')
  })

  it('says a change cut off after the confirmation may have gone through (B-012)', async () => {
    const { result } = passwd([
      '(current) UNIX password: ',
      'New password: ',
      'Retype new password: ',
      close,
    ])
    expect(await result).toEqual({ ok: false, error: 'maybeChanged' })
  })

  it('calls a change cut off before the confirmation a plain failure', async () => {
    const { result } = passwd(['(current) UNIX password: ', close])
    expect(await result).toMatchObject({ ok: false, error: 'failed' })
  })

  it('survives a channel error instead of crashing the main process (B-006)', async () => {
    const { result } = passwd([
      '(current) UNIX password: ',
      'New password: ',
      'Retype new password: ',
      (ch) => ch.emit('error', new Error('reset by peer')),
    ])
    expect(await result).toEqual({ ok: false, error: 'maybeChanged' })
  })

  it('reports notConnected when ssh2 throws because the connection is gone (B-013)', async () => {
    const client = {
      exec() {
        throw new Error('Not connected')
      },
    } as unknown as Client
    expect(await changePassword(client, req)).toEqual({ ok: false, error: 'notConnected' })
  })
})
