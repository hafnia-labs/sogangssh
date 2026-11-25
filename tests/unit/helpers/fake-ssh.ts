// A stand-in for the parts of an ssh2 Client and ClientChannel the app uses. Nothing here opens a
// network connection: each test decides what the "server" answers.
import { EventEmitter } from 'node:events'
import type { Client } from 'ssh2'

export class FakeChannel extends EventEmitter {
  readonly stderr = new EventEmitter()
  /** Everything the app wrote, including what `end()` carried. */
  written: string[] = []
  writable = true
  ended = false
  closed = false

  write(data: string | Buffer): boolean {
    this.written.push(data.toString())
    this.emit('input', data.toString())
    return true
  }

  end(data?: string | Buffer): this {
    if (data !== undefined) this.write(data)
    this.ended = true
    this.writable = false
    this.emit('ended')
    return this
  }

  /** Set when the app closed the channel. */
  closeCalled = false

  /** Like ssh2, the 'close' event follows later, not inside the call. */
  close(): void {
    this.closeCalled = true
    setImmediate(() => this.finish())
  }

  setWindow(): void {}

  // Server side.
  out(text: string): void {
    this.emit('data', Buffer.from(text))
  }

  /** Exit code, then close, as ssh2 does. */
  finish(code: number | null = 0): void {
    if (this.closed) return
    this.closed = true
    this.writable = false
    this.emit('exit', code)
    this.emit('close')
  }
}

export type ExecCall = { command: string; options?: unknown; channel: FakeChannel }

type ExecHandler = (call: ExecCall) => void

/**
 * A fake ssh2 Client. `onExec` runs for every exec channel; the channel is handed to the app
 * first, so the handler can answer right away or later (on the channel's `ended` event).
 */
export class FakeClient {
  calls: ExecCall[] = []
  forwards: { port: number; callback: (err: Error | undefined, stream: FakeChannel) => void }[] = []

  constructor(private readonly onExec: ExecHandler = () => {}) {}

  exec(command: string, a: unknown, b?: unknown): void {
    const callback = (typeof a === 'function' ? a : b) as (
      err: Error | undefined,
      ch: FakeChannel,
    ) => void
    const options = typeof a === 'function' ? undefined : a
    const channel = new FakeChannel()
    const call = { command, options, channel }
    this.calls.push(call)
    callback(undefined, channel)
    this.onExec(call)
  }

  forwardOut(
    _srcIp: string,
    _srcPort: number,
    _dstIp: string,
    dstPort: number,
    callback: (err: Error | undefined, stream: FakeChannel) => void,
  ): void {
    // Left pending: the test opens the forward when it wants to.
    this.forwards.push({ port: dstPort, callback })
  }

  get asClient(): Client {
    return this as unknown as Client
  }
}

/** Answer an exec channel once the app has sent all its input. */
export function whenInputEnds(channel: FakeChannel, answer: (stdin: string) => void): void {
  if (channel.ended) answer(channel.written.join(''))
  else channel.once('ended', () => answer(channel.written.join('')))
}
