# sogangSSH — Product Design

Date: 2026-11-20

## Overview

A desktop app for working on the school's Linux server without terminal knowledge. One app shows a server terminal and a remote desktop where any installed GUI program can run. Programs run only on the server; the app only displays the screen and forwards input.

Frequently used programs are offered as **launchers** (one-click buttons). Sentaurus TCAD is the first built-in launcher; others (for example Cadence) can be added once their launch commands are checked on the server.

There are three goals.

- Double-click the installer, enter an ID and password, and the terminal and remote desktop open; one button starts TCAD.
- No separate programs such as PowerShell, VS Code, OpenSSH, an X server, or Xmanager are needed.
- Faster than X11 forwarding, showing exactly the same screen as on the server.

## Target users and problems to solve

The target users are students who use GUI programs (TCAD, EDA tools, etc.) on the school server. Many are not familiar with concepts like VS Code, PowerShell, or SSH keys.

| Current pain | What the app does |
| --- | --- |
| SSH login requires knowing terminal commands | Enter only ID and password on a login screen |
| Seeing the GUI requires installing an X server and setting up X11 forwarding, and it is slow | Show the server's virtual display directly inside the app |
| Xmanager is paid and needs per-session settings (X11 forwarding, passive mode, encoding) | Nothing to configure; server defaults are built in |
| Each program needs its own environment setup (paths, license servers) | Launchers set the program's environment themselves |
| Closing the window leaves processes on the server and holds licenses | Clean up the server session automatically when the app exits |

## Scope

The MVP goes as far as "log in and the terminal and remote desktop appear, and a button starts TCAD". Everything else is added after the MVP has been used in the lab.

### MVP

- Login: server address built in as a default, ID and password entered at every login (nothing secret is stored)
- Korean and English UI, switchable at any time
- Server status panel (left): server load, memory, disk quota, who is logged in, my running processes, and license usage for launchers that define license features, refreshed periodically
- Built-in terminal: the server's login shell in the right panel, with `DISPLAY` and `XAUTHORITY` set so any X program started there appears on the remote desktop
- Remote desktop: start a virtual display on the server and show it in the center panel, forwarding mouse and keyboard input
- App launchers: start frequently used GUIs with a button; the built-in list starts with Sentaurus Workbench and Sentaurus Visual
- Persistent session: one remote desktop per user that can outlive the app, so long simulations keep running and the same screen comes back at the next login (see "Session lifetime")
- Exit choice: closing the app asks "Keep running" (leave the session for later) or "End everything" (stop the desktop and every program on it)
- Connection status indicator and automatic reconnect on disconnect
- Password change: a logged-in user can change their server account password from the toolbar (see "Password change"). A forgotten password cannot be reset from the app; the login screen tells the user to ask the server administrator

### After the MVP

- Automatic SSH key registration, so later logins need no password (dropped from the MVP: the password is entered at every login)
- User-defined launchers (add and edit entries in the app)
- More built-in launchers (for example Cadence Virtuoso), after their commands are checked on the server
- Clipboard copy/paste between the local machine and the remote desktop
- File upload/download panel (drag and drop)
- Local graph viewer for result files (.plt)
- Multiple saved server profiles
- Auto update

### Out of scope

- Bundling binaries, manuals, or example files of any program (licensing)
- A custom GUI that reimplements any program's features
- Any server installation that needs administrator privileges

## Launchers

A launcher is a config entry: `{ id, label, command, env, licenseFeatures? }`.

- `command` runs on the session's display with `DISPLAY` and `XAUTHORITY` set.
- `env` holds the program's environment (for Sentaurus: `TCAD_HOME`, PATH, `STDB`, `SNPSLMD_LICENSE_FILE`), so users do not need a personal profile.
- `licenseFeatures` (optional) tells the server panel which license features to show.
- Launcher commands and paths come only from "Server pre-check results" in `CLAUDE.md`; they are never guessed.
- The config stays in the main process; the renderer only sees `{ id, label }` and asks to run a launcher by id. License features are not configured yet because their names have not been checked on the license server.
- A launch streams a short `sh` script to `sh -s` that exports the session's `DISPLAY`/`XAUTHORITY` and the launcher env, then starts the program detached (`setsid nohup`), so it belongs to the persistent desktop: it keeps running after *Keep running* and is stopped by *End everything*. A program that exits with an error within 2 seconds is reported with the end of its log.

## Session lifetime

Simulations can run for hours, so the remote desktop must not depend on the app staying open.

- **One session per user.** Each user has at most one remote desktop on the server. At login the app reattaches to it if it is still running, and starts a new one only if there is none.
- **The key stays on the server.** The session's one-time VNC password and X authority cookie are kept in the user's private session folder on the server (`~/.sogangssh/`, mode 700). The app reads them over the authenticated SSH connection when it reattaches, so it never stores them on the local PC, and other users on the server cannot read them.
- **Exit choice.** When the app closes, it asks:
  - *Keep running*: the app disconnects; the desktop and its programs keep running (and keep their licenses) until the next login.
  - *End everything*: the desktop, the window manager and every program on it are stopped, and the session folder is removed.
  - An unexpected disconnect (network loss, PC power off) is treated as *Keep running*.
- **Ending without closing the app.** A visible "End session" action in the toolbar does the same as *End everything* without closing the app.
- **Leftover cleanup.** If a session's processes were killed without cleanup, the next login stops whatever is left (Xvnc, window manager, programs on that display), not only the session folder, so no license stays held by an unreachable session.
- **Long-idle sessions**: a desktop that no app has been connected to for 24 hours ends by itself (Xvnc `MaxDisconnectionTime`), so a forgotten session cannot hold licenses for days. A "session running since…" notice at login may be added later.

## Password change

Accounts on the school server are local accounts (`/etc/passwd` and `/etc/shadow`), so a logged-in user can change their own password with `passwd`. Only the server administrator can reset a forgotten password, so the app does not try; the login screen shows a one-line hint to ask the administrator.

- A toolbar button opens a dialog with the current password, the new password and the new password again. The dialog checks that both new entries match and differ from the current one; the server decides everything else (length, dictionary words, similarity), because its rules come from its own PAM setup (`pam_pwquality` with `retry=3`, then `pam_unix`).
- Main runs `env LC_ALL=C passwd` on an exec channel with a PTY (`passwd` reads from a terminal, and `passwd --stdin` is root-only) and answers the prompts by text: `(current) UNIX password:` gets the current password, `New password:` and `Retype new password:` get the new one. `LC_ALL=C` keeps the prompts in English whatever the server locale is.
- The passwords travel only over the PTY (terminal echo is off for these prompts), never on a command line, in logs or in settings. Server output returned to the renderer has both passwords removed.
- Results: success (`all authentication tokens updated successfully`); wrong current password (`passwd` ends before asking for a new one); rejected new password (`passwd` asks for a new password again after a `BAD PASSWORD:` line: the app interrupts it and shows that server line as-is); any other failure shows the end of the output.
- The SSH session that is already open stays logged in. The new password is needed from the next login.

## How it works and architecture

The app and the server communicate over a single SSH connection, inside which a shell channel and a VNC forwarding channel are open at the same time.

```
┌─────────── Local PC · Electron app ───────┐           ┌────────────── School server · Linux ──────────┐
│                                           │           │                                               │
│  ┌─────────────┐      ┌────────────────┐  │           │  ┌─────────────────────────────────────────┐  │
│  │ Terminal    │      │ Remote desktop │  │           │  │ login shell                             │  │
│  │ xterm.js    │      │ noVNC          │  │   shell   │  │ runs commands, text output              │  │
│  └──────┬──────┘      └───────┬────────┘  │  ┌──────────▶└─────────────────────────────────────────┘  │
│         │ IPC                 │ WebSocket │  │        │                                               │
│  ┌──────┴─────────────────────┴────────┐  │  │  VNC   │  ┌─────────────────────────────────────────┐  │
│  │ SSH client (main process)           │◀─┼──┘  ┌────────▶│ Virtual display (Xvnc)                  │  │
│  │ ssh2: shell channel + local forward │◀─┼─────┘     │  │ listens on server localhost only        │  │
│  │ ws bridge: noVNC WebSocket ↔ TCP    │  │           │  └────────────────────▲────────────────────┘  │
│  └─────────────────────────────────────┘  │           │                       │ draws on display      │
│                                           │           │  ┌────────────────────┴────────────────────┐  │
└───────────────────────────────────────────┘           │  │ GUI programs (launchers or terminal)    │  │
                                                        │  └─────────────────────────────────────────┘  │
                  One SSH tunnel (port 22)              └───────────────────────────────────────────────┘
```

Xvnc on the server creates an invisible virtual monitor, and GUI programs draw on it. Only changed screen regions are compressed and sent to the app; mouse and keyboard input goes the other way to the server. noVNC speaks only WebSocket, so the ws bridge in the main process connects it to the SSH forwarding channel (TCP).

Connection sequence:

1. Log in with ssh2 (password or key)
2. Open a shell channel and connect it to xterm.js
3. Upload a small POSIX `sh` script to `~/.sogangssh/` and run it over an exec channel. The script finds a free display N, starts `Xvnc :N` (localhost only, a fresh random VNC password, an X authority cookie), starts a window manager, and prints one `READY` line with N, the VNC port and the password
4. Forward to server `localhost:<port>` through the SSH connection and start the ws bridge on the local PC
5. noVNC connects to the ws bridge, answers the VNC password and shows the display
6. Launch programs from a launcher or the terminal, both with `DISPLAY=:N` and the session's `XAUTHORITY`
7. On exit, follow the user's choice (see "Session lifetime"): *End everything* stops Xvnc, the window manager and anything still drawing on the display; *Keep running* only disconnects, and the next login reattaches to the same display

Stage 5 implemented the simpler behavior (the session always ends when the exec channel closes). Stage 6 replaced it with the persistent session above:

- The script runs in two modes over short exec channels: `attach <width> <height> <idle limit>` and `stop`. Neither holds the channel open.
- Xvnc and the window manager start detached (`setsid nohup`), so they survive the SSH connection. The session lives in `~/.sogangssh/session/` (`info` with display, port and Xvnc PID; the VNC password; the Xauthority cookie).
- `attach` reuses the running Xvnc (checked by PID and command line) with the same password, or stops what a dead session left behind and starts a new one. A `flock` on `~/.sogangssh/lock` makes simultaneous logins share one desktop.
- `stop` signals every own process whose environment has `DISPLAY=:N` (login shells excluded, so the app's terminal survives), then Xvnc, and removes the folder.
- Xvnc runs with `-MaxDisconnectionTime 86400`: a desktop with no viewer for 24 hours ends by itself.
- noVNC connects non-shared, so opening the session on a second PC takes it over from the first.
- The terminal shell is started as `env DISPLAY=:N XAUTHORITY=… SOGANGSSH_TERMINAL=1 $SHELL -l`, so GUI programs typed in it appear on the desktop; `stop` leaves only this shell itself (and login shells) running: everything started from it, including scripts such as a simulation runner, carries the same marker and is stopped like any other program on the desktop. A new desktop tries the previous display number first, so the terminal's `DISPLAY` usually stays valid after a restart.

The school server has TigerVNC 1.8 (`Xvnc` only, no `vncserver` wrapper), so the app starts `Xvnc` itself. Because the server is shared, the VNC port accepts only local connections and requires a per-session random password, and the X display requires a cookie, so other users on the same server cannot view or type into the session.

## Tech stack

Built with Electron + TypeScript. The terminal (xterm.js) and remote display (noVNC) are both web components, and Node's `ssh2` alone handles both the shell and port forwarding, so the core features come with the least code.

| Area | Choice | Reason |
| --- | --- | --- |
| App framework | Electron | Windows and macOS installers, uses web components as-is |
| Language | TypeScript | Shared types between main and renderer processes |
| Build tool | electron-vite | Dev server, hot reload, unified main/preload/renderer builds |
| UI | React + Tailwind CSS + shadcn/ui | Fast to build panel layouts and the login screen; shadcn/ui components are copied into the repo so the design can be iterated freely |
| Panel splitting | react-resizable-panels | Resize and collapse the terminal and display areas |
| SSH | ssh2 (Node) | Shell, exec, local port forwarding, key auth, keyboard-interactive (OTP) |
| Terminal | @xterm/xterm + fit addon | Same terminal engine as VS Code |
| Remote display | @novnc/novnc | Browser-based VNC viewer |
| WebSocket bridge | ws (Node) | Connects noVNC (WebSocket) ↔ SSH forwarding channel (TCP) |
| Settings storage | electron-store | Server address, window size, etc. |
| Packaging | electron-builder | Windows NSIS installer, macOS dmg |
| Auto update (later) | electron-updater + GitHub Releases | Update without reinstalling |
| Server-side display | TigerVNC (Xvnc) | Run GUI programs on a virtual display |

Tauri produces a smaller app but would require writing the SSH layer in Rust, slowing down the MVP. Revisit after the MVP if app size becomes a problem.

## Screens

There are only two screens: login and main. On the main screen, the remote desktop takes the most space, between the server status panel on the left and the terminal on the right. Both side panels can be resized and collapsed.

```
┌──────────────────────────────────────────────────────────────┐
│ Toolbar: [▶ Workbench] [▶ Visual] …launchers  ● On [≡][≡][⏻] │
├─────────────┬──────────────────────────────┬─────────────────┤
│ Server      │                              │ Terminal        │
│ status      │   Remote desktop             │ (xterm.js)      │
│ load, mem,  │   (noVNC, remaining space)   │ default 28%,    │
│ quota,      │                              │ collapsible     │
│ users,      │                              │                 │
│ licenses    │                              │                 │
├─────────────┴──────────────────────────────┴─────────────────┤
│ Status bar: user@server · latency · display · resolution     │
└──────────────────────────────────────────────────────────────┘
```

- Login screen: server address and port (prefilled, inside collapsed advanced settings), ID, password, login button, nothing else. Users can be on different servers or ports, so after a successful login the app remembers that user's server, port and ID (never the password) and prefills them next time; the built-in default is used only on first launch. If OTP is required, show an additional input.
- Server status panel data comes from read-only scripts streamed to `sh -s` over short exec channels while connected:
  - Every 10 s: host name and uptime, load average and core count (`/proc`), memory (`MemAvailable`), the user's home quota (`quota -w`, or the home filesystem from `df` when there is no quota), login sessions with idle time (`who -u`), cumulative CPU time per user (uid ≥ 1000) and of the user's own processes (`ps … time`). Two samples give "cores in use now" per user and per process, instead of `ps`'s lifetime averages.
  - Every 60 s: license usage with `lmutil lmstat -c <license file> -f <feature>`, one query per feature that a launcher declares (`lmstat -a` lists over 700 features on the IDEC server and times out). The numbers are for the whole license server, which other schools share.
  - Users are listed if they have a login session or use at least 0.1 cores; the user comes first, then the busiest. The panel's own commands are marked (`SOGANGSSH_MONITOR=1`) and left out of "my processes".
- The UI supports Korean and English. The first launch follows the OS language (Korean if it is Korean, otherwise English), and users can switch from the login screen or the toolbar.
- Error messages are shown in the selected language and state the cause and what to do. Examples: "The password is incorrect", "Check that you are connected to the school VPN".

## Security and authentication

The principle is "ask for the password at every login, store nothing secret".

1. Each login uses a password (or keyboard-interactive). The password is used only for the SSH handshake and is never stored. (Automatic key registration is postponed until after the MVP.)
2. The app remembers only the server, port and ID of the last successful login.
3. On the first connection the app shows the server's SHA256 host key fingerprint and asks the user to trust it. It is saved only after the login succeeds; if it changes later, the connection is blocked with a warning that shows both fingerprints.
4. VNC binds only to the server's localhost and is reachable only through SSH port forwarding. No external ports are opened.
5. Electron security settings: `contextIsolation: true`, `nodeIntegration: false`, expose only the needed IPC from preload.
6. Password change sends the current and new passwords only to `passwd` over a PTY on the existing SSH connection (see "Password change"); they are never put on a command line, logged or stored.
7. The window only ever shows the app's own page: navigation is blocked (including a file dropped onto the window), and main accepts IPC only from the main frame of that exact page, so no other page can reach the SSH session through the preload API.

Passwords, private keys, and OTPs must never appear in log files.

## Server-side requirements and pre-checks

By default the app installs nothing on the server. It calls only programs already there.

Check the following on the server before development starts.

- [ ] Output of `which vncserver Xvnc xpra Xvfb x11vnc` (which virtual display methods are available)
- [ ] For each launcher: product and version, GUI launch commands (for TCAD: `swb`, `svisual`, etc.), and environment setup
- [ ] SSH connection path: direct, or via a gateway server; whether VPN is required off campus
- [ ] Whether two-factor authentication (OTP) is used
- [ ] School server usage policy on per-user VNC sessions and long-running connections
- [ ] Number of license tokens (concurrent user limit), and whether `lmstat`/`lmutil lmstat -a` can read license usage
- [ ] Whether `quota` works for home directory limits, or only `df`

If no virtual display program is available, ask the IT administrator to install TigerVNC. Also ask whether the school already runs a remote desktop service such as FastX or ThinLinc.

## Packaging and distribution

Pushing a tag triggers GitHub Actions to build Windows and macOS installers and upload them to GitHub Releases.

| Platform | Artifact | Notes |
| --- | --- | --- |
| Windows | NSIS installer (.exe) | Without code signing, SmartScreen warns; include a "More info → Run anyway" screenshot in the install guide |
| macOS | .dmg (Apple Silicon, Intel) | Without notarization, Gatekeeper blocks it; requires an Apple Developer account ($99/year) |

Start unsigned during internal lab distribution, and consider signing as users grow. Make a one-page, screenshot-based install guide for users.

## Development stages (Claude Code work order)

Each stage ends with a result you can run and check yourself. Hand one stage at a time to Claude Code, check it, then move to the next. Keeping this document at the repository root as `DESIGN.md` and referencing it from `CLAUDE.md` makes Claude Code follow the design every session.

1. **Project skeleton**: initialize electron-vite + React + TypeScript + Tailwind + shadcn/ui, main/preload/renderer structure, ESLint and Prettier. Check: an empty window opens.
2. **Screen layout mockup**: build the login screen and main screen (toolbar, server status panel, remote desktop panel, terminal panel, resize handles, status bar) with shadcn/ui, using placeholder content and mock data instead of real SSH. Check: you can click through login → main screen, resize and collapse the terminal, and iterate on the design without a server.
3. **SSH connection**: `ssh2` connection module in the main process, password login, host key verification, connection status IPC. Check: the login screen shows connection success or failure.
4. **Built-in terminal**: SSH shell channel ↔ IPC ↔ xterm.js, sync PTY size on window resize. Check: `ls` and `top` work inside the app.
5. **Remote display**: start Xvnc on the server via an SSH exec script, parse the display, port and password, local port forwarding, ws bridge, noVNC connection. Check: the server's virtual desktop appears in the middle panel.
6. **App launchers and session lifetime**: launcher config with the built-in Sentaurus launchers, toolbar buttons, `DISPLAY` and `XAUTHORITY` in the terminal, persistent session with reattach, exit choice (*Keep running* / *End everything*), leftover cleanup that stops orphaned processes, reconnect. Check: a button opens Workbench; `xterm &` typed in the terminal appears on the remote desktop; after *Keep running* and a new login the same windows are still there; after *End everything* no processes remain on the server.
7. **Server status panel**: replace the panel's mock data with live server data (load, memory, quota, users and their CPU use, my processes, license usage for launcher features). Check: the numbers match `uptime`, `free`, `quota`, `who`, `ps` and `lmstat` on the server. (This replaced automatic key registration, which was dropped from the MVP.)
8. **Packaging**: electron-builder config, GitHub Actions builds, install guide page. Check: the app runs on another PC from the installer alone.

Before stage 3, record the results of "Server-side requirements and pre-checks" in `CLAUDE.md` so that server commands are not guessed in stage 5.

## Risks and open questions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Server has no vncserver or xpra | Remote display not possible | Ask IT to install; otherwise consider a user-space build |
| School policy restricts long sessions or automatic login | Cannot distribute | Confirm with the IT administrator before development |
| 3D views (OpenGL) are slow with software rendering | 3D-heavy programs (e.g. Sentaurus Visual 3D rotation) stutter | Recommend mostly 2D use; check whether VirtualGL is available |
| Exit cleanup fails, leaving sessions and licenses held | Other users run out of licenses | Handle abnormal exits; stop orphaned processes (not only folders) on next connection |
| Kept sessions pile up and hold licenses | Other users run out of licenses | One session per user; show running sessions at login; idle limit policy |
| VPN required off campus | More connection-failure inquiries | Include VPN guidance in error messages |
| Unsigned installer warnings | Non-expert users give up | Install guide with screenshots |

Open questions:

- Whether a simulation started from Sentaurus Workbench keeps running when Workbench itself is closed (needs a server check; affects how much *Keep running* matters)
- Idle limit for kept sessions: none, a fixed number of days, or a notice only
- Which launchers to add next (for example Cadence Virtuoso), and their launch commands and environment (needs a server check)
- Distribution scope (lab only vs whole department). The app name is decided: sogangSSH.
