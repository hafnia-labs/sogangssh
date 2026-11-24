import type { Client } from 'ssh2'
import type { PasswordChangeRequest, PasswordChangeResult } from '../../shared/ipc'

const TIMEOUT_MS = 30_000
const MAX_LENGTH = 256

// `passwd` prompts with LC_ALL=C (checked on the school server: passwd 0.79, PAM 1.1.8).
// On a first login with an expired password, sshd runs `passwd` itself and ignores the command,
// so the prompts can follow the server's locale: Korean forms are matched too (best effort).
// The retype prompt also contains "new password", so it is checked first.
const CURRENT_PROMPT = /(current[^\n]*password|현재[^\n]*암호):\s*$/i
const RETYPE_PROMPT = /(retype[^\n]*password|암호[^\n]*재입력|재입력[^\n]*암호):\s*$/i
const NEW_PROMPT = /(new[^\n]*password|새[^\n]*암호):\s*$/i
const SUCCESS = /updated successfully|성공적으로[^\n]*(업데이트|변경)/i
const AUTH_ERROR =
  /authentication token manipulation error|authentication failure|인증 토큰 조작 오류|인증 실패/i
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR = /[\x00-\x1f\x7f]/

/**
 * A password the PTY can carry as one line: no control characters (a newline would answer the
 * next prompt, Ctrl+U or DEL would edit the line) and not absurdly long.
 */
function isSendable(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= MAX_LENGTH &&
    !CONTROL_CHAR.test(value)
  )
}

export function isValidPasswordRequest(req: unknown): req is PasswordChangeRequest {
  if (typeof req !== 'object' || req === null) return false
  const { current, next } = req as Record<string, unknown>
  return isSendable(current) && isSendable(next) && current !== next
}

/** Last non-empty lines of server output, with both passwords removed. */
function tail(text: string, secrets: string[], lines = 3): string | undefined {
  let clean = text
  for (const secret of secrets) clean = clean.split(secret).join('')
  const out = clean
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-lines)
    .join(' ')
  return out || undefined
}

/**
 * Change the user's own server password by driving `passwd` on a PTY. The passwords are typed
 * into the PTY (echo is off at these prompts), never put on a command line, logged or stored.
 */
export function changePassword(
  client: Client,
  req: PasswordChangeRequest,
): Promise<PasswordChangeResult> {
  const { current, next } = req
  const secrets = [current, next]

  return new Promise((resolve) => {
    // ssh2 throws (instead of calling back) when the connection is already gone.
    try {
      startPasswd(resolve)
    } catch {
      resolve({ ok: false, error: 'notConnected' })
    }
  })

  function startPasswd(resolve: (result: PasswordChangeResult) => void): void {
    client.exec(
      'env LC_ALL=C passwd',
      // The env request also asks for English prompts where sshd accepts it (AcceptEnv LC_*).
      { pty: { term: 'dumb', rows: 24, cols: 200 }, env: { LC_ALL: 'C', LANG: 'C' } },
      (err, channel) => {
        if (err) {
          resolve({ ok: false, error: 'failed', detail: err.message })
          return
        }
        let settled = false
        let all = ''
        // Output since the last answer, checked for the next prompt.
        let pending = ''
        let currentSent = false
        let newSent = false
        let rejected: string | null = null
        let askedAgain = false
        // Once the new password has been confirmed, the server may save it at any moment.
        let retypeSent = false
        let sinceRetype = ''

        /**
         * The result when the change is cut off (closed, timed out, channel error). After the
         * confirmation was sent and with no server verdict yet, the password may already be saved:
         * calling that a plain failure would send the user to the next login with the wrong one.
         */
        const cutOff = (otherwise: PasswordChangeResult): PasswordChangeResult => {
          const verdictSeen = rejected !== null || AUTH_ERROR.test(sinceRetype) || SUCCESS.test(all)
          if (retypeSent && !verdictSeen) return { ok: false, error: 'maybeChanged' }
          return otherwise
        }

        const finish = (result: PasswordChangeResult) => {
          if (settled) return
          settled = true
          clearTimeout(timer)
          resolve(result)
        }

        const timer = setTimeout(() => {
          finish(cutOff({ ok: false, error: 'timeout' }))
          channel.close()
        }, TIMEOUT_MS)

        const answer = (value: string) => {
          pending = ''
          channel.write(value + '\n')
        }

        const interrupt = () => {
          pending = ''
          channel.write('\x03')
          channel.end()
        }

        const onOutput = (chunk: Buffer) => {
          const text = chunk.toString('utf8').replace(/\r/g, '')
          all = (all + text).slice(-4000)
          pending += text
          if (retypeSent) sinceRetype = (sinceRetype + text).slice(-4000)
          if (rejected !== null) return
          if (CURRENT_PROMPT.test(pending)) {
            // Asked twice for the current password: the first one was wrong.
            if (currentSent) {
              askedAgain = true
              interrupt()
            } else {
              currentSent = true
              answer(current)
            }
          } else if (RETYPE_PROMPT.test(pending)) {
            answer(next)
            retypeSent = true
          } else if (NEW_PROMPT.test(pending)) {
            if (newSent) {
              // Asked again after a "BAD PASSWORD:" (or mismatch) line: the server rejected it.
              // Stop here instead of retrying the same password.
              const lines = pending.split('\n').slice(0, -1).join('\n')
              rejected = tail(lines, secrets, 1) ?? ''
              interrupt()
            } else {
              newSent = true
              answer(next)
            }
          }
        }

        // ssh2 only emits 'close' once stdout has been consumed, so always read it.
        channel.on('data', onOutput)
        channel.stderr.on('data', onOutput)
        // An 'error' event without a listener would crash the main process.
        channel.on('error', (e: Error) =>
          finish(cutOff({ ok: false, error: 'failed', detail: e.message })),
        )
        channel.on('close', () => {
          if (rejected !== null) {
            finish({ ok: false, error: 'rejected', detail: rejected || undefined })
          } else if (SUCCESS.test(all)) {
            finish({ ok: true })
          } else if (askedAgain || (currentSent && !newSent && AUTH_ERROR.test(all))) {
            // passwd ends before asking for a new password when the current one is wrong.
            finish({ ok: false, error: 'wrongPassword' })
          } else {
            finish(cutOff({ ok: false, error: 'failed', detail: tail(all, secrets) }))
          }
        })
      },
    )
  }
}
