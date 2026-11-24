import type { Client } from 'ssh2'
import type { LaunchResult } from '../../shared/ipc'
import type { LauncherConfig } from '../launchers'
import type { DisplayEnvironment } from './display'

const LAUNCH_TIMEOUT_MS = 20_000

/** Words allowed in launch scripts: no quotes, spaces, `;`, backticks or other shell syntax. */
const SAFE_WORD = /^[\w@.:/$+-]+$/
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/

/**
 * POSIX sh script that starts one program on the user's desktop, detached (setsid nohup) so it
 * keeps running when the app closes. It is fed to `sh -s` over stdin, which keeps the exec
 * command plain for the csh login shell. Output: `LAUNCHED <pid>`, `RUNNING <pid>` (a copy started
 * by this launcher is already on the desktop; only without `force`) or `ERROR <code> <detail>`.
 */
export function launchScript(
  launcher: LauncherConfig,
  env: DisplayEnvironment,
  force = false,
): string | null {
  const words = [
    ...launcher.command,
    ...Object.values(launcher.env),
    ...launcher.path,
    launcher.cwd,
    env.display,
    env.xauthority,
  ]
  if (launcher.command.length === 0 || !words.every((w) => SAFE_WORD.test(w))) return null
  if (!Object.keys(launcher.env).every((k) => ENV_NAME.test(k))) return null
  if (!/^[\w-]+$/.test(launcher.id)) return null

  const program = launcher.command[0]
  // The kernel's process name (/proc/<pid>/comm) is the file name, cut to 15 characters.
  const processName = (program.split('/').pop() ?? '').slice(0, 15)
  if (!/^[\w.+-]+$/.test(processName)) return null
  const exports = Object.entries(launcher.env).map(([k, v]) => `${k}="${v}"; export ${k}`)
  const log = `$HOME/.sogangssh/session/launch-${launcher.id}.log`
  return [
    'DISPLAY="' + env.display + '"; export DISPLAY',
    'XAUTHORITY="' + env.xauthority + '"; export XAUTHORITY',
    ...exports,
    ...launcher.path.map((p) => `PATH="$PATH:${p}"`),
    'export PATH',
    `command -v ${program} >/dev/null 2>&1 || { echo "ERROR notFound ${program}"; exit 0; }`,
    // One copy per launcher: look for an own process this launcher started on this display.
    ...(force
      ? []
      : [
          'for P in $(ps -u "$(id -u)" -o pid=); do',
          `  [ "$(cat /proc/$P/comm 2>/dev/null)" = "${processName}" ] || continue`,
          `  ENV=$({ tr '\\0' '\\n' < /proc/$P/environ; } 2>/dev/null)`,
          `  printf '%s\\n' "$ENV" | grep -qx "SOGANGSSH_LAUNCHER=${launcher.id}" || continue`,
          `  printf '%s\\n' "$ENV" | grep -qx "DISPLAY=${env.display}" || continue`,
          '  echo "RUNNING $P"',
          '  exit 0',
          'done',
        ]),
    // Marks everything this launch starts, so the check above finds it next time.
    `SOGANGSSH_LAUNCHER=${launcher.id}; export SOGANGSSH_LAUNCHER`,
    `cd "${launcher.cwd}" 2>/dev/null || cd "$HOME"`,
    // A forced second copy must not truncate the log the first copy is still writing.
    `setsid nohup ${launcher.command.join(' ')} ${force ? '>>' : '>'} "${log}" 2>&1 < /dev/null &`,
    'PID=$!',
    // A program that fails at once (missing library, no display) exits within a moment with an
    // error status. Exiting with 0 means it handed off to a background process.
    'sleep 2',
    'if ! kill -0 "$PID" 2>/dev/null; then',
    '  wait "$PID"',
    `  [ $? -eq 0 ] || { echo "ERROR exited $(tail -c 300 "${log}" | tr '\\n' ' ')"; exit 0; }`,
    'fi',
    'echo "LAUNCHED $PID"',
    '',
  ].join('\n')
}

/** Start a launcher's program on the desktop over a short exec channel. */
export function launch(
  client: Client,
  launcher: LauncherConfig,
  env: DisplayEnvironment,
  force = false,
): Promise<LaunchResult> {
  const script = launchScript(launcher, env, force)
  if (!script) return Promise.resolve({ ok: false, error: 'failed', detail: 'Invalid launcher' })

  return new Promise((resolve) => {
    client.exec('sh -s', (err, channel) => {
      if (err) {
        resolve({ ok: false, error: 'failed', detail: err.message })
        return
      }
      let stdout = ''
      let stderr = ''
      const timer = setTimeout(() => {
        channel.close()
        resolve({ ok: false, error: 'failed', detail: 'timeout' })
      }, LAUNCH_TIMEOUT_MS)
      // ssh2 only emits 'close' once stdout has been consumed, so always read it.
      channel.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
      channel.stderr.on('data', (chunk: Buffer) => {
        stderr = (stderr + chunk.toString('utf8')).slice(-1000)
      })
      // An 'error' event without a listener would crash the main process.
      channel.on('error', (e: Error) => {
        clearTimeout(timer)
        resolve({ ok: false, error: 'failed', detail: e.message })
      })
      channel.on('close', () => {
        clearTimeout(timer)
        const line = stdout
          .split('\n')
          .map((l) => l.trim())
          .find((l) => /^(LAUNCHED|RUNNING|ERROR) /.test(l))
        if (line?.startsWith('LAUNCHED')) {
          resolve({ ok: true })
        } else if (line?.startsWith('RUNNING')) {
          resolve({ ok: false, error: 'alreadyRunning' })
        } else if (line) {
          const [, code, ...rest] = line.split(' ')
          const error = code === 'notFound' || code === 'exited' ? code : 'failed'
          resolve({ ok: false, error, detail: rest.join(' ').trim() || undefined })
        } else {
          resolve({ ok: false, error: 'failed', detail: stderr.trim().slice(-300) || undefined })
        }
      })
      channel.end(script)
    })
  })
}
