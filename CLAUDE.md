# sogangSSH — TCAD Remote Desktop App

Follow [DESIGN.md](DESIGN.md) for the product design. Update DESIGN.md first before changing features, stack, screens, or security principles.

## Current stage

- Stage 1 (project skeleton) is done: an empty window with a placeholder screen and a shadcn/ui Button.
- Stage 2 (screen layout mockup) is done: login and main screens (server status | TCAD display | terminal).
- Stage 3 (SSH connection) is implemented: real password / keyboard-interactive login, trust-on-first-use host keys, connection status IPC. Verified 2026-11-20 with a real login on the school server.
- Stage 4 (built-in terminal) is implemented: SSH PTY shell ↔ IPC ↔ xterm.js in the right panel. Tested end to end against a local test SSH server and verified 2026-11-20 on the school server (the shell starts in the user's home; `/` and `/home` cannot be listed there by design).
- Stage 5 (remote display) is implemented: Xvnc session on the server, SSH-tunneled to noVNC in the center panel. Tested end to end against a local fake SSH + RFB server and verified 2026-11-20 on the school server.
- The status bar shows only user@server and the display; the placeholder latency was removed (real measurement is listed under "After the MVP" in DESIGN.md).
- Stage 6, part 1 (session lifetime) is implemented: one persistent desktop per user with reattach, exit choice (*Keep running* / *End everything*), toolbar "End session", leftover cleanup, 24 h idle limit. Script logic tested in WSL with fake X tools, app flow tested against the local fake SSH server; verified 2026-11-22 on the school server (xterm from the terminal appears on the desktop, survives "Keep running" and a new login, and "End session" leaves no Xvnc or xterm).
- The terminal shell starts with the desktop's `DISPLAY` and `XAUTHORITY`, so `xterm &` or `swb &` typed there appears on the desktop.
- Stage 6, part 2 (app launchers) is implemented: toolbar buttons start Sentaurus Workbench (`swb`) and Visual (`svisual`) on the desktop with the app's own TCAD environment. Launch script tested in WSL with stub programs, buttons tested against the fake SSH server; verified 2026-11-22 on the school server (Workbench and Visual open on the desktop).
- Stage 7 (server status panel) is implemented: live load, memory, quota, users with current CPU use, my processes and Sentaurus license usage. The scripts and the monitor were run against the school server over SSH; the panel was tested in the app with a recorded server sample and verified 2026-11-24 on the school server. Automatic SSH key registration was dropped from the MVP: users enter the password at every login.
- Password change (added after stage 7): toolbar button changes the server account password with `passwd`; the login screen tells users who forgot their password to ask the administrator. Tested against the local fake SSH server; not yet run on the school server (that would change a real password).
- Added after stage 7: first-login change of an expired initial password (tested against a fake forced-change server, not yet with a real new account); the license servers are read from each user's `~/.bash_profile` (tested read-only on the school server); one copy per launcher; the guide character 서강이.
- Stage 8 (packaging), part 1: Windows NSIS installer built with `npm run build:win` and published as the GitHub pre-release `v0.1.0` with Korean release notes. The release was rebuilt once to drop the placeholder latency from the status bar; its tag now points at the commit that records this. The installer and the packed app were checked for server details (none) and the built app started to an empty login screen. Not yet installed and run on another PC, which is stage 8's check.
- Automatic updates (added after stage 8, part 1): electron-updater with GitHub Releases, see "Updates" below. Unit-tested with mocked Electron and electron-updater, integration-tested against the fake server, and checked end to end 2026-11-25 with real installed test builds served from a local HTTP server (detect, background download, notice, restart while connected through the exit question, cancel, install on quit without restart). Not yet run against a real GitHub release.
- Next (stage 8, part 2): try the installer on another PC, an app icon, a macOS build through GitHub Actions, and the install guide page. Before every release, go through section 3 of `SECURITY-CHECKLIST.md` and delete old `release/` builds first.
- Automated bug checks, stage 1 (added after stage 8, part 1): Vitest unit tests in `tests/unit` and the bug catalog `BUGS.md`.
- Automated bug checks, stage 2: a local fake school server (`tests/fake-server/`, SSH + RFB) and integration tests (`tests/integration/`) that run main's real modules against it. Old bugs were put back one at a time to check that the matching test fails. They found B-036 (ssh2 throws on a just-dropped connection), since fixed at every call site. Next: stage 3 Playwright e2e (the fake server also runs standalone for it), stage 4 shell scripts on Linux, stage 5 GitHub Actions (server-detail patterns from a CI secret).
- The UI design is expected to change through iteration; keep screens easy to restyle.
- Work one stage at a time. Run each stage's "Check" item yourself before moving on.

## Environment

- Node 24 (same major as the Node bundled in Electron 45), npm. `@types/node` is pinned to 24.
- electron-vite 6 + Vite 8, React 19, Tailwind CSS 4 (`@tailwindcss/vite`, no config file; use `@import 'tailwindcss'` in CSS).
- TypeScript 6, ESLint 10 flat config (`eslint.config.mjs`), Prettier (no semicolons, single quotes, 100 columns).
- `eslint-plugin-react` is not installed because it does not support ESLint 10. Only the react-hooks and react-refresh plugins are used.
- Main and preload build as CommonJS (no `"type": "module"`). `electron-store` 12 is ESM-only, so it is bundled into main via `build.externalizeDeps.exclude` in `electron.vite.config.ts`.
- The preload runs sandboxed (`sandbox: true`): it can only require `electron`, so keep it dependency-free.
- `dependencies` holds only packages the main process loads at runtime (ssh2, ws, @electron-toolkit/utils, electron-updater); electron-builder ships these. Everything the renderer uses is bundled by Vite and belongs in `devDependencies`.

## SSH (main process)

- `src/shared/ipc.ts` is the IPC contract (channel names, `ConnectRequest`, `ConnectResult`, `SshStatus`). Preload exposes it as `window.api.ssh`.
- `src/main/ssh/connection.ts` owns the single ssh2 connection. Login tries password, then keyboard-interactive, answering only password prompts; any other prompt (OTP) fails as `otpRequired`.
- Host keys: `src/main/ssh/known-hosts.ts` (electron-store, `known-hosts.json` in the app data folder). Unknown key → `hostKeyUnknown` + fingerprint → the renderer asks the user → reconnect with `trustFingerprint`. The key is saved only after login succeeds. Changed key → `hostKeyChanged`, blocked.
- `src/main/ipc.ts` registers handlers and rejects IPC from senders other than the app's own pages.
- The password exists only for the handshake: never store, log, or send it anywhere else.
- Error paths can be tested without a real account against public hosts (e.g. `github.com:22` gives `hostKeyUnknown`, then `authFailed`).
- Terminal: `src/main/ssh/shell.ts` opens one `xterm-256color` PTY shell per connection and keeps the last 64 KB of output so a re-mounted terminal can redraw it. Input and resize use fire-and-forget `ipcRenderer.send`; output arrives on `terminal:data`. The shell resets when the connection drops.
- `components/app/TerminalPanel.tsx`: xterm.js + fit addon, resizes the PTY with the panel (skipped while collapsed). Ctrl+C copies when text is selected (otherwise it interrupts), Ctrl+V pastes. After `exit` it offers to open a new shell.
- For end-to-end tests without a real account, run a local ssh2 `Server` with a fake shell and drive the app over CDP (`electron . --remote-debugging-port=… --user-data-dir=<temp>`), so the user's own app data is untouched.
- Password change: `src/main/ssh/password.ts` runs `env LC_ALL=C passwd` on an exec channel with a PTY (`--stdin` is root-only) and answers prompts by text: `(current) UNIX password:`, `New password:`, `Retype new password:` (checked on the school server: passwd 0.79, PAM 1.1.8, `pam_pwquality retry=3`, local accounts in `/etc/shadow`, no faillock). A second `New password:` means the server rejected it: the app sends Ctrl+C and returns the `BAD PASSWORD:` line. Passwords with control characters are refused (a newline would answer the next prompt). UI: `components/app/ChangePasswordButton.tsx`.
- No built-in server and no saved logins: the login screen starts empty and the user types the server address, port, ID and password every time. Only trusted host key fingerprints are stored.

## Remote display (stages 5 and 6)

Decisions from the school server check (TigerVNC 1.8.0, csh login shell):

- No `vncserver` wrapper, so the app starts `Xvnc` itself.
- No `rfbunixpath` (TigerVNC 1.10+), so Xvnc listens on `-localhost` only and requires a fresh random VNC password (`VncAuth`, via `vncpasswd -f`). The X display requires a cookie (`xauth` + `mcookie`, private Xauthority). Other users on the shared server cannot view or type into the session.
- `-displayfd` exists, but the script picks a free display itself (from :20, skipping `/tmp/.X<N>-lock` and sockets) so the VNC port (5900+N) is known for sure.
- Window manager: `metacity`, falling back to `mwm`.
- csh login shell: exec commands stay plain words. The script is streamed over stdin into `~/.sogangssh/display.sh` and run with `sh`.

How it works:

- The desktop is persistent: one per user, kept in `~/.sogangssh/session/` and independent of the app (see DESIGN.md "Session lifetime"). Never go back to a design that creates a new desktop or password per app launch.
- `src/main/remote/display-script.ts`: the POSIX sh script (embedded with `String.raw`, so it must never contain a dollar sign followed by an opening brace). Modes: `attach W H IDLE` prints `READY display= port= password= xauthority= reused=0|1` (reusing a live Xvnc, otherwise cleaning leftovers and starting one detached with `setsid nohup`); `stop` prints `STOPPED` after stopping every own process with `DISPLAY=:N` (except login shells) and Xvnc. Errors print `ERROR <code> <detail>`. `flock` serializes calls; background programs get `9>&-` so they never keep the lock. Secrets never go on a command line (other users can read `ps` here; `/proc` has no `hidepid`): the VNC password goes to `vncpasswd` and the X cookie to `xauth source -` over stdin.
- `src/main/remote/display.ts`: uploads the script before every call, runs `attach` / `stop` on short exec channels, and starts the ws bridge (127.0.0.1, random port and path token) that pipes each noVNC WebSocket to `forwardOut` → server `localhost:<port>`. `detach()` closes only the bridge (also on a dropped connection) and bumps a generation counter, so a start still running on the old connection is discarded instead of becoming the session; `RemoteShell.reset()` does the same for a shell that is still opening, and the IPC handlers re-check `ssh.activeClient` after waiting for the desktop. `end()` runs `stop`. `SESSION_IDLE_LIMIT_S` (24 h) becomes Xvnc `-MaxDisconnectionTime`. `environment` exposes `DISPLAY` and `XAUTHORITY` for launchers.
- Exit choice: `askBeforeQuit()` in `src/main/ipc.ts` cancels window close / app quit while connected and sends `app:closeRequested`; `components/app/ExitDialog.tsx` answers with `app:close` (`keep` / `end` / `cancel`). Toolbar `EndSessionButton.tsx` calls `display:end`.
- Terminal: `ipc.ts` waits for the desktop (`display.waitForEnvironment()`) before opening a new shell, then `shell.ts` runs `env DISPLAY=… XAUTHORITY=… SOGANGSSH_TERMINAL=1 $SHELL -l` on a PTY exec channel (works from csh and sh). `stop` keeps only the topmost process marked with `SOGANGSSH_TERMINAL=1` (its parent has no marker), because csh drops `-l` from its command line; anything started from the terminal inherits the marker and is stopped. A restarted desktop tries the previous display number first (`~/.sogangssh/display`), so an open terminal's `DISPLAY` stays valid.
- Launchers: built-in list in `src/main/launchers.ts` (`command`, `env`, `path`, `cwd`; values may use `$HOME`/`$PATH` but no other shell syntax). The renderer only gets `{id, label}` (`launcher:list`) and asks main to run one by id (`launcher:run`). `src/main/remote/launch.ts` builds a small sh script (checked word by word) and feeds it to `sh -s` over stdin: it exports `DISPLAY`, `XAUTHORITY` and the launcher env, starts the program with `setsid nohup` (log in `~/.sogangssh/session/launch-<id>.log`), and reports `LAUNCHED <pid>`, `ERROR notFound` or `ERROR exited <log tail>` (non-zero exit within 2 s). Results show as sonner toasts (`components/app/LauncherButtons.tsx`).
- One copy per launcher: launched programs get `SOGANGSSH_LAUNCHER=<id>`. Unless `launcher:run` is called with `force`, the script first looks for an own process whose `/proc/<pid>/comm` is the program name and whose environ has that marker and the same `DISPLAY`, and prints `RUNNING <pid>` (→ `alreadyRunning`, a toast with _Open another_). Checked on the server: `swb` and `svisual` both keep a process with that name while open (`svisual` is a bash wrapper waiting on `svisual_exec`), and the `swblm` helper has another name. A forced copy appends to the log (`>>`).
- The script can be tested without the school server in WSL with stub `Xvnc` / `vncpasswd` / `metacity` scripts on PATH and a throwaway `HOME`.
- ssh2 channels only emit `close` after their stdout is consumed: always attach a `data` listener.
- Clipboard (see DESIGN.md "Clipboard"): `DisplayPanel.tsx` holds back Ctrl+V, Ctrl+Shift+V and Shift+Insert in the capture phase, asks main for the PC clipboard (`clipboard:readText`; Electron 45's `clipboard` API is asynchronous, never put its Promise in a sync IPC reply), sends it with `clipboardPasteFrom`, then sends the key. It wraps `rfb.sendKey` to know which keys the server holds, and presses Ctrl/Shift only when the server lacks them (on Windows noVNC delays a Ctrl press to tell it from AltGr). Text copied on the desktop arrives as the noVNC `clipboard` event and goes to main (`clipboard:writeText`); one echo of the last paste is skipped. Xvnc runs with `-SendPrimary=0`. The server's TigerVNC 1.8 clipboard is Latin-1 only. Verified 2026-11-25: Xvnc flags and gedit paste/copy on the school server; the real app against a local fake SSH + RFB server (fast and slow Ctrl+V with the Windows clipboard, copy back, echo, close while connected).
- `components/app/DisplayPanel.tsx`: noVNC `RFB` (non-shared, so a second PC takes the session over) with the session password, `resizeSession` + `scaleViewport`. noVNC uses top-level await, so it is excluded from Vite dev pre-bundling, and the CSP allows `connect-src ws://127.0.0.1:*`. Types are in `src/renderer/src/novnc.d.ts`.

## Server status panel (stage 7)

- `src/main/remote/status-script.ts`: read-only sh scripts (String.raw, no dollar-brace) streamed to `env SOGANGSSH_MONITOR=1 sh -s`. `STATUS_SCRIPT` prints `host`, `uptime`, `load`, `cores`, `mem`, `quota` / `disk`, `me`, `session <user> <idle>`, `usercpu <user> <cpu s> <procs>`, `proc <pid> <cpu s> <rss kB> <comm>`. `LICENSE_SCRIPT <license file> <features…>` prints `license <feature> <used> <issued>` or `licenseError`.
- `src/main/remote/server-monitor.ts`: runs the status script every 10 s and the license script every 60 s while connected (started and stopped from the connection status in `ipc.ts`), turns two CPU-time samples into cores in use, and pushes `ServerStatus` on `server:status` (`server:getStatus` returns the latest for a re-mounted panel). `components/app/ServerPanel.tsx` renders it.
- Server facts: `ps` has no `times` field here (use `time`, `[DD-]HH:MM:SS`); combining `-o a=,b=` breaks headers, so pass one `-o` per field; user names need `user:32` or they are cut to 8 characters. `who -u` idle is field 5. Quota: `quota -w` (kB, soft limit 9 GB, hard 10 GB for students).
- Licenses: the license servers are read after login from the user's own `~/.bash_profile` (`src/main/remote/license-setting.ts`, see DESIGN.md "License setting"), kept in memory for that connection only, and passed to launchers and the license query. Sentaurus features (`swb_all`, `sde_all`, `sprocess_all`, `sdevice_all`, `svisual_all`) live on the first entry (the IDEC server); the second entry returns "Invalid returned data". `lmutil` is only shipped with Cadence (`/tools/cadence/IC618/tools.lnx86/bin/lmutil`). `lmstat -a` times out; query each feature with `-f` (about 2 s each). Features per launcher: `licenseFeatures` in `src/main/launchers.ts`.
- The monitor can be tested against the real server without the app: bundle it with `npx rolldown src/main/remote/server-monitor.ts --format cjs` and give it a stand-in client whose `exec` runs the system `ssh` (see `CLAUDE.local.md` for the local read-only access, if present).

## Updates

- See DESIGN.md "Updates". `src/main/updater.ts` wraps electron-updater: it does nothing unless `app.isPackaged`, loads `electron-updater` lazily, allows pre-releases, checks at startup and every 4 h, logs only short non-secret lines (`[update] …`), and pushes `UpdateStatus` (`currentVersion`, `readyVersion`) on `update:status` (`update:getStatus` for a re-mounted renderer).
- `update:restart` (`restartForUpdate()` in `src/main/ipc.ts`) never quits directly: it marks the quit as an update restart and asks `askBeforeQuit('update')`. While connected the renderer's `ExitDialog` shows the restart wording; only after *Keep running* / *End everything* does `finishQuit()` call `quitAndInstall(true, true)` (silent install, start again). *Cancel* sends `app:close` `cancel`, which clears the mark. Not connected: it installs at once. An ignored update installs on a normal quit (`autoInstallOnAppQuit`).
- `electron-builder.yml` has `publish: github` (`hafnia-labs/sogangssh`), so builds write `latest.yml` + `.blockmap` and the packaged app gets `resources/app-update.yml`. The build scripts pass `--publish never`: nothing is uploaded from this PC.
- Release rule: bump `version` in `package.json` for every release, never replace an existing release's files, and attach the installer (`sogangSSH-Setup-<version>.exe`, named to match `latest.yml`; B-038) + `latest.yml` + `.blockmap`, unrenamed, from the same `release/<version>/` folder to a new release tagged `v<version>` (`SECURITY-CHECKLIST.md` section 3).
- Local end-to-end check without GitHub: build with `-c.extraMetadata.version=…` and `-c.publish.provider=generic -c.publish.url=http://127.0.0.1:<port>/` (plus a separate `appId`, `productName` and `extraMetadata.name` so it never touches an installed real copy) into a scratch folder, serve the newer build's folder over HTTP, install the older one with `/S`, and uninstall it afterwards.

## Testing

- `npm test` runs the Vitest unit tests in `tests/unit/**/*.test.ts` and the integration tests in `tests/integration/**/*.test.ts` together (Node environment, `@` alias as in the renderer, config `vitest.config.ts`, type-checked through `tsconfig.test.json`; about 7 s). They never contact the school server and do not start the app.
- `tests/unit/helpers/fake-ssh.ts` stands in for ssh2 clients and channels; each test scripts the server's answers. Use made-up hosts (`*.example`) and accounts in tests, never real server details.
- Fake school server (`tests/fake-server/`): `startFakeServer()` starts an ssh2 `Server` and a minimal RFB server on random 127.0.0.1 ports with the test-only account `tester` / `test-only-pw-1` and a fresh ECDSA host key (`ssh.fingerprint`). It answers the app's own commands out of the box (login probe, display script upload / `attach` / `stop` with a `READY` line pointing at the RFB port, license read, launcher with one copy per launcher, status panel, `passwd`, the terminal's login shell). Each test can add rules first: `onExec(match, reply)` with stdout / stderr / exit code, `'hang'`, `'close'` (no exit status) or `'drop'` (cut the connection); `onExecProgram` for PTY programs; `rejectExec`; `onForward` to accept, refuse, close or hold a forward. Accounts can be expired (sshd runs `passwd` instead of every command; English or Korean), keyboard-only, or ask extra prompts (OTP, a new password during login). It records execs (command, stdin, PTY, env), keyboard-interactive answers, `passwd` answers, forwards and open channels; the RFB side records keys and clipboard texts and can send clipboard text.
- The fake server runs on its own for e2e tests: `node tests/fake-server/start.ts [--ssh-port N] [--rfb-port N] [--control-port N]` prints one JSON line with the ports, account and fingerprint (Node 24 type stripping: erasable syntax only, imports with `.ts` extensions; the control port serves `/log`, `/clear`, `/cut?text=`).
- Integration tests replace only `electron` (`vi.mock('electron', () => import('./helpers/electron'))`: known hosts go to a temporary folder, IPC handlers are kept so `ipc.test.ts` can call them) and, where `app-page.ts` is loaded, `@electron-toolkit/utils`. `electron-store` is inlined in `vitest.config.ts` so the mock reaches it. Timeouts of 15-30 s are tested with fake `setTimeout` installed after the login (`helpers/util.ts` waits with the real one). Every test file closes its server and connections in `afterEach`.
- ssh2 server quirks: a `Session` never emits `close` (count the exec / shell / forward channels), a server channel emits `close` only after its readable side ended (`resume()` before `close()`), and `stderr` can already be ended when the connection goes away.
- To test code inside a component or a module that needs Electron, move the pure part into a small module with no change in behavior (for example `components/app/paste-keys.ts`, `ssh/login-prompts.ts`).
- `BUGS.md` catalogs every bug fixed so far (`B-001`…), with the test that guards it or the later stage that will.
- Rule: every bug fix adds a `BUGS.md` entry and a test that would have caught it (name the bug ID in the test). If no automated test can reach it yet, the entry says which stage will cover it or that it is checked by hand.

## UI (shadcn/ui)

- shadcn/ui, preset `radix-nova` (Radix primitives, Lucide icons, Geist font), base color neutral. Config: `components.json`.
- Import alias `@/` → `src/renderer/src/`. Components in `src/renderer/src/components/ui/`, `cn()` in `src/renderer/src/lib/utils.ts`.
- Theme tokens and Tailwind setup live in `src/renderer/src/assets/main.css`.
- The shadcn CLI cannot detect electron-vite. To add a component, create a temporary `vite.config.ts` at the root with `root: 'src/renderer'` and the `@` alias, run `npx shadcn@latest add <name>`, then delete it.
- The app name is shown with the official Sogang emblem via `components/app/BrandName.tsx` (`assets/brand/sogang-emblem.png`, cropped from the PNG on sogang.ac.kr/ko/symbol/ui). The university's rules forbid altering its shape or colors. The app is for on-campus use only.
- Geist has no Korean glyphs; Korean text currently falls back to the system font.

## Language

- Write all Markdown files in English. The one exception is the user-facing README: `README.md` is Korean, so it is the first page on GitHub, and `README.en.md` is the English version. Keep the two in sync.
- The app UI supports Korean and English. Never hard-code user-facing strings in components: add the key to `src/renderer/src/i18n/ko.ts` and `en.ts` (the `Messages` type keeps them in sync) and read it with `useI18n().t`.
- Server output (terminal text, file names, commands) is not translated.

## Visual explanations

When the user asks to visualize something ("시각화", "visually explain", "show it"), build an interactive 3D Artifact rather than a flat diagram:

- A three.js scene (UMD build from cdnjs, OrbitControls from jsDelivr) with each machine as a 3D object: server racks with blinking LEDs for servers, a monitor for the student PC, a laptop for the developer PC, a box for an installer, a floating sheet for a file, a chip for app memory. Label each with an HTML tag projected from 3D.
- Show data flow as a glowing packet that travels along curved paths one step at a time, with a tag naming what it carries, the active path highlighted, and a caption per step. Color by meaning (risk, safe, normal), consistently.
- Add controls: a toggle between alternatives (e.g. now / after), previous / next step, pause, and drag to rotate and zoom. Respect reduced motion and both light and dark themes.
- Keep a short written explanation and a comparison table under the scene, in Korean.
- Never put server details (addresses, ports, host names, license servers) into it; mask them.
- Keep the source in `report4me/visuals/<name>.html` (`report4me/` is excluded locally in `.git/info/exclude`, never pushed) and pin the artifact in the claude.ai sidebar. To update an existing visual, edit that file and publish it with the artifact's `url`, so the link stays the same. Existing: `license-flow.html` → https://claude.ai/artifact/8FxkeCu3KnpHj9TWzWWk1V

## Directory layout

```
src/main/       Electron main: ssh2 connection, port forwarding, ws bridge, IPC handlers
src/preload/    Expose only the needed IPC through contextBridge (+ index.d.ts types)
src/renderer/   React UI: login, xterm.js terminal, noVNC display (index.html, src/main.tsx, src/App.tsx)
src/shared/     Types shared by main and renderer (IPC channel names, connection state, etc.)
resources/      Runtime resources (icons, etc.)
build/          electron-builder build resources (installer icons, etc.)
```

## Commands

```
npm run dev          Run in development (hot reload)
npm run typecheck    Type-check main/preload and renderer
npm run lint         ESLint
npm run format       Prettier
npm test             Vitest unit tests (tests/unit)
npm run build:win    Windows NSIS installer (release/)
```

## Rules

- Electron security: `contextIsolation: true`, `nodeIntegration: false`; never use Node APIs directly in the renderer.
- Never leave passwords, private keys, or OTPs in logs, settings files, or commits.
- The repository is public: never commit server details (addresses, ports, host names, host key fingerprints, license servers, account names), not even in commit messages. Keep them in the git-ignored `CLAUDE.local.md`; the app needs none at build time. Before committing, check the diff and the message for them.
- Follow [SECURITY-CHECKLIST.md](SECURITY-CHECKLIST.md): section 1 before every commit, section 2 when adding or changing a feature, section 3 before a release, section 4 when testing on the school server.
- Do not guess server commands (vncserver, TCAD launch commands, environment script paths). Use only the values recorded under "Server pre-check results" below.

## Server pre-check results

Personal development notes (local keys, account-specific paths, anything about one person's account or history) go in `CLAUDE.local.md`, which is not committed.

- Virtual display: `/usr/bin/Xvnc` and `/usr/bin/Xvfb` exist; `vncserver`, `xpra`, `x11vnc` do not. So the app must start `Xvnc` directly (no `vncserver` wrapper).
- Login shell prints `Command not found.` (csh/tcsh style). Run server commands through `sh -c '…'` instead of relying on bash syntax.
- Server: the school server (host name in `CLAUDE.local.md`), CentOS 7.9, kernel 3.10, nfs-utils 1.3.0. It is mainly a Cadence IC design server (`/tools/cadence`, `/tools/config/*_cdn.cshrc`).
- TCAD: Sentaurus T-2022.03 at `/TOOLS/SYNOPSYS/SENTAURUS/T-2022.03` (uppercase path; `bin/` has `swb`, `sde`, `sdevice`, `sprocess`, `svisual`, `inspect`, `gsub`, `gjob`). The lowercase `/tools/synopsys` is an unrelated, broken NFS automount (`nconnect=4` unsupported on kernel 3.10); ignore it.
- TCAD environment: Sentaurus needs `TCAD_HOME`, PATH (`$TCAD_HOME/bin`), `STDB=$HOME` and `SNPSLMD_LICENSE_FILE` (two license servers, both reachable from the server). The launchers set the fixed ones themselves (`src/main/launchers.ts`); `SNPSLMD_LICENSE_FILE` comes from the `~/.bash_profile` that every account is given at creation (csh syntax; it also sets the other Synopsys tools). Other `*_HOME` variables (ICC, DC, …) are not needed for Sentaurus.
- Available X programs for testing: `xterm`, `metacity`, `mwm`.
- Server address and port: not in the repository. Users type them at every login; for development they are in `CLAUDE.local.md` (with the host key fingerprint and license servers).
- Login: password works, no OTP prompt.
- Connection path / VPN off campus: (not checked)
- App name: sogangSSH (appId `com.sogangssh.app`, set in `src/renderer/src/config.ts`, `src/main/index.ts`, `electron-builder.yml`). Repository: public `hafnia-labs/sogangssh` (MIT).
