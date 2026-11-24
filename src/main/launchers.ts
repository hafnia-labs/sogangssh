// Built-in app launchers. Commands and paths come only from "Server pre-check results" in
// CLAUDE.md (checked on the school server); never guess them.
//
// Values may use $HOME and $PATH (expanded by sh on the server) but no quotes, spaces or other
// shell syntax: they are checked by SAFE_WORD before being written into the launch script.

export type LauncherConfig = {
  id: string
  label: string
  /** Program and arguments, run on the session's display. */
  command: string[]
  /** Environment for the program, so users do not need a personal profile. */
  env: Record<string, string>
  /** Directories appended to PATH. */
  path: string[]
  /** Working directory. */
  cwd: string
  /**
   * License features to show in the server panel (names as listed by `lmstat`). A launcher with
   * features also gets the user's `SNPSLMD_LICENSE_FILE` (see `remote/license-setting.ts`).
   */
  licenseFeatures?: string[]
}

const SENTAURUS_HOME = '/TOOLS/SYNOPSYS/SENTAURUS/T-2022.03'

const sentaurus = {
  env: {
    TCAD_HOME: SENTAURUS_HOME,
    // Sentaurus Workbench keeps its projects under STDB.
    STDB: '$HOME',
  },
  path: [`${SENTAURUS_HOME}/bin`],
  cwd: '$HOME',
}

export const launchers: LauncherConfig[] = [
  {
    id: 'sentaurus-workbench',
    label: 'Workbench',
    command: ['swb'],
    ...sentaurus,
    // Workbench itself plus the simulators it runs (checked with lmstat on the IDEC server).
    licenseFeatures: ['swb_all', 'sde_all', 'sprocess_all', 'sdevice_all'],
  },
  {
    id: 'sentaurus-visual',
    label: 'Visual',
    command: ['svisual'],
    ...sentaurus,
    licenseFeatures: ['svisual_all'],
  },
]
