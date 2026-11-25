// A local fake of the school server for tests: an ssh2 Server on 127.0.0.1 with test-only
// accounts, scriptable exec replies, PTY programs (`passwd`, a login shell) and port forwarding
// to a fake RFB server. It answers the app's own commands (login probe, display script, license
// read, launcher, status panel) out of the box; each test can add its own rules first.
//
// No real server details: made-up user names, passwords, display numbers and license servers.
import { createHash } from 'node:crypto'
import { connect, type AddressInfo, type Socket } from 'node:net'
import ssh2 from 'ssh2'
import type {
  AuthContext,
  Connection,
  KeyboardAuthContext,
  ServerChannel,
  TcpipRequestInfo,
} from 'ssh2'
import { runPasswd, runShell, type Locale, type PasswdOptions } from './programs.ts'

const { Server, utils } = ssh2

export type Account = {
  password: string
  /**
   * Keyboard-interactive prompts asked one by one after a correct password, like an OTP or a
   * password change during login. An empty answer fails the login.
   */
  extraPrompts?: string[]
  /** Only keyboard-interactive (the password method is refused), as with OTP setups. */
  keyboardOnly?: boolean
  /** An expired first-login password: sshd runs `passwd` instead of every command. */
  expired?: boolean
  /** Locale of the forced `passwd` (sshd starts it in the server's locale). */
  locale?: Locale
  /** `passwd` stops answering (for timeouts). */
  passwdHang?: PasswdOptions['hang']
}

export type ExecRequest = {
  user: string
  command: string
  /** What the client sent on stdin; complete once `ended` is true. */
  stdin: string
  ended: boolean
  pty: boolean
  env: Record<string, string>
  /** Set when the channel closed (by either side). */
  closed: boolean
}

/**
 * The answer to an exec once its input has ended. `hang`: never answer. `close`: close the
 * channel with no output or exit status. `drop`: cut the whole SSH connection.
 */
export type ExecReply =
  { stdout?: string; stderr?: string; code?: number } | 'hang' | 'close' | 'drop'

export type ExecMatch =
  | string
  | RegExp
  | { command?: string | RegExp; stdin?: string | RegExp }
  | ((req: ExecRequest) => boolean)

type ExecResponder = (req: ExecRequest) => ExecReply | Promise<ExecReply>
type Program = (channel: ServerChannel, req: ExecRequest) => void

type Rule =
  | { kind: 'reply'; match: ExecMatch; reply: ExecResponder; once: boolean }
  | { kind: 'program'; match: ExecMatch; program: Program; once: boolean }
  | { kind: 'reject'; match: ExecMatch; once: boolean }

export type ForwardDecision = 'accept' | 'reject' | 'close'

export type ForwardRecord = { destPort: number; open: boolean; accepted: boolean }

export type FakeSshOptions = {
  accounts?: Record<string, Account>
  /** Destination ports that forwarding may reach on 127.0.0.1 (the fake RFB server). */
  rfbPort?: number
  /** The license setting the read script finds in `~/.bash_profile`; null: not set. */
  licenseValue?: string | null
  /** pam_pwquality minimum length. */
  minPasswordLength?: number
}

const matches = (m: ExecMatch, req: ExecRequest): boolean => {
  const test = (p: string | RegExp | undefined, text: string) =>
    p === undefined || (typeof p === 'string' ? text.includes(p) : p.test(text))
  if (typeof m === 'function') return m(req)
  if (typeof m === 'string' || m instanceof RegExp) return test(m, req.command)
  return test(m.command, req.command) && test(m.stdin, req.stdin)
}

/** The fake desktop's display and its session files (made-up paths). */
const DISPLAY = 20

/** A sample in the status script's format; no real host or account names. */
const statusSample = (user: string) =>
  [
    'host fakehost',
    'uptime 3600.00',
    'load 0.10 0.20 0.30',
    'cores 8',
    'mem 16000000 8000000',
    'quota 1000000 9000000 10000000',
    `me ${user}`,
    `session ${user} .`,
    `usercpu ${user} 10 2`,
    'proc 1234 5 20000 swb',
    '',
  ].join('\n')

export class FakeSshServer {
  readonly accounts: Record<string, Account>
  readonly hostKey: string
  /** `SHA256:<base64>` of the host key, as the app shows it. */
  readonly fingerprint: string
  readonly execs: ExecRequest[] = []
  readonly forwards: ForwardRecord[] = []
  readonly authAttempts: { user: string; method: string }[] = []
  /** Keyboard-interactive prompts and the answers the client gave. */
  readonly keyboardAnswers: { prompt: string; answer: string | undefined }[] = []
  /** Lines typed into `passwd`, with the prompt each one answered. */
  readonly passwdAnswers: PasswdOptions['answers'] = []
  /** The display script as last uploaded. */
  uploadedScript: string | null = null
  desktopRunning = false
  /** Programs started by the launcher script: `<id> <display>` → pid. */
  readonly launched = new Map<string, number>()
  licenseValue: string | null
  minPasswordLength: number
  rfbPort: number | undefined
  /** Decides each forward; the default accepts only the RFB port. */
  onForward: (info: TcpipRequestInfo) => ForwardDecision | Promise<ForwardDecision>

  private readonly server: InstanceType<typeof Server>
  private readonly rules: Rule[] = []
  private readonly connections = new Set<Connection>()
  private readonly sockets = new Set<Socket>()
  private nextPid = 4000

  constructor(options: FakeSshOptions = {}) {
    this.accounts = options.accounts ?? { tester: { password: 'test-only-pw-1' } }
    this.rfbPort = options.rfbPort
    this.licenseValue =
      options.licenseValue === undefined ? '27000@license.example' : options.licenseValue
    this.minPasswordLength = options.minPasswordLength ?? 8
    this.onForward = (info) =>
      info.destIP === '127.0.0.1' && info.destPort === this.rfbPort ? 'accept' : 'reject'
    // ECDSA: generating ed25519 keys with ssh2 failed before.
    this.hostKey = utils.generateKeyPairSync('ecdsa', { bits: 256 }).private
    const parsed = utils.parseKey(this.hostKey)
    if (parsed instanceof Error) throw parsed
    this.fingerprint =
      'SHA256:' +
      createHash('sha256').update(parsed.getPublicSSH()).digest('base64').replace(/=+$/, '')
    this.server = new Server({ hostKeys: [this.hostKey] }, (conn) => this.handle(conn))
    this.addDefaultRules()
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port
  }

  /** Channels (sessions and forwards) open right now. */
  openChannels = 0

  get liveConnections(): number {
    return this.connections.size
  }

  listen(port = 0): Promise<this> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '127.0.0.1', () => resolve(this))
    })
  }

  close(): Promise<void> {
    this.dropConnections()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  /** Cut every connection at once, like a network drop. */
  dropConnections(): void {
    for (const s of this.sockets) s.destroy()
  }

  /** Answer matching execs (checked before the built-in rules, newest first). */
  onExec(match: ExecMatch, reply: ExecReply | ExecResponder, { once = false } = {}): void {
    const responder = typeof reply === 'function' ? reply : () => reply
    this.rules.unshift({ kind: 'reply', match, reply: responder, once })
  }

  /** Run an interactive program for matching execs (matched on the command only). */
  onExecProgram(match: ExecMatch, program: Program, { once = false } = {}): void {
    this.rules.unshift({ kind: 'program', match, program, once })
  }

  /** Refuse matching exec requests (matched on the command only). */
  rejectExec(match: ExecMatch, { once = false } = {}): void {
    this.rules.unshift({ kind: 'reject', match, once })
  }

  /** Execs whose command contains `text`. */
  execsMatching(text: string): ExecRequest[] {
    return this.execs.filter((e) => e.command.includes(text))
  }

  private take<K extends Rule['kind']>(
    kinds: K[],
    req: ExecRequest,
  ): Extract<Rule, { kind: K }> | undefined {
    const i = this.rules.findIndex((r) => kinds.includes(r.kind as K) && matches(r.match, req))
    if (i < 0) return undefined
    const rule = this.rules[i] as Extract<Rule, { kind: K }>
    if (rule.once) this.rules.splice(i, 1)
    return rule
  }

  private handle(conn: Connection): void {
    this.connections.add(conn)
    // ssh2 keeps the socket private; it is needed to cut a connection abruptly.
    const sock = (conn as unknown as { _sock?: Socket })._sock
    if (sock) {
      this.sockets.add(sock)
      sock.on('close', () => this.sockets.delete(sock))
    }
    conn.on('close', () => this.connections.delete(conn))
    conn.on('error', () => {})
    let user = ''

    conn.on('authentication', (ctx) => this.authenticate(ctx, (u) => (user = u)))

    conn.on('ready', () => {
      conn.on('session', (acceptSession) => {
        const session = acceptSession()
        const env: Record<string, string> = {}
        let pty = false
        session.on('pty', (accept) => {
          pty = true
          accept?.()
        })
        session.on('window-change', (accept) => accept?.())
        session.on('env', (accept, _reject, info) => {
          env[info.key] = info.val
          accept?.()
        })
        session.on('shell', (accept) => {
          const channel = accept()
          const req = this.record(user, '', pty, env)
          this.watch(channel, req)
          if (this.accounts[user]?.expired) return this.forcedPasswd(conn, channel, user)
          runShell(channel, env)
        })
        session.on('exec', (accept, reject, info) => {
          const req = this.record(user, info.command, pty, env)
          if (!this.accounts[user]?.expired) {
            const rule = this.take(['reject', 'program'], req)
            if (rule?.kind === 'reject') {
              req.closed = true
              return reject?.()
            }
            if (rule?.kind === 'program') {
              const channel = accept()
              this.watch(channel, req)
              return rule.program(channel, req)
            }
          }
          const channel = accept()
          this.watch(channel, req)
          // sshd runs `passwd` instead of any command while the password is expired.
          if (this.accounts[user]?.expired) return this.forcedPasswd(conn, channel, user)
          channel.on('data', (d: Buffer) => (req.stdin += d.toString('utf8')))
          channel.on('end', () => {
            req.ended = true
            void this.reply(conn, channel, req)
          })
        })
      })

      conn.on('tcpip', (accept, reject, info) => void this.forward(accept, reject, info))
    })
  }

  private authenticate(ctx: AuthContext, setUser: (user: string) => void): void {
    this.authAttempts.push({ user: ctx.username, method: ctx.method })
    const account = this.accounts[ctx.username]
    const methods: ('password' | 'keyboard-interactive')[] = account?.keyboardOnly
      ? ['keyboard-interactive']
      : ['password', 'keyboard-interactive']
    const allow = () => {
      setUser(ctx.username)
      ctx.accept()
    }
    if (ctx.method === 'password' && !account?.keyboardOnly && !account?.extraPrompts) {
      return ctx.password === account?.password ? allow() : ctx.reject(methods)
    }
    if (ctx.method === 'keyboard-interactive') return this.keyboard(ctx, account, allow, methods)
    ctx.reject(methods)
  }

  /** "Password:", then each extra prompt in its own round. */
  private keyboard(
    ctx: KeyboardAuthContext,
    account: Account | undefined,
    allow: () => void,
    methods: ('password' | 'keyboard-interactive')[],
  ): void {
    const rounds = ['Password: ', ...(account?.extraPrompts ?? [])]
    const ask = (i: number) => {
      if (i === rounds.length) return allow()
      ctx.prompt([{ prompt: rounds[i], echo: false }], (answers) => {
        this.keyboardAnswers.push({ prompt: rounds[i], answer: answers[0] })
        const ok = i === 0 ? answers[0] === account?.password : Boolean(answers[0])
        if (ok) ask(i + 1)
        else ctx.reject(methods)
      })
    }
    ask(0)
  }

  private record(
    user: string,
    command: string,
    pty: boolean,
    env: Record<string, string>,
  ): ExecRequest {
    const req = { user, command, stdin: '', ended: false, pty, env: { ...env }, closed: false }
    this.execs.push(req)
    return req
  }

  // ssh2 never emits 'close' for a Session itself, so the exec, shell and forward channels are
  // counted instead.
  private track(channel: ServerChannel): void {
    this.openChannels++
    let counted = true
    channel.on('close', () => {
      if (counted) this.openChannels--
      counted = false
    })
  }

  private watch(channel: ServerChannel, req: ExecRequest): void {
    this.track(channel)
    channel.on('error', () => {})
    channel.stderr.on('error', () => {})
    channel.on('close', () => (req.closed = true))
  }

  private forcedPasswd(conn: Connection, channel: ServerChannel, user: string): void {
    const account = this.accounts[user]
    runPasswd(channel, {
      user,
      password: account.password,
      forced: true,
      locale: account.locale ?? 'en',
      minLength: this.minPasswordLength,
      hang: account.passwdHang,
      answers: this.passwdAnswers,
      onChanged: (next) => {
        account.password = next
        account.expired = false
      },
      // Only that channel's `passwd` ends; after a successful change the user must log in again.
      onExit: (code) => {
        if (code === 0) setImmediate(() => conn.end())
      },
    })
  }

  private async reply(conn: Connection, channel: ServerChannel, req: ExecRequest): Promise<void> {
    const rule = this.take(['reply'], req)
    const reply: ExecReply = rule
      ? await rule.reply(req)
      : { stderr: `${req.command.split(' ')[0]}: Command not found.\n`, code: 1 }
    // The client may have gone away meanwhile (a dropped connection ends the channel).
    if (req.closed || !channel.writable) return
    if (reply === 'hang') return
    if (reply === 'close') return channel.close()
    if (reply === 'drop') {
      const sock = (conn as unknown as { _sock?: Socket })._sock
      return void sock?.destroy()
    }
    if (reply.stdout) channel.write(reply.stdout)
    // ssh2 may already have ended stderr when the connection is going away.
    if (reply.stderr && channel.stderr.writable) channel.stderr.write(reply.stderr)
    channel.exit(reply.code ?? 0)
    channel.end()
  }

  private async forward(
    accept: () => ServerChannel,
    reject: () => void,
    info: TcpipRequestInfo,
  ): Promise<void> {
    const record: ForwardRecord = { destPort: info.destPort, open: false, accepted: false }
    this.forwards.push(record)
    const decision = await this.onForward(info)
    if (decision === 'reject') return reject()
    const channel = accept()
    record.accepted = true
    record.open = true
    this.track(channel)
    channel.on('close', () => (record.open = false))
    channel.on('error', () => {})
    // ssh2 emits a server channel's 'close' only after its readable side ended, so drain it.
    const closeChannel = () => {
      channel.resume()
      channel.close()
    }
    if (decision === 'close') return closeChannel()
    const upstream = connect(info.destPort, '127.0.0.1')
    upstream.on('error', closeChannel)
    upstream.on('close', closeChannel)
    channel.on('close', () => upstream.destroy())
    channel.pipe(upstream).pipe(channel)
  }

  private addDefaultRules(): void {
    const ok = (stdout = '') => ({ stdout, code: 0 })
    const rules: [ExecMatch, ExecResponder][] = [
      // Login probe.
      ['echo SOGANGSSH_LOGIN_OK', () => ok('SOGANGSSH_LOGIN_OK\n')],
      // Display script upload and modes.
      [
        'cat > ~/.sogangssh/display.sh',
        (req) => {
          this.uploadedScript = req.stdin
          return ok()
        },
      ],
      [
        /^sh ~\/\.sogangssh\/display\.sh attach \d+ \d+ \d+$/,
        (req) => {
          if (this.rfbPort === undefined) return ok('ERROR noXvnc\n')
          const reused = this.desktopRunning ? 1 : 0
          this.desktopRunning = true
          return ok(
            `READY display=${DISPLAY} port=${this.rfbPort} password=fakevncpw ` +
              `xauthority=/home/${req.user}/.sogangssh/session/Xauthority reused=${reused}\n`,
          )
        },
      ],
      [
        'sh ~/.sogangssh/display.sh stop',
        () => {
          this.desktopRunning = false
          this.launched.clear()
          return ok('STOPPED\n')
        },
      ],
      // Status panel: the license query (arguments over stdin) and the status script.
      [
        { command: 'env SOGANGSSH_MONITOR=1 sh -s', stdin: /^set -- / },
        (req) => {
          const [, ...features] = req.stdin.split('\n')[0].slice('set -- '.length).split(' ')
          return ok(features.map((f) => `license ${f} 1 10\n`).join(''))
        },
      ],
      ['env SOGANGSSH_MONITOR=1 sh -s', (req) => ok(statusSample(req.user))],
      // License setting read from ~/.bash_profile.
      [
        { command: /^sh -s$/, stdin: "printf 'LICENSE %s" },
        () => ok(`LICENSE ${this.licenseValue ?? ''}\n`),
      ],
      // Launcher script: one copy per launcher and display unless forced.
      [
        { command: /^sh -s$/, stdin: 'SOGANGSSH_LAUNCHER=' },
        (req) => {
          const id = /SOGANGSSH_LAUNCHER=([\w-]+); export/.exec(req.stdin)?.[1] ?? '?'
          const display = /DISPLAY="([^"]+)"/.exec(req.stdin)?.[1] ?? '?'
          const key = `${id} ${display}`
          const checks = req.stdin.includes('echo "RUNNING $P"')
          const running = this.launched.get(key)
          if (checks && running !== undefined) return ok(`RUNNING ${running}\n`)
          const pid = this.nextPid++
          this.launched.set(key, pid)
          return ok(`LAUNCHED ${pid}\n`)
        },
      ],
    ]
    for (const [match, reply] of rules)
      this.rules.push({ kind: 'reply', match, reply, once: false })

    // `passwd` and the terminal's login shell run on a PTY.
    this.rules.push({
      kind: 'program',
      match: /^env LC_ALL=C passwd$/,
      once: false,
      program: (channel, req) => {
        const account = this.accounts[req.user]
        runPasswd(channel, {
          user: req.user,
          password: account.password,
          forced: false,
          locale: 'en',
          minLength: this.minPasswordLength,
          hang: account.passwdHang,
          answers: this.passwdAnswers,
          onChanged: (next) => (account.password = next),
        })
      },
    })
    this.rules.push({
      kind: 'program',
      match: /\$SHELL -l$/,
      once: false,
      program: (channel, req) => {
        const env: Record<string, string> = { ...req.env }
        for (const [, k, v] of req.command.matchAll(/(\w+)=(\S+)/g)) env[k] = v
        runShell(channel, env)
      },
    })
  }
}
