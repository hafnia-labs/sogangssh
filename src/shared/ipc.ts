// IPC contract shared by main, preload and renderer. Keep this file free of Node or DOM imports.

export const IpcChannel = {
  sshConnect: 'ssh:connect',
  sshDisconnect: 'ssh:disconnect',
  sshStatus: 'ssh:status',
  settingsGetLastLogin: 'settings:getLastLogin',
  terminalOpen: 'terminal:open',
  terminalInput: 'terminal:input',
  terminalResize: 'terminal:resize',
  terminalData: 'terminal:data',
  terminalExit: 'terminal:exit',
  displayStart: 'display:start',
  displayEnd: 'display:end',
  serverGetStatus: 'server:getStatus',
  serverStatus: 'server:status',
  launcherList: 'launcher:list',
  launcherRun: 'launcher:run',
  passwordChange: 'password:change',
  appCloseRequested: 'app:closeRequested',
  appClose: 'app:close',
} as const

/** One user on the server, from login sessions (who) and CPU time (ps). */
export type ServerUser = {
  name: string
  isMe: boolean
  /** Logged-in sessions (terminals, SSH). 0 for users who only have running jobs. */
  sessions: number
  /** Shortest idle time of their sessions: "." = active now, "HH:MM", "old" = over a day. */
  idle: string | null
  /** CPU cores in use since the previous sample; null on the first sample. */
  cores: number | null
}

export type ServerProcess = { pid: number; name: string; cores: number | null; rssKb: number }

export type ServerLicense = { feature: string; used: number; total: number }

/** Live server status for the left panel, refreshed by main while connected. */
export type ServerStatus = {
  host: string
  uptimeSeconds: number
  load: [number, number, number]
  cores: number
  memory: { totalKb: number; availableKb: number }
  /** Home disk: the user's quota, or the whole home filesystem when there is no quota. */
  disk: { kind: 'quota' | 'filesystem'; usedKb: number; limitKb: number } | null
  users: ServerUser[]
  processes: ServerProcess[]
  /** Null until the first license query finishes (or when no launcher defines features). */
  licenses: ServerLicense[] | null
  licenseError?: string
  /** Time of the system sample (ms since epoch). */
  updatedAt: number
}

/** A launcher as the renderer sees it (the command and environment stay in main). */
export type LauncherInfo = { id: string; label: string }

export type LaunchErrorCode = 'notConnected' | 'noDisplay' | 'notFound' | 'exited' | 'failed'

export type LaunchResult = { ok: true } | { ok: false; error: LaunchErrorCode; detail?: string }

export type DisplayErrorCode = 'notConnected' | 'noXvnc' | 'startFailed' | 'timeout'

export type DisplayStartResult =
  | {
      ok: true
      /** Local WebSocket URL for noVNC (127.0.0.1, random port and path token). */
      url: string
      /** One-time VNC password for this session. */
      password: string
      /** X display number on the server, e.g. 23 for DISPLAY=:23. */
      display: number
      /** True when the app reattached to a desktop that was already running. */
      reused: boolean
    }
  | { ok: false; error: DisplayErrorCode; detail?: string }

/** Result of ending the remote desktop and every program on it. */
export type DisplayEndResult =
  | { ok: true }
  /** `detail` is technical output (server stderr), shown as-is; the message comes from `error`. */
  | { ok: false; error: 'notConnected' | 'failed'; detail?: string }

/**
 * Answer to the exit question: keep the remote desktop running for the next login, end it,
 * or stay in the app.
 */
export type CloseChoice = 'keep' | 'end' | 'cancel'

export type TerminalOpenResult =
  | {
      ok: true
      /** Recent output of an already-open shell, so a re-mounted terminal can redraw it. */
      replay: string
    }
  | { ok: false; error: 'notConnected' | 'failed'; detail?: string }

/** Pushed from main when the server shell ends (e.g. the user typed `exit`). */
export type TerminalExit = { code: number | null }

export type PasswordChangeRequest = { current: string; next: string }

export type PasswordChangeErrorCode =
  'notConnected' | 'invalidInput' | 'wrongPassword' | 'rejected' | 'failed'

/**
 * Result of changing the server account password with `passwd`. `detail` is server output
 * (passwords removed), shown as-is: for `rejected` it is the server's reason line.
 */
export type PasswordChangeResult =
  { ok: true } | { ok: false; error: PasswordChangeErrorCode; detail?: string }

/** Server and ID of the last successful login (no password). */
export type LastLogin = { host: string; port: number; username: string }

export type ConnectRequest = {
  host: string
  port: number
  username: string
  password: string
  /**
   * Host key fingerprint the user approved after a `hostKeyUnknown` result.
   * The connection succeeds only if the server still presents this exact key.
   */
  trustFingerprint?: string
}

export type ConnectErrorCode =
  | 'invalidInput'
  | 'hostNotFound'
  | 'connectionRefused'
  | 'timeout'
  | 'authFailed'
  | 'otpRequired'
  | 'hostKeyUnknown'
  | 'hostKeyChanged'
  | 'alreadyConnected'
  | 'unknown'

export type ConnectResult =
  | { ok: true; host: string; port: number; username: string }
  | {
      ok: false
      error: ConnectErrorCode
      /** SHA256 fingerprint the server presented (host key errors only). */
      fingerprint?: string
      /** Fingerprint saved from an earlier connection (`hostKeyChanged` only). */
      savedFingerprint?: string
      /** Technical detail for logs and bug reports; never contains secrets. */
      detail?: string
    }

/** Pushed from main whenever the SSH connection state changes. */
export type SshStatus =
  | { state: 'connected'; host: string; port: number; username: string }
  | { state: 'disconnected'; reason: 'user' | 'closed' | 'error'; detail?: string }
