# sogangSSH — TCAD Remote Desktop App

Follow [DESIGN.md](DESIGN.md) for the product design. Update DESIGN.md first before changing features, stack, screens, or security principles.

## Current stage

- Stage 1 (project skeleton) is done: an empty window with a placeholder screen and a shadcn/ui Button.
- Stage 2 (screen layout mockup) is done: login and main screens (server status | TCAD display | terminal).
- Stage 3 (SSH connection) is implemented: real password / keyboard-interactive login, trust-on-first-use host keys, connection status IPC. Verified 2026-11-20 with a real login on the school server.
- Stage 4 (built-in terminal) is implemented: SSH PTY shell ↔ IPC ↔ xterm.js in the right panel. Tested end to end against a local test SSH server and verified 2026-11-20 on the school server (the shell starts in the user's home; `/` and `/home` cannot be listed there by design).
- Stage 5 (remote display) is implemented: Xvnc session on the server, SSH-tunneled to noVNC in the center panel. Tested end to end against a local fake SSH + RFB server and verified 2026-11-20 on the school server.
- The status bar latency still uses mock data in `src/renderer/src/mocks/session.ts`.
- Stage 6, part 1 (session lifetime) is implemented: one persistent desktop per user with reattach, exit choice (*Keep running* / *End everything*), toolbar "End session", leftover cleanup, 24 h idle limit. Script logic tested in WSL with fake X tools, app flow tested against the local fake SSH server; verified 2026-11-22 on the school server (xterm from the terminal appears on the desktop, survives "Keep running" and a new login, and "End session" leaves no Xvnc or xterm).
- The terminal shell starts with the desktop's `DISPLAY` and `XAUTHORITY`, so `xterm &` or `swb &` typed there appears on the desktop.
- Stage 6, part 2 (app launchers) is implemented: toolbar buttons start Sentaurus Workbench (`swb`) and Visual (`svisual`) on the desktop with the app's own TCAD environment. Launch script tested in WSL with stub programs, buttons tested against the fake SSH server; verified 2026-11-22 on the school server (Workbench and Visual open on the desktop).
- Stage 7 (server status panel) is implemented: live load, memory, quota, users with current CPU use, my processes and Sentaurus license usage. The scripts and the monitor were run against the school server over SSH; the panel was tested in the app with a recorded server sample and verified 2026-11-24 on the school server. Automatic SSH key registration was dropped from the MVP: users enter the password at every login.
- Next: stage 8, packaging.
- The UI design is expected to change through iteration; keep screens easy to restyle.
- Work one stage at a time. Run each stage's "Check" item yourself before moving on.

## Environment

- Node 24 (same major as the Node bundled in Electron 45), npm. `@types/node` is pinned to 24.
- electron-vite 6 + Vite 8, React 19, Tailwind CSS 4 (`@tailwindcss/vite`, no config file; use `@import 'tailwindcss'` in CSS).
- TypeScript 6, ESLint 10 flat config (`eslint.config.mjs`), Prettier (no semicolons, single quotes, 100 columns).
- `eslint-plugin-react` is not installed because it does not support ESLint 10. Only the react-hooks and react-refresh plugins are used.
- Main and preload build as CommonJS (no `"type": "module"`). `electron-store` 12 is ESM-only, so it is bundled into main via `build.externalizeDeps.exclude` in `electron.vite.config.ts`.
- The preload runs sandboxed (`sandbox: true`): it can only require `electron`, so keep it dependency-free.
- `dependencies` holds only packages the main process loads at runtime (ssh2, ws, @electron-toolkit/utils); electron-builder ships these. Everything the renderer uses is bundled by Vite and belongs in `devDependencies`.

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
- Built-in server address: `serverDefaults` in `src/renderer/src/config.ts`. After a successful login, main saves `{host, port, username}` (never the password) and the login screen prefills it next time.

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
- `src/main/remote/display.ts`: uploads the script before every call, runs `attach` / `stop` on short exec channels, and starts the ws bridge (127.0.0.1, random port and path token) that pipes each noVNC WebSocket to `forwardOut` → server `localhost:<port>`. `detach()` closes only the bridge (also on a dropped connection); `end()` runs `stop`. `SESSION_IDLE_LIMIT_S` (24 h) becomes Xvnc `-MaxDisconnectionTime`. `environment` exposes `DISPLAY` and `XAUTHORITY` for launchers.
- Exit choice: `askBeforeQuit()` in `src/main/ipc.ts` cancels window close / app quit while connected and sends `app:closeRequested`; `components/app/ExitDialog.tsx` answers with `app:close` (`keep` / `end` / `cancel`). Toolbar `EndSessionButton.tsx` calls `display:end`.
- Terminal: `ipc.ts` waits for the desktop (`display.waitForEnvironment()`) before opening a new shell, then `shell.ts` runs `env DISPLAY=… XAUTHORITY=… SOGANGSSH_TERMINAL=1 $SHELL -l` on a PTY exec channel (works from csh and sh). `stop` keeps shells marked with `SOGANGSSH_TERMINAL=1`, because csh drops `-l` from its command line. A restarted desktop tries the previous display number first (`~/.sogangssh/display`), so an open terminal's `DISPLAY` stays valid.
- Launchers: built-in list in `src/main/launchers.ts` (`command`, `env`, `path`, `cwd`; values may use `$HOME`/`$PATH` but no other shell syntax). The renderer only gets `{id, label}` (`launcher:list`) and asks main to run one by id (`launcher:run`). `src/main/remote/launch.ts` builds a small sh script (checked word by word) and feeds it to `sh -s` over stdin: it exports `DISPLAY`, `XAUTHORITY` and the launcher env, starts the program with `setsid nohup` (log in `~/.sogangssh/session/launch-<id>.log`), and reports `LAUNCHED <pid>`, `ERROR notFound` or `ERROR exited <log tail>` (non-zero exit within 2 s). Results show as sonner toasts (`components/app/LauncherButtons.tsx`).
- The script can be tested without the school server in WSL with stub `Xvnc` / `vncpasswd` / `metacity` scripts on PATH and a throwaway `HOME`.
- ssh2 channels only emit `close` after their stdout is consumed: always attach a `data` listener.
- `components/app/DisplayPanel.tsx`: noVNC `RFB` (non-shared, so a second PC takes the session over) with the session password, `resizeSession` + `scaleViewport`. noVNC uses top-level await, so it is excluded from Vite dev pre-bundling, and the CSP allows `connect-src ws://127.0.0.1:*`. Types are in `src/renderer/src/novnc.d.ts`.

## Server status panel (stage 7)

- `src/main/remote/status-script.ts`: read-only sh scripts (String.raw, no dollar-brace) streamed to `env SOGANGSSH_MONITOR=1 sh -s`. `STATUS_SCRIPT` prints `host`, `uptime`, `load`, `cores`, `mem`, `quota` / `disk`, `me`, `session <user> <idle>`, `usercpu <user> <cpu s> <procs>`, `proc <pid> <cpu s> <rss kB> <comm>`. `LICENSE_SCRIPT <license file> <features…>` prints `license <feature> <used> <issued>` or `licenseError`.
- `src/main/remote/server-monitor.ts`: runs the status script every 10 s and the license script every 60 s while connected (started and stopped from the connection status in `ipc.ts`), turns two CPU-time samples into cores in use, and pushes `ServerStatus` on `server:status` (`server:getStatus` returns the latest for a re-mounted panel). `components/app/ServerPanel.tsx` renders it.
- Server facts: `ps` has no `times` field here (use `time`, `[DD-]HH:MM:SS`); combining `-o a=,b=` breaks headers, so pass one `-o` per field; user names need `user:32` or they are cut to 8 characters. `who -u` idle is field 5. Quota: `quota -w` (kB, soft limit 9 GB, hard 10 GB for students).
- Licenses: Sentaurus features live on the IDEC server `<port>@<license-server>` (`swb_all`, `sde_all`, `sprocess_all`, `sdevice_all`, `svisual_all`); the second entry `<port>@<license-server>` returns "Invalid returned data". `lmutil` is only shipped with Cadence (`/tools/cadence/IC618/tools.lnx86/bin/lmutil`). `lmstat -a` times out; query each feature with `-f` (about 2 s each). Features per launcher: `licenseFeatures` in `src/main/launchers.ts`.
- The monitor can be tested against the real server without the app: bundle it with `npx rolldown src/main/remote/server-monitor.ts --format cjs` and give it a stand-in client whose `exec` runs the system `ssh` (see `CLAUDE.local.md` for the local read-only access, if present).

## UI (shadcn/ui)

- shadcn/ui, preset `radix-nova` (Radix primitives, Lucide icons, Geist font), base color neutral. Config: `components.json`.
- Import alias `@/` → `src/renderer/src/`. Components in `src/renderer/src/components/ui/`, `cn()` in `src/renderer/src/lib/utils.ts`.
- Theme tokens and Tailwind setup live in `src/renderer/src/assets/main.css`.
- The shadcn CLI cannot detect electron-vite. To add a component, create a temporary `vite.config.ts` at the root with `root: 'src/renderer'` and the `@` alias, run `npx shadcn@latest add <name>`, then delete it.
- The app name is shown with the official Sogang emblem via `components/app/BrandName.tsx` (`assets/brand/sogang-emblem.png`, cropped from the PNG on sogang.ac.kr/ko/symbol/ui). The university's rules forbid altering its shape or colors. The app is for on-campus use only.
- Geist has no Korean glyphs; Korean text currently falls back to the system font.

## Language

- Write all Markdown files in English.
- The app UI supports Korean and English. Never hard-code user-facing strings in components: add the key to `src/renderer/src/i18n/ko.ts` and `en.ts` (the `Messages` type keeps them in sync) and read it with `useI18n().t`.
- Server output (terminal text, file names, commands) is not translated.

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
npm run build:win    Windows NSIS installer (release/)
```

## Rules

- Electron security: `contextIsolation: true`, `nodeIntegration: false`; never use Node APIs directly in the renderer.
- Never leave passwords, private keys, or OTPs in logs, settings files, or commits.
- Do not guess server commands (vncserver, TCAD launch commands, environment script paths). Use only the values recorded under "Server pre-check results" below.

## Server pre-check results

Personal development notes (local keys, account-specific paths, anything about one person's account or history) go in `CLAUDE.local.md`, which is not committed.

- Virtual display: `/usr/bin/Xvnc` and `/usr/bin/Xvfb` exist; `vncserver`, `xpra`, `x11vnc` do not. So the app must start `Xvnc` directly (no `vncserver` wrapper).
- Login shell prints `Command not found.` (csh/tcsh style). Run server commands through `sh -c '…'` instead of relying on bash syntax.
- Server: `<server-host>`, CentOS 7.9, kernel 3.10, nfs-utils 1.3.0. It is mainly a Cadence IC design server (`/tools/cadence`, `/tools/config/*_cdn.cshrc`).
- TCAD: Sentaurus T-2022.03 at `/TOOLS/SYNOPSYS/SENTAURUS/T-2022.03` (uppercase path; `bin/` has `swb`, `sde`, `sdevice`, `sprocess`, `svisual`, `inspect`, `gsub`, `gjob`). The lowercase `/tools/synopsys` is an unrelated, broken NFS automount (`nconnect=4` unsupported on kernel 3.10); ignore it.
- TCAD environment: Sentaurus needs `TCAD_HOME`, PATH (`$TCAD_HOME/bin`), `STDB=$HOME` and `SNPSLMD_LICENSE_FILE="<license-servers>"` (both license ports reachable from the server). Users cannot be assumed to have a personal profile that sets these, so the Sentaurus launchers set them themselves (`src/main/launchers.ts`). Other `*_HOME` variables (ICC, DC, …) are not needed for Sentaurus.
- Available X programs for testing: `xterm`, `metacity`, `mwm`.
- Server address: `<server-address>`, port `<port>` (built-in default in `src/renderer/src/config.ts`). Other users may have a different server or port: they change it under Advanced settings, and the app remembers each user's last successful login (`settings.json` via `src/main/settings.ts`).
- Login: password works, no OTP prompt. Host key: `SHA256:<host-key-fingerprint>`.
- Connection path / VPN off campus: (not checked)
- App name: sogangSSH (appId `com.sogangssh.app`, set in `src/renderer/src/config.ts`, `src/main/index.ts`, `electron-builder.yml`). Repository: public `hafnia-labs/sogangssh` (MIT).
