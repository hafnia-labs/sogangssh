import { app } from 'electron'
import type { AppUpdater, UpdateInfo } from 'electron-updater'
import type { UpdateStatus } from '../shared/ipc'

/** How often the installed app looks for a new release after the check at startup. */
export const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000

type Options = {
  /** Called whenever the status changes (a newer version finished downloading). */
  onStatus: (status: UpdateStatus) => void
  /** Loads electron-updater (replaced in tests). Loaded only in the installed app. */
  load?: () => Promise<AppUpdater>
  /** Short, non-secret log lines. */
  log?: (line: string) => void
}

type ElectronUpdaterModule = { autoUpdater?: AppUpdater; default?: { autoUpdater?: AppUpdater } }

/**
 * The autoUpdater from `import('electron-updater')`. Main is CommonJS, but the bundle keeps the
 * dynamic import, so Node loads this CommonJS package as ESM: its `autoUpdater` is a getter that
 * Node cannot see as a named export, and only `default` (module.exports) has it (B-037).
 */
export function pickAutoUpdater(mod: ElectronUpdaterModule): AppUpdater {
  const updater = mod.autoUpdater ?? mod.default?.autoUpdater
  if (!updater) throw new Error('electron-updater has no autoUpdater')
  return updater
}

const loadElectronUpdater = async (): Promise<AppUpdater> =>
  pickAutoUpdater((await import('electron-updater')) as ElectronUpdaterModule)

const defaultLog = (line: string): void => console.info(`[update] ${line}`)

/** First line of an error, shortened: enough to tell what went wrong, nothing more. */
function describe(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  return text.split('\n')[0].slice(0, 200)
}

/**
 * Keeps the installed app up to date from GitHub Releases (see DESIGN.md "Updates"): checks at
 * startup and every few hours, downloads in the background, and reports a ready version. It never
 * quits the app by itself: `installNow()` is called only after the user chose to restart (and,
 * while connected, answered the exit question). An ignored update installs on a normal quit.
 */
export class Updater {
  private updater: AppUpdater | null = null
  private started = false
  private timer: ReturnType<typeof setInterval> | null = null
  private readyVersion: string | null = null
  private readonly load: () => Promise<AppUpdater>
  private readonly log: (line: string) => void

  constructor(private readonly options: Options) {
    this.load = options.load ?? loadElectronUpdater
    this.log = options.log ?? defaultLog
  }

  get status(): UpdateStatus {
    return { currentVersion: app.getVersion(), readyVersion: this.readyVersion }
  }

  /** True when a downloaded update is waiting to be installed. */
  get isReady(): boolean {
    return this.readyVersion !== null
  }

  /** Start checking. Does nothing in a development run or an unpacked build. */
  async start(): Promise<void> {
    if (!app.isPackaged || this.started) return
    this.started = true
    try {
      this.updater = await this.load()
    } catch (error) {
      this.log(`not available: ${describe(error)}`)
      return
    }
    const updater = this.updater
    // Our own short lines replace electron-updater's verbose log.
    updater.logger = null
    // Releases are GitHub pre-releases for now.
    updater.allowPrerelease = true
    updater.autoDownload = true
    updater.autoInstallOnAppQuit = true
    updater.on('update-available', (info: UpdateInfo) => this.log(`downloading ${info.version}`))
    updater.on('update-downloaded', (info: UpdateInfo) => {
      this.log(`ready ${info.version}`)
      this.readyVersion = info.version
      this.options.onStatus(this.status)
    })
    // No network, no release, a failed hash check: try again at the next check.
    updater.on('error', (error: unknown) => this.log(`failed: ${describe(error)}`))

    void this.check()
    this.timer = setInterval(() => void this.check(), CHECK_INTERVAL_MS)
    this.timer.unref?.()
  }

  private async check(): Promise<void> {
    // Once one is downloaded, wait for the restart instead of fetching more.
    if (!this.updater || this.readyVersion) return
    try {
      await this.updater.checkForUpdates()
    } catch (error) {
      this.log(`check failed: ${describe(error)}`)
    }
  }

  /**
   * Quit, install the downloaded update silently and start the new version. Call only once the
   * quit is allowed (the exit question was answered or there is no connection).
   */
  installNow(): boolean {
    if (!this.updater || !this.readyVersion) return false
    this.updater.quitAndInstall(true, true)
    return true
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }
}
