import type { Client } from 'ssh2'
import { exec } from './exec'

const READ_TIMEOUT_MS = 15_000

/**
 * A license file list: `port@host` entries (or paths), separated by `:` (several servers) or `,`
 * (a redundant triad). No shell syntax: `$` and `~` are refused on purpose, since nothing would
 * expand them. A leading `-` is refused too, so it can never be read as an option.
 */
const SAFE_LICENSE = /^[\w@.,:/+-]+$/

/**
 * Reads `SNPSLMD_LICENSE_FILE` from the user's own `~/.bash_profile`, the csh file every account
 * is given at creation. First it is sourced by csh exactly as users do by hand (with no input, so
 * a profile that reads input cannot swallow this script), and only the one variable is printed.
 * If that prints nothing, for example because a line the user added stops csh before the license
 * line (the last one) or csh hangs (it is stopped after 5 s), the
 * `setenv SNPSLMD_LICENSE_FILE <value>` line is read from the file itself. The file is never
 * changed. Run through `sh -s`, so the command stays plain for the csh login shell. Output ends
 * with `LICENSE <value>` (empty when not set).
 */
const READ_SCRIPT = String.raw`v=$(timeout 5 csh -f -c 'source ~/.bash_profile >& /dev/null; printenv SNPSLMD_LICENSE_FILE' < /dev/null 2>/dev/null | tail -n 1)
if [ -z "$v" ] && [ -r "$HOME/.bash_profile" ]; then
  v=$(sed -n 's/^[[:space:]]*setenv[[:space:]][[:space:]]*SNPSLMD_LICENSE_FILE[[:space:]][[:space:]]*//p' "$HOME/.bash_profile" | tail -n 1 | sed 's/[#;].*//' | tr -d "\"' \t\r")
fi
printf 'LICENSE %s\n' "$v"
`

export type LicenseRead =
  | { ok: true; value: string }
  /** `notSet`: nothing usable in the profile. `failed`: the read itself failed (try again). */
  | { ok: false; reason: 'notSet' | 'failed'; detail?: string }

/** Parse the read script's output: the last `LICENSE` line (a profile may print its own lines). */
export function parseLicenseOutput(stdout: string): LicenseRead {
  const lines = stdout
    .split('\n')
    .map((l) => l.replace(/\r$/, ''))
    .filter((l) => /^LICENSE( |$)/.test(l))
  if (lines.length === 0) return { ok: false, reason: 'failed', detail: 'no output' }
  const value = lines[lines.length - 1].slice('LICENSE'.length).trim()
  if (!value || value.startsWith('-') || !SAFE_LICENSE.test(value)) {
    return { ok: false, reason: 'notSet' }
  }
  return { ok: true, value }
}

/**
 * The license setting of the current connection, kept in memory only: never written to disk,
 * forgotten on logout, on a dropped connection and when the app quits. Only a successful read is
 * kept, so a failed one is tried again at the next use.
 */
export class LicenseSetting {
  private client: Client | null = null
  private value: Promise<LicenseRead> | null = null

  /** The setting for this connection, reading it on first use. */
  get(client: Client): Promise<LicenseRead> {
    if (this.client === client && this.value) return this.value
    this.client = client
    const reading = this.read(client)
    this.value = reading
    // Forget an unsuccessful read so the next use tries again.
    void reading.then((r) => {
      if (!r.ok && this.value === reading) this.value = null
    })
    return reading
  }

  forget(): void {
    this.client = null
    this.value = null
  }

  private async read(client: Client): Promise<LicenseRead> {
    const r = await exec(client, 'sh -s', READ_TIMEOUT_MS, READ_SCRIPT)
    if (r.error) return { ok: false, reason: 'failed', detail: r.error }
    return parseLicenseOutput(r.stdout)
  }
}
