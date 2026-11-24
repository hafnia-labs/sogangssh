import { createHash } from 'node:crypto'
import { Client, type ConnectConfig } from 'ssh2'
import type { ConnectRequest, ConnectResult, SshStatus } from '../../shared/ipc'
import { knownHosts } from './known-hosts'

const READY_TIMEOUT_MS = 15_000
const KEEPALIVE_INTERVAL_MS = 15_000

// Prompts we can answer with the login password. Anything else (OTP, verification code)
// needs user input, which arrives in a later stage.
const PASSWORD_PROMPT = /password|passwd|암호|비밀번호/i

export function fingerprintOf(key: Buffer): string {
  return 'SHA256:' + createHash('sha256').update(key).digest('base64').replace(/=+$/, '')
}

type Failure = Extract<ConnectResult, { ok: false }>

function isValidRequest(req: unknown): req is ConnectRequest {
  if (typeof req !== 'object' || req === null) return false
  const r = req as Record<string, unknown>
  return (
    typeof r.host === 'string' &&
    r.host.trim() !== '' &&
    typeof r.port === 'number' &&
    Number.isInteger(r.port) &&
    r.port >= 1 &&
    r.port <= 65535 &&
    typeof r.username === 'string' &&
    r.username.trim() !== '' &&
    typeof r.password === 'string' &&
    r.password !== '' &&
    (r.trustFingerprint === undefined || typeof r.trustFingerprint === 'string')
  )
}

function mapError(err: Error & { level?: string; code?: string }, otpPrompted: boolean): Failure {
  const detail = err.code ? `${err.code}: ${err.message}` : err.message
  if (err.level === 'client-authentication') {
    return { ok: false, error: otpPrompted ? 'otpRequired' : 'authFailed', detail }
  }
  if (err.level === 'client-timeout') return { ok: false, error: 'timeout', detail }
  switch (err.code) {
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return { ok: false, error: 'hostNotFound', detail }
    case 'ECONNREFUSED':
      return { ok: false, error: 'connectionRefused', detail }
    case 'ETIMEDOUT':
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return { ok: false, error: 'timeout', detail }
    default:
      return { ok: false, error: 'unknown', detail }
  }
}

/**
 * Owns the single SSH connection of the app. The password is used only for this
 * handshake; it is never stored or logged.
 */
export class SshConnection {
  private client: Client | null = null
  private connecting = false
  private closingByUser = false

  constructor(private readonly emitStatus: (status: SshStatus) => void) {}

  get isConnected(): boolean {
    return this.client !== null
  }

  /** The live ssh2 client, for opening channels (shell, exec, forwarding). Null when offline. */
  get activeClient(): Client | null {
    return this.client
  }

  connect(req: unknown): Promise<ConnectResult> {
    if (!isValidRequest(req)) return Promise.resolve({ ok: false, error: 'invalidInput' })
    if (this.client || this.connecting) {
      return Promise.resolve({ ok: false, error: 'alreadyConnected' })
    }

    const host = req.host.trim()
    const port = req.port
    const username = req.username.trim()
    this.connecting = true

    return new Promise<ConnectResult>((resolve) => {
      const client = new Client()
      let settled = false
      let hostKeyFailure: Failure | null = null
      let otpPrompted = false
      let fingerprintToSave: string | null = null

      const settle = (result: ConnectResult) => {
        if (settled) return
        settled = true
        this.connecting = false
        resolve(result)
      }

      const hostVerifier = (key: Buffer): boolean => {
        const fingerprint = fingerprintOf(key)
        const saved = knownHosts.get(host, port)
        if (saved) {
          if (saved === fingerprint) return true
          hostKeyFailure = {
            ok: false,
            error: 'hostKeyChanged',
            fingerprint,
            savedFingerprint: saved,
          }
          return false
        }
        if (req.trustFingerprint === fingerprint) {
          fingerprintToSave = fingerprint
          return true
        }
        hostKeyFailure = { ok: false, error: 'hostKeyUnknown', fingerprint }
        return false
      }

      client.on('keyboard-interactive', (_name, _instructions, _lang, prompts, finish) => {
        if (prompts.every((p) => PASSWORD_PROMPT.test(p.prompt))) {
          finish(prompts.map(() => req.password))
          return
        }
        // A non-password prompt (likely OTP). Answer nothing so the attempt fails cleanly.
        otpPrompted = true
        finish([])
      })

      client.on('ready', () => {
        // Save a newly trusted host key only after the full login succeeds.
        if (fingerprintToSave) knownHosts.set(host, port, fingerprintToSave)
        this.client = client
        this.closingByUser = false
        this.emitStatus({ state: 'connected', host, port, username })
        settle({ ok: true, host, port, username })
      })

      client.on('error', (err) => {
        if (!settled) {
          settle(hostKeyFailure ?? mapError(err, otpPrompted))
          client.end()
          return
        }
        if (this.client === client) this.handleLost('error', err.message)
      })

      client.on('close', () => {
        if (!settled) {
          settle(hostKeyFailure ?? { ok: false, error: 'unknown', detail: 'Closed before login' })
          return
        }
        if (this.client === client) this.handleLost('closed')
      })

      const config: ConnectConfig = {
        host,
        port,
        username,
        password: req.password,
        tryKeyboard: true,
        readyTimeout: READY_TIMEOUT_MS,
        keepaliveInterval: KEEPALIVE_INTERVAL_MS,
        keepaliveCountMax: 3,
        hostVerifier,
      }

      try {
        client.connect(config)
      } catch (err) {
        settle({ ok: false, error: 'unknown', detail: (err as Error).message })
      }
    })
  }

  disconnect(): void {
    if (!this.client) return
    const client = this.client
    this.client = null
    this.closingByUser = true
    client.end()
    this.emitStatus({ state: 'disconnected', reason: 'user' })
  }

  private handleLost(reason: 'closed' | 'error', detail?: string): void {
    this.client = null
    if (this.closingByUser) return
    this.emitStatus({ state: 'disconnected', reason, detail })
  }
}
