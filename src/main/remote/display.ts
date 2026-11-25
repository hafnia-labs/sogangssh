import { randomBytes } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import type { Client, ClientChannel } from 'ssh2'
import { WebSocketServer, type WebSocket } from 'ws'
import type { DisplayEndResult, DisplayStartResult } from '../../shared/ipc'
import { DISPLAY_SCRIPT } from './display-script'
import { exec } from './exec'

const ATTACH_TIMEOUT_MS = 40_000
const STOP_TIMEOUT_MS = 20_000

/**
 * A desktop that nobody has been connected to for this long ends by itself (Xvnc
 * MaxDisconnectionTime), so a forgotten session does not hold TCAD licenses for days.
 */
export const SESSION_IDLE_LIMIT_S = 24 * 60 * 60

export type DisplayEnvironment = { display: string; xauthority: string }

type Session = {
  bridge: WebSocketServer
  url: string
  password: string
  display: number
  port: number
  xauthority: string
}

const clampSize = (n: unknown, fallback: number) =>
  typeof n === 'number' && Number.isInteger(n) && n >= 320 && n <= 7680 ? n : fallback

// The login shell is csh (short line limits, its own quoting), so exec commands stay plain:
// the script is streamed over stdin into a file, then run with sh.
const UPLOAD_COMMAND =
  'mkdir -p ~/.sogangssh && chmod 700 ~/.sogangssh && cat > ~/.sogangssh/display.sh'
const SCRIPT = 'sh ~/.sogangssh/display.sh'

async function uploadScript(client: Client): Promise<string | null> {
  const r = await exec(client, UPLOAD_COMMAND, ATTACH_TIMEOUT_MS, DISPLAY_SCRIPT)
  if (r.error) return r.error
  return r.code === 0 ? null : r.stderr.trim() || `exit ${r.code}`
}

const findLine = (text: string, prefix: string) =>
  text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.startsWith(prefix))

export type ReadyInfo = {
  display: number
  port: number
  password: string
  xauthority: string
  reused: boolean
}

/** The `READY display= port= password= xauthority= reused=` line of `attach`, or null. */
export function parseReady(stdout: string): ReadyInfo | null {
  const ready =
    /^READY display=(\d+) port=(\d+) password=(\S+) xauthority=(\S+) reused=([01])$/.exec(
      findLine(stdout, 'READY ') ?? '',
    )
  if (!ready) return null
  return {
    display: Number(ready[1]),
    port: Number(ready[2]),
    password: ready[3],
    xauthority: ready[4],
    reused: ready[5] === '1',
  }
}

/**
 * The user's persistent remote desktop (Xvnc on the server), bridged to noVNC:
 * noVNC (WebSocket) → local ws server → SSH forwardOut → server localhost:<port> (Xvnc).
 * The desktop lives on the server, independent of this app: `detach()` only closes the local
 * bridge, `end()` stops the desktop and everything on it.
 */
export class RemoteDisplay {
  private session: Session | null = null
  private starting: Promise<DisplayStartResult> | null = null
  /**
   * Bumped by `detach()` (a dropped connection or logout). A start that began before the bump
   * belongs to a dead connection: its result is thrown away instead of becoming the session.
   */
  private generation = 0

  /** DISPLAY and XAUTHORITY for launching GUI programs on this session. */
  get environment(): DisplayEnvironment | null {
    if (!this.session) return null
    return { display: `:${this.session.display}`, xauthority: this.session.xauthority }
  }

  /**
   * The environment once the desktop is attached. The terminal and the display panel open at
   * the same time, so wait briefly for an attach to begin, then for it to finish.
   */
  async waitForEnvironment(): Promise<DisplayEnvironment | null> {
    for (let i = 0; i < 30 && !this.session && !this.starting; i++) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (this.starting) await this.starting
    return this.environment
  }

  /** Reattach to the user's desktop, or start one if none is running. */
  attach(client: Client, width: unknown, height: unknown): Promise<DisplayStartResult> {
    if (this.session) {
      const { url, password, display } = this.session
      return Promise.resolve({ ok: true, url, password, display, reused: true })
    }
    if (this.starting) return this.starting
    const starting = this.launch(
      client,
      clampSize(width, 1600),
      clampSize(height, 900),
      this.generation,
    )
    this.starting = starting
    void starting.finally(() => {
      if (this.starting === starting) this.starting = null
    })
    return starting
  }

  /** Close the local bridge. The desktop keeps running on the server. */
  detach(): void {
    this.generation++
    this.starting = null
    const session = this.session
    this.session = null
    if (!session) return
    for (const ws of session.bridge.clients) ws.terminate()
    session.bridge.close()
  }

  /** Stop the desktop, its window manager and every program on it. */
  async end(client: Client): Promise<DisplayEndResult> {
    if (this.starting) await this.starting
    this.detach()
    const uploadError = await uploadScript(client)
    if (uploadError) return { ok: false, error: 'failed', detail: uploadError }
    const r = await exec(client, `${SCRIPT} stop`, STOP_TIMEOUT_MS)
    if (findLine(r.stdout, 'STOPPED')) return { ok: true }
    return {
      ok: false,
      error: 'failed',
      detail: r.error ?? (r.stderr.trim().slice(-300) || `exit ${r.code}`),
    }
  }

  private async launch(
    client: Client,
    width: number,
    height: number,
    generation: number,
  ): Promise<DisplayStartResult> {
    const uploadError = await uploadScript(client)
    if (generation !== this.generation) return { ok: false, error: 'notConnected' }
    if (uploadError) return { ok: false, error: 'startFailed', detail: uploadError }

    const r = await exec(
      client,
      `${SCRIPT} attach ${width} ${height} ${SESSION_IDLE_LIMIT_S}`,
      ATTACH_TIMEOUT_MS,
    )
    if (generation !== this.generation) return { ok: false, error: 'notConnected' }
    const error = findLine(r.stdout, 'ERROR ')
    if (error) {
      const [, code, ...rest] = error.split(' ')
      return {
        ok: false,
        error: code === 'noXvnc' ? 'noXvnc' : 'startFailed',
        detail: rest.join(' '),
      }
    }
    const ready = parseReady(r.stdout)
    if (!ready) {
      if (r.error === 'timeout') return { ok: false, error: 'timeout' }
      const detail = r.error ?? (r.stderr.trim().slice(-300) || 'No READY line from the server')
      return { ok: false, error: 'startFailed', detail }
    }
    return this.openBridge(client, generation, ready)
  }

  private openBridge(
    client: Client,
    generation: number,
    info: ReadyInfo,
  ): Promise<DisplayStartResult> {
    const token = randomBytes(18).toString('base64url')
    const path = `/vnc/${token}`
    const bridge = new WebSocketServer({
      host: '127.0.0.1',
      port: 0,
      path,
      // noVNC asks for the "binary" subprotocol when it offers one.
      handleProtocols: (protocols) => (protocols.has('binary') ? 'binary' : false),
    })

    bridge.on('connection', (ws: WebSocket) => {
      ws.binaryType = 'nodebuffer'
      // Listen on the WebSocket before the forward opens, so a close that comes first is seen.
      let stream: ClientChannel | null = null
      let closed = false
      const closeBoth = () => {
        if (closed) return
        closed = true
        stream?.end()
        if (ws.readyState === ws.OPEN) ws.close()
      }
      ws.on('close', closeBoth)
      ws.on('error', closeBoth)
      // noVNC keeps sending while the WebSocket is closing: never write to an ended stream.
      ws.on('message', (data: Buffer) => {
        if (!closed && stream?.writable) stream.write(data)
      })
      const forwardFailed = () => {
        if (!closed) ws.close(1011, 'forward failed')
        closed = true
      }
      // ssh2 throws (instead of calling back) when the connection has just dropped (B-036); this
      // runs in an event handler, where a throw would crash the main process.
      try {
        client.forwardOut('127.0.0.1', 0, '127.0.0.1', info.port, onForward)
      } catch {
        forwardFailed()
      }
      function onForward(err: Error | undefined, forwarded: ClientChannel) {
        if (err) {
          forwardFailed()
          return
        }
        // An 'error' event without a listener would crash the main process.
        forwarded.on('error', closeBoth)
        if (closed) {
          forwarded.end()
          return
        }
        stream = forwarded
        forwarded.on('data', (data: Buffer) => {
          if (ws.readyState === ws.OPEN) ws.send(data)
        })
        forwarded.on('close', closeBoth)
      }
    })

    return new Promise<DisplayStartResult>((resolve) => {
      bridge.on('listening', () => {
        // The connection dropped while the bridge was opening: it would forward over a dead client.
        if (generation !== this.generation) {
          bridge.close()
          resolve({ ok: false, error: 'notConnected' })
          return
        }
        const { port } = bridge.address() as AddressInfo
        const url = `ws://127.0.0.1:${port}${path}`
        const { reused, ...rest } = info
        this.session = { bridge, url, ...rest }
        resolve({ ok: true, url, password: info.password, display: info.display, reused })
      })
      bridge.on('error', (err) => {
        // A broken bridge must not stay the session, or every reattach would reuse its dead URL.
        if (this.session?.bridge === bridge) this.session = null
        for (const ws of bridge.clients) ws.terminate()
        bridge.close()
        resolve({ ok: false, error: 'startFailed', detail: err.message })
      })
    })
  }
}
