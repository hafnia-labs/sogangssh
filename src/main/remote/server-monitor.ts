import type { Client } from 'ssh2'
import type { ServerLicense, ServerStatus, ServerUser } from '../../shared/ipc'
import type { LauncherConfig } from '../launchers'
import type { LicenseRead } from './license-setting'
import { exec } from './exec'
import { LICENSE_SCRIPT, STATUS_SCRIPT } from './status-script'

const STATUS_INTERVAL_MS = 10_000
const LICENSE_INTERVAL_MS = 60_000
const STATUS_TIMEOUT_MS = 15_000
const LICENSE_TIMEOUT_MS = 120_000
const MAX_PROCESSES = 8
/** Users without a login session are listed only while they use at least this many cores. */
const BUSY_CORES = 0.1

type Sample = { at: number; userCpu: Map<string, number>; procCpu: Map<number, number> }

type Parsed = Omit<
  ServerStatus,
  'licenses' | 'licenseError' | 'updatedAt' | 'users' | 'processes'
> & {
  me: string
  sessions: { user: string; idle: string }[]
  userCpu: Map<string, { seconds: number; processes: number }>
  procs: { pid: number; seconds: number; rssKb: number; name: string }[]
}

const num = (s: string | undefined) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}

/** Parse the STATUS_SCRIPT records. Unknown or broken lines are skipped. */
export function parseStatus(text: string): Parsed {
  const out: Parsed = {
    host: '',
    uptimeSeconds: 0,
    load: [0, 0, 0],
    cores: 1,
    memory: { totalKb: 0, availableKb: 0 },
    disk: null,
    me: '',
    sessions: [],
    userCpu: new Map(),
    procs: [],
  }
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/)
    switch (f[0]) {
      case 'host':
        out.host = f[1] ?? ''
        break
      case 'uptime':
        out.uptimeSeconds = num(f[1])
        break
      case 'load':
        out.load = [num(f[1]), num(f[2]), num(f[3])]
        break
      case 'cores':
        out.cores = Math.max(1, num(f[1]))
        break
      case 'mem':
        out.memory = { totalKb: num(f[1]), availableKb: num(f[2]) }
        break
      case 'quota': {
        // Prefer the soft limit (where warnings start); fall back to the hard limit.
        const limit = num(f[2]) || num(f[3])
        if (limit > 0) out.disk = { kind: 'quota', usedKb: num(f[1]), limitKb: limit }
        break
      }
      case 'disk':
        if (num(f[2]) > 0) out.disk = { kind: 'filesystem', usedKb: num(f[1]), limitKb: num(f[2]) }
        break
      case 'me':
        out.me = f[1] ?? ''
        break
      case 'session':
        if (f[1]) out.sessions.push({ user: f[1], idle: f[2] ?? '' })
        break
      case 'usercpu':
        if (f[1]) out.userCpu.set(f[1], { seconds: num(f[2]), processes: num(f[3]) })
        break
      case 'proc':
        if (f[1] && f[4])
          out.procs.push({ pid: num(f[1]), seconds: num(f[2]), rssKb: num(f[3]), name: f[4] })
        break
    }
  }
  return out
}

/** Parse the LICENSE_SCRIPT records. */
export function parseLicenses(text: string): { licenses: ServerLicense[]; error?: string } {
  const licenses: ServerLicense[] = []
  let error: string | undefined
  for (const line of text.split('\n')) {
    const f = line.trim().split(/\s+/)
    if (f[0] === 'license' && f[1])
      licenses.push({ feature: f[1], used: num(f[2]), total: num(f[3]) })
    if (f[0] === 'licenseError') error = f.slice(1).join(' ')
  }
  return { licenses, error }
}

// "." (under a minute) < "HH:MM" < "old" (over a day).
const idleRank = (idle: string) => {
  if (idle === '.') return 0
  const m = /^(\d+):(\d+)$/.exec(idle)
  return m ? Number(m[1]) * 60 + Number(m[2]) : Number.MAX_SAFE_INTEGER
}

// Values passed to the license script: no shell syntax, and never something that reads as an option.
const words = /^[\w@.,:/+-]+$/
const safeWord = (w: string) => words.test(w) && !w.startsWith('-')

// Marks this panel's commands so the status script can leave them out of "my processes".
const RUN = 'env SOGANGSSH_MONITOR=1 sh -s'

/**
 * Collects the server status over short read-only exec channels while connected: system
 * numbers every 10 s, license usage every 60 s. CPU use is the difference of cumulative CPU
 * time between two samples, so it shows what is running now rather than lifetime averages.
 */
export class ServerMonitor {
  private client: Client | null = null
  private timers: NodeJS.Timeout[] = []
  private busy = { status: false, license: false }
  private prev: Sample | null = null
  private licenses: ServerLicense[] | null = null
  private licenseError: string | undefined
  private licenseMissing = false
  private latest: ServerStatus | null = null

  constructor(
    private readonly launchers: LauncherConfig[],
    /** The user's license setting for this connection (see `license-setting.ts`). */
    private readonly licenseSetting: (client: Client) => Promise<LicenseRead>,
    private readonly onStatus: (status: ServerStatus) => void,
  ) {}

  get status(): ServerStatus | null {
    return this.latest
  }

  start(client: Client): void {
    this.stop()
    this.client = client
    void this.refreshStatus()
    void this.refreshLicenses()
    this.timers.push(setInterval(() => void this.refreshStatus(), STATUS_INTERVAL_MS))
    this.timers.push(setInterval(() => void this.refreshLicenses(), LICENSE_INTERVAL_MS))
  }

  stop(): void {
    for (const t of this.timers) clearInterval(t)
    this.timers = []
    this.client = null
    // A query still running on the old connection must not block the next one.
    this.busy = { status: false, license: false }
    this.prev = null
    this.licenses = null
    this.licenseError = undefined
    this.licenseMissing = false
    this.latest = null
  }

  private async refreshStatus(): Promise<void> {
    const client = this.client
    if (!client || this.busy.status) return
    this.busy.status = true
    try {
      const r = await exec(client, RUN, STATUS_TIMEOUT_MS, STATUS_SCRIPT)
      if (client !== this.client || !r.stdout) return
      this.publish(parseStatus(r.stdout), Date.now())
    } finally {
      if (client === this.client) this.busy.status = false
    }
  }

  private async refreshLicenses(): Promise<void> {
    const client = this.client
    if (!client || this.busy.license) return
    // The features every launcher declares, queried on the user's own license servers.
    const features = new Set(this.launchers.flatMap((l) => l.licenseFeatures ?? []))
    if (features.size === 0) return
    this.busy.license = true
    try {
      const setting = await this.licenseSetting(client)
      if (client !== this.client) return
      const licenses: ServerLicense[] = []
      let error: string | undefined
      // Without a setting there is nothing to ask; the panel says why.
      this.licenseMissing = !setting.ok && setting.reason === 'notSet'
      // A failed read (timeout, channel error) shows its cause; it carries no server details.
      if (!setting.ok && setting.reason === 'failed') error = setting.detail
      const args = setting.ok ? [setting.value, ...features] : []
      if (args.length > 0 && args.every(safeWord)) {
        // Arguments go in over stdin (`set --`), never on the command line where `ps` shows them.
        const script = `set -- ${args.join(' ')}\n${LICENSE_SCRIPT}`
        const r = await exec(client, RUN, LICENSE_TIMEOUT_MS, script)
        if (client !== this.client) return
        const parsed = parseLicenses(r.stdout)
        licenses.push(...parsed.licenses)
        error = parsed.error ?? (parsed.licenses.length === 0 ? (r.error ?? 'no data') : undefined)
      }
      this.licenses = licenses
      this.licenseError = error
      if (this.latest) {
        this.latest = {
          ...this.latest,
          licenses,
          licenseError: error,
          licenseMissing: this.licenseMissing,
        }
        this.onStatus(this.latest)
      }
    } finally {
      if (client === this.client) this.busy.license = false
    }
  }

  private publish(p: Parsed, at: number): void {
    const prev = this.prev
    const seconds = prev ? (at - prev.at) / 1000 : 0
    const rate = (now: number, before: number | undefined) =>
      prev && before !== undefined && seconds > 0
        ? Math.max(0, Math.round(((now - before) / seconds) * 10) / 10)
        : null

    const users = new Map<string, ServerUser>()
    for (const s of p.sessions) {
      const u = users.get(s.user) ?? {
        name: s.user,
        isMe: s.user === p.me,
        sessions: 0,
        idle: null,
        cores: null,
      }
      u.sessions++
      if (u.idle === null || idleRank(s.idle) < idleRank(u.idle)) u.idle = s.idle
      users.set(s.user, u)
    }
    for (const [name, cpu] of p.userCpu) {
      const cores = rate(cpu.seconds, prev?.userCpu.get(name))
      const u = users.get(name)
      if (u) u.cores = cores
      else if (cores !== null && cores >= BUSY_CORES)
        users.set(name, { name, isMe: name === p.me, sessions: 0, idle: null, cores })
    }
    // Always list me, even without a login session or CPU use.
    if (p.me && !users.has(p.me)) {
      const cores = rate(p.userCpu.get(p.me)?.seconds ?? 0, prev?.userCpu.get(p.me))
      users.set(p.me, { name: p.me, isMe: true, sessions: 0, idle: null, cores })
    }
    // Me first, then the busiest, then by name.
    const userList = [...users.values()].sort(
      (a, b) =>
        Number(b.isMe) - Number(a.isMe) ||
        (b.cores ?? 0) - (a.cores ?? 0) ||
        a.name.localeCompare(b.name),
    )

    const processes = p.procs
      .map((pr) => ({
        pid: pr.pid,
        name: pr.name,
        rssKb: pr.rssKb,
        cores: rate(pr.seconds, prev?.procCpu.get(pr.pid)),
      }))
      .sort((a, b) => (b.cores ?? 0) - (a.cores ?? 0) || b.rssKb - a.rssKb)
      .slice(0, MAX_PROCESSES)

    this.prev = {
      at,
      userCpu: new Map([...p.userCpu].map(([k, v]) => [k, v.seconds])),
      procCpu: new Map(p.procs.map((pr) => [pr.pid, pr.seconds])),
    }
    this.latest = {
      host: p.host,
      uptimeSeconds: p.uptimeSeconds,
      load: p.load,
      cores: p.cores,
      memory: p.memory,
      disk: p.disk,
      users: userList,
      processes,
      licenses: this.licenses,
      licenseError: this.licenseError,
      licenseMissing: this.licenseMissing,
      updatedAt: at,
    }
    this.onStatus(this.latest)
  }
}
