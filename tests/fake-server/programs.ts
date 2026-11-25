// Interactive programs the fake server runs on a PTY channel: `passwd` (normal and the forced
// change of an expired first-login password, in English or Korean) and a tiny login shell.
import type { ServerChannel } from 'ssh2'

export type Locale = 'en' | 'ko'

/** `passwd` texts as the school server prints them (passwd 0.79, PAM 1.1.8, pam_pwquality). */
const TEXTS = {
  en: {
    expired:
      'WARNING: Your password has expired.\nYou must change your password now and login again!\n',
    changing: (user: string) =>
      `Changing password for user ${user}.\nChanging password for ${user}.\n`,
    current: '(current) UNIX password: ',
    next: 'New password: ',
    retype: 'Retype new password: ',
    bad: (min: number) => `BAD PASSWORD: The password is shorter than ${min} characters\n`,
    mismatch: 'Sorry, passwords do not match.\n',
    tokenError: 'passwd: Authentication token manipulation error\n',
    exhausted: 'passwd: Have exhausted maximum number of retries for service\n',
    success: 'passwd: all authentication tokens updated successfully.\n',
  },
  ko: {
    expired: '경고: 암호가 만료되었습니다.\n지금 암호를 변경하고 다시 로그인해야 합니다!\n',
    changing: (user: string) => `사용자 ${user}의 암호 변경 중\n`,
    current: '(현재) UNIX 암호:',
    next: '새 암호:',
    retype: '새 암호 재입력:',
    bad: (min: number) => `잘못된 암호: 암호는 ${min} 개의 문자 보다 짧습니다\n`,
    mismatch: '죄송합니다. 암호가 일치하지 않습니다.\n',
    tokenError: 'passwd: 인증 토큰 조작 오류\n',
    exhausted: 'passwd: 서비스에 대한 최대 재시도 횟수를 초과했습니다\n',
    success: 'passwd: 모든 인증 토큰이 성공적으로 업데이트 되었습니다.\n',
  },
}

export type PasswdStep = 'current' | 'new' | 'retype'

export type PasswdOptions = {
  user: string
  /** The account's password now. */
  password: string
  /** The forced change sshd runs instead of any command when the password has expired. */
  forced: boolean
  locale: Locale
  /** pam_pwquality minimum length. */
  minLength: number
  /** Stop answering: at once, or right after the retyped new password arrives. */
  hang?: 'start' | 'afterRetype'
  /** Every line the client typed, with the prompt it answered. */
  answers: { step: PasswdStep; value: string }[]
  onChanged: (next: string) => void
  /** Runs when passwd ends (the forced change also ends the SSH connection). */
  onExit?: (code: number) => void
}

/** Reads lines typed into a PTY channel. Ctrl+C and end of input are reported separately. */
function lineReader(
  channel: ServerChannel,
  onLine: (line: string) => void,
  onInterrupt: () => void,
  onEnd: () => void,
): void {
  let buf = ''
  channel.on('data', (data: Buffer) => {
    for (const ch of data.toString('utf8')) {
      if (ch === '\x03') {
        buf = ''
        onInterrupt()
      } else if (ch === '\r' || ch === '\n') {
        const line = buf
        buf = ''
        onLine(line)
      } else {
        buf += ch
      }
    }
  })
  channel.on('end', onEnd)
}

/** A scripted `passwd` with pam_pwquality: three tries for a good new password. */
export function runPasswd(channel: ServerChannel, opts: PasswdOptions): void {
  const t = TEXTS[opts.locale]
  let step: PasswdStep | 'done' = 'current'
  let tries = 0
  let next = ''
  let done = false

  const exit = (code: number) => {
    if (done) return
    done = true
    step = 'done'
    channel.exit(code)
    channel.end()
    opts.onExit?.(code)
  }
  const ask = (s: PasswdStep) => {
    step = s
    channel.write(s === 'current' ? t.current : s === 'new' ? t.next : t.retype)
  }

  lineReader(
    channel,
    (line) => {
      if (done || step === 'done') return
      opts.answers.push({ step, value: line })
      channel.write('\n')
      if (step === 'current') {
        if (line !== opts.password) {
          channel.write(t.tokenError)
          exit(1)
        } else ask('new')
      } else if (step === 'new') {
        if (line.length < opts.minLength) {
          channel.write(t.bad(opts.minLength))
          if (++tries >= 3) {
            channel.write(t.exhausted)
            exit(1)
          } else ask('new')
        } else {
          next = line
          ask('retype')
        }
      } else {
        if (line !== next) {
          channel.write(t.mismatch)
          if (++tries >= 3) {
            channel.write(t.exhausted)
            exit(1)
          } else ask('new')
          return
        }
        if (opts.hang === 'afterRetype') {
          // The server saves the password, then goes quiet (a cut-off change).
          opts.onChanged(next)
          step = 'done'
          return
        }
        opts.onChanged(next)
        channel.write(t.success)
        exit(0)
      }
    },
    // Ctrl+C: passwd dies at once.
    () => exit(1),
    // End of input while waiting for an answer: PAM gets no password.
    () => {
      if (step === 'done') return
      channel.write(`\n${t.tokenError}`)
      exit(1)
    },
  )

  if (opts.hang === 'start') return
  if (opts.forced) channel.write(t.expired)
  channel.write(t.changing(opts.user))
  ask('current')
}

/** A tiny interactive shell: echoes typed text, knows `echo $NAME` and `exit`. */
export function runShell(channel: ServerChannel, env: Record<string, string>): void {
  const prompt = () => channel.write('fake$ ')
  let ended = false
  const exit = (code: number) => {
    if (ended) return
    ended = true
    channel.exit(code)
    channel.end()
  }
  let line = ''
  channel.on('data', (data: Buffer) => {
    for (const ch of data.toString('utf8')) {
      if (ended) return
      if (ch === '\x03') {
        line = ''
        channel.write('^C\r\n')
        prompt()
      } else if (ch === '\r' || ch === '\n') {
        channel.write('\r\n')
        const cmd = line.trim()
        line = ''
        if (cmd === 'exit') return exit(0)
        const echo = /^echo \$(\w+)$/.exec(cmd)
        if (echo) channel.write(`${env[echo[1]] ?? ''}\r\n`)
        else if (cmd) channel.write(`${cmd.split(' ')[0]}: Command not found.\r\n`)
        prompt()
      } else {
        line += ch
        channel.write(ch)
      }
    }
  })
  channel.on('end', () => exit(0))
  prompt()
}
