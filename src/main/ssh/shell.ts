import { StringDecoder } from 'node:string_decoder'
import type { Client, ClientChannel } from 'ssh2'
import type { TerminalExit, TerminalOpenResult } from '../../shared/ipc'
import type { DisplayEnvironment } from '../remote/display'

// Keep the tail of the output so a re-mounted terminal (window reload, HMR) can redraw it.
const REPLAY_LIMIT = 64 * 1024

export type ShellEvents = {
  onData: (data: string) => void
  onExit: (exit: TerminalExit) => void
}

const clampSize = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isInteger(n) && n > 0 && n <= 1000 ? n : fallback

const SAFE_VALUE = /^[\w./:-]+$/

/**
 * With a remote desktop, start the user's own login shell with DISPLAY and XAUTHORITY already
 * set, so GUI programs typed in the terminal (`xterm &`, `swb &`) appear on the desktop.
 * `$SHELL -l` works from both csh and sh. Without a desktop, a plain shell is opened.
 */
function shellCommand(env: DisplayEnvironment | null): string | null {
  if (!env || !SAFE_VALUE.test(env.display) || !SAFE_VALUE.test(env.xauthority)) return null
  return `env DISPLAY=${env.display} XAUTHORITY=${env.xauthority} SOGANGSSH_TERMINAL=1 $SHELL -l`
}

/** One interactive login shell (PTY) on the SSH connection, shown in the terminal panel. */
export class RemoteShell {
  private channel: ClientChannel | null = null
  private opening: Promise<TerminalOpenResult> | null = null
  private replay = ''
  /** Bumped by `reset()`; a shell that opens after a reset belongs to a dead connection. */
  private generation = 0

  constructor(private readonly events: ShellEvents) {}

  get isOpen(): boolean {
    return this.channel !== null
  }

  open(
    client: Client,
    cols: unknown,
    rows: unknown,
    env: DisplayEnvironment | null = null,
  ): Promise<TerminalOpenResult> {
    const c = clampSize(cols, 80)
    const r = clampSize(rows, 24)
    if (this.channel) {
      this.resize(c, r)
      return Promise.resolve({ ok: true, replay: this.replay })
    }
    if (this.opening) return this.opening

    const generation = this.generation
    this.opening = new Promise<TerminalOpenResult>((resolve) => {
      const pty = { term: 'xterm-256color', cols: c, rows: r }
      const command = shellCommand(env)
      const onChannel = (err: Error | undefined, channel: ClientChannel) => {
        if (generation !== this.generation) {
          channel?.close()
          resolve({ ok: false, error: 'notConnected' })
          return
        }
        this.opening = null
        if (err) {
          resolve({ ok: false, error: 'failed', detail: err.message })
          return
        }
        this.channel = channel
        this.replay = ''
        const decoder = new StringDecoder('utf8')
        const emit = (chunk: Buffer) => {
          const text = decoder.write(chunk)
          if (!text) return
          this.replay = (this.replay + text).slice(-REPLAY_LIMIT)
          this.events.onData(text)
        }
        channel.on('data', emit)
        channel.stderr.on('data', emit)
        let exitCode: number | null = null
        channel.on('exit', (code: number | null) => {
          exitCode = typeof code === 'number' ? code : null
        })
        channel.on('close', () => {
          if (this.channel !== channel) return
          this.channel = null
          this.events.onExit({ code: exitCode })
        })
        resolve({ ok: true, replay: '' })
      }
      if (command) client.exec(command, { pty }, onChannel)
      else client.shell(pty, onChannel)
    })
    return this.opening
  }

  write(data: unknown): void {
    if (typeof data === 'string' && data.length > 0) this.channel?.write(data)
  }

  resize(cols: unknown, rows: unknown): void {
    if (!this.channel) return
    this.channel.setWindow(clampSize(rows, 24), clampSize(cols, 80), 0, 0)
  }

  /** Forget the shell without notifying; used when the whole SSH connection goes away. */
  reset(): void {
    this.generation++
    const channel = this.channel
    this.channel = null
    this.opening = null
    this.replay = ''
    channel?.close()
  }
}
