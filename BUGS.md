# Bug catalog

Every bug fixed so far, in the order it was found, with the test that keeps it fixed. A bug found
but not fixed yet is marked (open) in its title. The
repository is public: describe bugs without server details (no addresses, ports, host names,
account names, host key fingerprints or license servers).

**Rule:** every bug fix adds an entry here and a test that would have caught it. If no automated
test can reach it yet, say which stage will cover it (see "Test stages" below) or that it is
checked by hand.

Each entry gives:

- **Date** the fix was committed.
- **Symptom:** what the user saw (or would have seen).
- **Cause.**
- **Fix:** the commit. "Before commit" means the bug was found in testing or review while the
  feature was being written, so the history has only the fixed version.
- **Guard:** the test that fails if the bug comes back, or the stage that will cover it.
- **Found by.**

## Test stages

| Stage | What                                                   | Where                                      | Status  |
| ----- | ------------------------------------------------------ | ------------------------------------------ | ------- |
| 1     | Vitest unit tests (pure functions, fake ssh2 channels) | `tests/unit/`                              | done    |
| 2     | Local fake SSH / RFB server, integration tests         | `tests/fake-server/`, `tests/integration/` | done    |
| 3     | Playwright end-to-end tests of the Electron app        | —                                          | planned |
| 4     | Shell scripts run on Linux with stub programs          | —                                          | planned |
| 5     | GitHub Actions; server-detail scan with a secret list  | —                                          | planned |

"Manual: school server" means the check needs the real server and is done by hand
(`SECURITY-CHECKLIST.md` section 4).

---

## B-001: Any local HTML page could use the app's IPC

- **Date:** 2026-11-24
- **Symptom:** none seen by users. An HTML file dropped onto the window replaced the app page,
  kept the preload API and could type into the live SSH shell.
- **Cause:** every `file://` page counted as a trusted IPC sender, and the window could navigate.
- **Fix:** `3546388`. The window never navigates, drops do nothing, and only the exact bundled
  `index.html` (or the dev server's origin) is trusted (`src/main/app-page.ts`).
- **Guard:** `tests/unit/app-page.test.ts`. Navigation and drop blocking: planned stage 3.
- **Found by:** not recorded.

## B-002: The installer packed untracked local files

- **Date:** 2026-11-24
- **Symptom:** personal notes from the developer's folder were inside the installer.
- **Cause:** electron-builder packs the working folder, not the git tree; the deny-list missed
  untracked files.
- **Fix:** `a162dc0`. `electron-builder.yml` lists only `out/**` and `resources/**`.
- **Guard:** `tests/unit/static.test.ts` ("ships only an allow-list of built files"). Before a
  release, `SECURITY-CHECKLIST.md` section 3 also checks the built installer.
- **Found by:** not recorded.

## B-003: "End session" left scripts started from the terminal running

- **Date:** 2026-11-24
- **Symptom:** after "End session", a job runner started from the app terminal (`sh runjob.sh`)
  saw its simulator die and started the next stage, holding another license.
- **Cause:** `stop` kept every process marked `SOGANGSSH_TERMINAL=1` whose name ended in `sh`,
  so runner scripts were kept like the terminal shell itself.
- **Fix:** `70e2c5e`. Only the topmost marked process (the terminal shell) is kept; the target
  list is taken once before signalling.
- **Guard:** planned stage 4 (run `display-script.ts` `stop` against a process tree on Linux).
- **Found by:** not recorded.

## B-004: A desktop or shell started on a dropped connection stayed in use

- **Date:** 2026-11-24
- **Symptom:** if the connection dropped while the remote desktop was starting, the desktop
  never came back after logging in again, until the app was restarted. The terminal had the same
  race.
- **Cause:** the start still finished and stored a session whose bridge forwarded over the dead
  client; reattach returned that stale session.
- **Fix:** `962444b`. `RemoteDisplay.detach()` and `RemoteShell.reset()` bump a generation
  counter, and results from an older generation are thrown away.
- **Guard:** `tests/unit/display.test.ts` ("throws away a start from a dropped connection"),
  `tests/unit/shell.test.ts` ("throws away a shell that opens after a reset"),
  `tests/integration/display.test.ts` (the same over a real SSH connection, then a new login).
- **Found by:** not recorded.

## B-005: Some error messages were always in English

- **Date:** 2026-11-24
- **Symptom:** the Korean UI showed "security failure" on the display panel and "Not connected"
  when ending the session offline; the password dialog showed English `timeout`, `busy` and an
  Electron "Error invoking remote method" text.
- **Cause:** hard-coded strings and raw error details instead of error codes with translations.
- **Fix:** `195e35b`, `af69e71`.
- **Guard:** the `Messages` type keeps `ko.ts` and `en.ts` in sync, but cannot see hard-coded
  strings. Planned stage 3 (check the visible texts in Korean).
- **Found by:** not recorded.

## B-006: An SSH channel error crashed the main process

- **Date:** 2026-11-24
- **Symptom:** the whole app could quit when a channel broke (for example a reset VNC tunnel).
- **Cause:** a Node `EventEmitter` throws on an `error` event that has no listener. The exec,
  launch, terminal and forwarded VNC channels had none.
- **Fix:** `c99c027` (`src/main/remote/exec.ts`, `launch.ts`, `ssh/shell.ts`, the forwarded
  stream in `remote/display.ts`). The password channel (`ssh/password.ts`) had one from the start.
- **Guard:** `tests/unit/exec.test.ts`, `launch.test.ts`, `shell.test.ts`, `password.test.ts`
  and `display.test.ts` each emit an `error` on a fake channel. `tests/integration/channels.test.ts`,
  `display.test.ts` and `launcher.test.ts` break real channels from the fake server (refused
  exec, channel closed without exit status, connection cut mid-command, refused or closed
  forward, VNC server gone) and fail on any uncaught exception. ssh2 itself raised no channel
  `error` in those cases, so a removed listener is caught only by the unit tests (checked by
  removing the exec and forward listeners: the integration tests still passed).
- **Found by:** not recorded.

## B-007: A WebSocket closed early leaked the VNC tunnel channel

- **Date:** 2026-11-24
- **Symptom:** none visible at once; SSH channels piled up after quick reconnects, and writes
  could go to an already ended stream.
- **Cause:** the bridge started listening on the WebSocket only after `forwardOut` finished, so
  a close that came first was missed; noVNC kept sending while the socket was closing.
- **Fix:** `c99c027`. The WebSocket is watched from the start, a forward that opens after it
  closed is ended at once, and nothing is written to an ended stream.
- **Guard:** `tests/unit/display.test.ts` ("ends a forward that opens after the WebSocket
  closed", "closes the WebSocket on a stream error and never writes to an ended stream"),
  `tests/integration/display.test.ts` ("leaks no channel when the WebSocket closes before the
  forward opens": the fake server counts its open channels).
- **Found by:** not recorded.

## B-008: A broken bridge stayed the session

- **Date:** 2026-11-24
- **Symptom:** after the local bridge failed, every reattach returned its dead URL and the
  display stayed black until the app restarted.
- **Cause:** a bridge `error` after listening did not clear the session.
- **Fix:** `c99c027`. The bridge is closed and dropped from the session.
- **Guard:** `tests/integration/display.test.ts` ("clears the session when the bridge breaks"). The
  test raises the error on the bridge's server object directly; nothing outside can break it.
- **Found by:** not recorded.

## B-009: The server panel stopped refreshing after a reconnect

- **Date:** 2026-11-24
- **Symptom:** after the connection dropped during a status query and came back, the server
  status panel stayed frozen.
- **Cause:** the query on the old connection never finished, so its "busy" flag stayed set and
  blocked every refresh on the new connection.
- **Fix:** `c99c027`. `ServerMonitor.stop()` clears the busy flags.
- **Guard:** `tests/unit/server-monitor.test.ts` ("refreshes on a new connection while a query
  on the old one still hangs"), `tests/integration/monitor.test.ts` (the same with a logout and a
  new login on the fake server).
- **Found by:** not recorded.

## B-010: `passwd` prompts follow the server's locale

- **Date:** 2026-11-24
- **Symptom:** the password change would not recognise Korean `passwd` prompts.
- **Cause:** the server's default locale is Korean.
- **Fix:** `9e1a6bc` (before commit): `passwd` runs as `env LC_ALL=C passwd`; `a127700` also asks
  for `LC_ALL=C` / `LANG=C` in the channel environment.
- **Guard:** `tests/unit/password.test.ts` ("answers the English prompts and asks for the C
  locale"), `tests/integration/password.test.ts` (command, PTY and `env` request as the fake
  server receives them).
- **Found by:** a read-only check of `passwd` on the school server (its default locale is Korean).

## B-011: Two password changes could run at once

- **Date:** 2026-11-24
- **Symptom:** submitting the dialog twice could start two `passwd` runs that raced each other.
- **Cause:** no guard in the IPC handler.
- **Fix:** `9e1a6bc` (before commit). A second request returns `busy` (`src/main/ipc.ts`).
- **Guard:** `tests/integration/ipc.test.ts` ("refuses a second password change while one runs"),
  which calls main's IPC handlers with `electron` replaced by a stand-in.
- **Found by:** not recorded.

## B-012: A cut-off password change was reported as a failure

- **Date:** 2026-11-24
- **Symptom:** if the connection dropped right after the new password was confirmed, the app
  said the change failed, though the server may already have saved it, so the user tried the old
  password at the next login.
- **Cause:** every close without a success line counted as a failure.
- **Fix:** `7171604`. After the confirmation, a cut-off change is `maybeChanged` ("try the new
  password first").
- **Guard:** `tests/unit/password.test.ts` ("says a change cut off after the confirmation may
  have gone through", and the channel error case), `tests/integration/password.test.ts` (a fake
  `passwd` that saves the password and goes quiet).
- **Found by:** review of `9e1a6bc` in a separate session.

## B-013: A password change on a dropped connection showed an Electron error

- **Date:** 2026-11-24
- **Symptom:** "Error invoking remote method …" in the password dialog.
- **Cause:** ssh2 throws from `exec` (instead of calling back) when the connection is already
  gone, and the throw escaped the IPC handler.
- **Fix:** `af69e71`. The throw becomes `notConnected`.
- **Guard:** `tests/unit/password.test.ts` ("reports notConnected when ssh2 throws"),
  `tests/integration/password.test.ts` (on a connection the fake server cut).
- **Found by:** review of `9e1a6bc` in a separate session.

## B-014: A first login with an expired password never started the desktop

- **Date:** 2026-11-24
- **Symptom:** new accounts (whose initial password has expired) logged in, but the desktop
  never started.
- **Cause:** sshd runs `passwd` instead of every requested command, so the app's scripts were
  fed to `passwd`.
- **Fix:** `a127700`. A marker command runs right after login; if `passwd` answers, the login
  becomes `passwordExpired` and the app asks for a new password.
- **Guard:** `tests/integration/login.test.ts` ("expired first-login password"): the fake server
  runs `passwd` instead of every command for an expired account. Not yet tried with a real new
  account (manual: school server).
- **Found by:** not recorded.

## B-015: A "new password" login prompt could get the login password

- **Date:** 2026-11-24
- **Symptom:** none seen; on a forced change during keyboard-interactive login, the app would
  have answered "New password:" with the current password.
- **Cause:** any prompt containing "password" was answered with the login password.
- **Fix:** `a127700`. Prompts that ask for a new, retyped or current password are never answered
  (`src/main/ssh/login-prompts.ts`).
- **Guard:** `tests/unit/login-prompts.test.ts`, `tests/integration/login.test.ts` ("never answers
  a password-change prompt during login …": the fake server records every answer).
- **Found by:** not recorded.

## B-016: Korean `passwd` prompts during a forced change

- **Date:** 2026-11-24
- **Symptom:** on a forced change, sshd starts `passwd` itself in the server's locale, so the
  prompts may be Korean even though the app asks for `LC_ALL=C`.
- **Cause:** only English prompts were matched.
- **Fix:** `a127700`. Korean prompts, success and error lines are matched too.
- **Guard:** `tests/unit/password.test.ts` ("answers the Korean prompts of a forced change"),
  `tests/integration/login.test.ts` (the same through the expired-login flow).
- **Found by:** not recorded.

## B-017: The first-run tour was used up before it opened

- **Date:** 2026-11-24
- **Symptom:** in development the guide's tour never opened by itself after the first login.
- **Cause:** the "seen" mark was written when the effect started; React StrictMode runs effects
  twice in development, cancelling the first timer after it had already marked the tour seen.
- **Fix:** `b5f82aa` (before commit). The mark is written only when the tour really opens
  (`GuideMascot.tsx`).
- **Guard:** planned stage 3 (needs a development build of the renderer).
- **Found by:** not recorded.

## B-018: Guide character: swallowed click, half-open tour, Esc anywhere

- **Date:** 2026-11-24
- **Symptom:** after a cancelled drag the next click on 서강이 did nothing; hiding 서강이 during
  the tour and showing it again reopened the tour halfway; Esc meant for the terminal, the remote
  desktop or a dialog closed the tour.
- **Cause:** drag state was not reset on `pointercancel`; hiding did not close the tour; Esc was
  handled on the whole window.
- **Fix:** `15fd1b4`.
- **Guard:** planned stage 3.
- **Found by:** review of `b5f82aa` in a separate session.

## B-019: Pressing Workbench twice opened two copies

- **Date:** 2026-11-24
- **Symptom:** a double click opened two Workbench windows, each holding a license.
- **Cause:** every launch started a new program.
- **Fix:** `15fd1b4`. Launched programs carry `SOGANGSSH_LAUNCHER=<id>`; unless forced, the launch
  script first looks for an own process with that marker, the same `DISPLAY` and the program's
  name, and reports `RUNNING`.
- **Guard:** `tests/unit/launch.test.ts` ("marks the program and first looks for a running copy",
  "skips the check … when forced"), `tests/integration/launcher.test.ts` and `ipc.test.ts` (the
  `RUNNING` reply becomes `alreadyRunning`; `force` only when exactly `true`). Running the check
  itself: planned stage 4.
- **Found by:** not recorded.

## B-020: A forced second copy wiped the first copy's log

- **Date:** 2026-11-24
- **Symptom:** "Open another" truncated `launch-<id>.log` while the first copy still wrote to it.
- **Cause:** the log was always opened with `>`.
- **Fix:** `15fd1b4` (before commit). A forced copy appends (`>>`).
- **Guard:** `tests/unit/launch.test.ts` ("skips the check and appends to the log when forced"),
  `tests/integration/launcher.test.ts` ("opens another copy when forced, appending to the log").
- **Found by:** review of the uncommitted one-copy change in a separate session.

## B-021: "Open another" during a launch re-enabled the buttons too early

- **Date:** 2026-11-24
- **Symptom:** launcher buttons became clickable again while a launch was still running.
- **Cause:** the toast action called the launch without the "running" guard, and overlapping
  launches reset it early.
- **Fix:** `15fd1b4` (before commit). Launches run one after another (`LauncherButtons.tsx`).
- **Guard:** planned stage 3.
- **Found by:** review of the uncommitted one-copy change in a separate session.

## B-022: Server details were built into the app and the repository

- **Date:** 2026-11-24
- **Symptom:** none for users; outsiders could read how to reach the school server.
- **Cause:** defaults in the login form, a saved last login, and build-time license settings.
- **Fix:** `5773001`, then `08b0387` (license servers read after login instead of at build time).
- **Guard:** manual: `SECURITY-CHECKLIST.md` sections 1 and 3. Planned stage 5 (scan for
  server-detail patterns kept in a CI secret, never in the repository).
- **Found by:** a server-detail audit in a separate session.

## B-023: License server lists with a comma were refused

- **Date:** 2026-11-24
- **Symptom:** a license setting of the form `port@host1,port@host2,port@host3` (a redundant
  server triad) made the launchers fail as "invalid".
- **Cause:** `SAFE_WORD` in `launch.ts` (and the license query check) did not allow `,`.
- **Fix:** `08b0387`.
- **Guard:** `tests/unit/launch.test.ts` ("accepts a comma in a license file list"),
  `tests/unit/license-setting.test.ts` ("accepts several servers and a redundant triad"),
  `tests/integration/ipc.test.ts` (a triad read from the profile reaches the launch script).
- **Found by:** review of the uncommitted license-setting change in a separate session.

## B-024: Reading `~/.bash_profile` could hang or stop early

- **Date:** 2026-11-24
- **Symptom:** the license setting was missing, or the read waited for its 15 s time limit.
- **Cause:** `csh` sourcing the user's profile could hang (for example reading input) or abort on
  an error before the license line.
- **Fix:** `08b0387` (before commit). `timeout 5 csh … < /dev/null`, and a `sed` fallback that
  reads the `setenv SNPSLMD_LICENSE_FILE` line from the file (`remote/license-setting.ts`).
- **Guard:** `tests/unit/license-setting.test.ts` (`READ_SCRIPT` checks),
  `tests/integration/channels.test.ts` (a read that never answers times out and is tried again).
  Running the script with a hanging and a broken profile: planned stage 4.
- **Found by:** review of the uncommitted license-setting change in a separate session, with read-only checks of `csh` on the school server.

## B-025: License values with a trailing `;` or a leading `-`

- **Date:** 2026-11-24
- **Symptom:** a profile line ending in `;` gave an unusable value; a value starting with `-`
  would have been read as an option by `sh` and `lmstat`.
- **Cause:** the fallback did not cut `;` or comments, and the checks allowed a leading `-`.
- **Fix:** `08b0387` (before commit). `sed 's/[#;].*//'` in the fallback; `parseLicenseOutput`
  and the server monitor refuse a leading `-`.
- **Guard:** `tests/unit/license-setting.test.ts` (trailing `;` and leading `-` refused),
  `tests/unit/server-monitor.test.ts` ("does not query with a value that reads as an option"),
  `tests/integration/monitor.test.ts` (the same with the value read over SSH). The `sed` step
  itself: planned stage 4.
- **Found by:** review of the uncommitted license-setting change in a separate session (the trailing `;` is not in the review notes; only the fix is visible).

## B-026: A line printed by the user's profile could pass for the setting

- **Date:** 2026-11-24
- **Symptom:** none seen; a profile that prints a line starting with `LICENSE` could have
  replaced the real value.
- **Cause:** the first line starting with `LICENSE` (no space required) was taken.
- **Fix:** `08b0387` (before commit). The last line matching `LICENSE( |$)` is taken.
- **Guard:** `tests/unit/license-setting.test.ts` ("takes the last LICENSE line").
- **Found by:** review of the uncommitted license-setting change in a separate session.

## B-027: Every license read failure blamed `~/.bash_profile`

- **Date:** 2026-11-24
- **Symptom:** a timeout or channel error told the user to check their profile.
- **Cause:** no difference between "not set" and "could not read".
- **Fix:** `08b0387` (before commit). `notSet` vs `failed`; only successful reads are cached.
- **Guard:** `tests/unit/license-setting.test.ts` ("tells 'not set' apart from a failed read",
  "keeps a successful read … retries a failed one"), `tests/integration/channels.test.ts` and
  `ipc.test.ts` (`noLicense` vs `licenseReadFailed` at the launcher).
- **Found by:** review of the uncommitted license-setting change in a separate session.

## B-028: License servers were visible to other users in `ps`

- **Date:** 2026-11-24
- **Symptom:** none visible; other users on the shared server could read the license query's
  arguments in the process list.
- **Cause:** the arguments were on the `sh -s` command line.
- **Fix:** `08b0387`. They go over stdin as `set -- …`.
- **Guard:** `tests/unit/server-monitor.test.ts` ("passes the license query arguments over
  stdin, never on the command line"), `tests/integration/monitor.test.ts` (every command the fake
  server received).
- **Found by:** review of the uncommitted license-setting change in a separate session.

## B-029: The status bar showed a fake latency

- **Date:** 2026-11-25
- **Symptom:** the 0.1.0 build showed "24 ms" in the status bar, which looked like a measurement.
- **Cause:** a value from the stage 2 mockup (`src/renderer/src/mocks/`) was still shown.
- **Fix:** `bd1c823`. The latency and the mock file are removed.
- **Guard:** `tests/unit/static.test.ts` ("never imports from a mocks folder", "shows no
  placeholder latency in the status bar").
- **Found by:** not recorded.

## B-030: Pasting froze the window

- **Date:** 2026-11-25
- **Symptom:** the window stopped responding on the first paste into the remote desktop.
- **Cause:** Electron 45's `clipboard.readText()` returns a Promise, which was put in a
  synchronous IPC reply.
- **Fix:** `96cc663` (before commit). An asynchronous `ipcMain.handle` that awaits the clipboard.
- **Guard:** `tests/unit/static.test.ts` ("uses no synchronous IPC"). The paste itself: planned
  stage 3.
- **Found by:** not recorded.

## B-031: A fast Ctrl+V on Windows typed `v`

- **Date:** 2026-11-25
- **Symptom:** pressing Ctrl+V quickly pasted nothing and typed a `v` on the desktop.
- **Cause:** on Windows noVNC holds a Ctrl press back to tell it from AltGr, so the server got `v`
  without Ctrl.
- **Fix:** `96cc663` (before commit). The paste presses the modifiers the server does not hold
  yet, and releases only those.
- **Guard:** `tests/unit/paste-keys.test.ts` (`missingModifiers`). With a real keyboard: planned
  stage 3.
- **Found by:** not recorded.

## B-032: Copying pasted text again on the desktop never reached the PC

- **Date:** 2026-11-25
- **Symptom:** after pasting a text, copying that same text on the desktop did nothing.
- **Cause:** the echo of the last paste was suppressed for good instead of once.
- **Fix:** `96cc663` (before commit). Only one echo is skipped (`pasteEchoFilter` in
  `components/app/paste-keys.ts`).
- **Guard:** `tests/unit/paste-keys.test.ts` ("skips only one echo of the last paste").
- **Found by:** not recorded.

## B-033: A huge clipboard crossed IPC before the size check

- **Date:** 2026-11-25
- **Symptom:** none seen; a very large clipboard would have been copied to the renderer before
  being refused.
- **Cause:** the size was checked in the renderer.
- **Fix:** `96cc663` (before commit). Main refuses text over `MAX_CLIPBOARD_TEXT` and sends
  `null` instead (`src/main/ipc.ts`).
- **Guard:** planned stage 3.
- **Found by:** not recorded.

## B-034: The clipboard was read before the desktop was connected

- **Date:** 2026-11-25
- **Symptom:** none seen; a paste key pressed while noVNC was still connecting read the PC
  clipboard for nothing.
- **Cause:** the key handler did not wait for the connection.
- **Fix:** `96cc663` (before commit). Paste keys are handled only while connected.
- **Guard:** planned stage 3.
- **Found by:** not recorded.

## B-035: Selecting text on the desktop overwrote the PC clipboard

- **Date:** 2026-11-25
- **Symptom:** merely selecting text in a desktop program replaced what the user had copied on
  the PC.
- **Cause:** Xvnc sends the PRIMARY selection as clipboard updates by default.
- **Fix:** `96cc663` (before commit). Xvnc runs with `-SendPrimary=0`.
- **Guard:** `tests/unit/display.test.ts` ("starts Xvnc with -SendPrimary=0"). Verified on the
  school server (manual).
- **Found by:** not recorded.

## B-036: A command on a just-dropped connection rejects instead of failing cleanly

- **Date:** 2026-11-25.
- **Symptom:** none seen yet. In one integration run the server panel's query hit a connection
  that had just dropped and left an unhandled promise rejection ("Not connected") in main.
- **Cause:** ssh2 throws from `exec`, `shell` and `forwardOut` when its socket is already gone,
  before `SshConnection` has seen the `close` event. `remote/exec.ts` and `remote/launch.ts`
  called `client.exec` inside a Promise without a `try`, so the call rejected; `ssh/shell.ts`
  did the same for the terminal; and in `remote/display.ts` the throw happened in the ws bridge's
  connection handler, where it would crash main. The same throw was fixed for the password
  change in B-013.
- **Fix:** each call site catches the throw and returns its ordinary error result (`exec`:
  `error`, launch and terminal: `failed`, display bridge: the WebSocket is closed).
- **Guard:** `tests/unit/dropped-connection.test.ts` (exec, launch, terminal) and
  `tests/integration/channels.test.ts` ("ends when the connection drops during the command …").
  Re-introducing the bug in `exec.ts` makes the unit test fail.
- **Found by:** the stage 2 integration tests (a flaky run of `monitor.test.ts`).

## B-037: The installed app would never have found electron-updater's autoUpdater

- **Date:** 2026-11-25.
- **Symptom:** none shipped. Found before the first updater build: in the packaged app the
  updater would have stopped at startup without ever checking for a release.
- **Cause:** main loads `electron-updater` with a dynamic `import()`, which the bundle keeps, so
  Node loads that CommonJS package as ESM. Its `autoUpdater` is defined as a getter with
  `Object.defineProperty`, which Node does not list as a named export; only `default`
  (module.exports) has it. Vitest's module loader does see the named export, so mocked tests pass.
- **Fix:** `pickAutoUpdater()` in `src/main/updater.ts` takes the named export or the one on
  `default`, and throws (logged as "not available") if neither exists.
- **Guard:** `tests/unit/updater.test.ts` ("finds autoUpdater on the default export … (B-037)")
  asks a plain Node process how it sees the package, then checks `pickAutoUpdater`. The local
  end-to-end update check runs the packaged app.
- **Found by:** reading the bundled `out/main` before the end-to-end check.

## B-038: Hand-uploaded installers would not have matched latest.yml

- **Date:** 2026-11-25.
- **Symptom:** none shipped. Every update would have failed with a 404 after a hand upload.
- **Cause:** for the GitHub provider electron-builder writes the installer into `latest.yml` as
  `sogangSSH-Setup-<version>.exe` (spaces become dashes) and renames it only when it uploads
  itself. The build wrote `sogangSSH Setup <version>.exe`, and GitHub turns spaces in an uploaded
  name into dots, so neither matched.
- **Fix:** `nsis.artifactName` in `electron-builder.yml` is `${productName}-Setup-${version}.${ext}`,
  the same name `latest.yml` uses.
- **Guard:** `tests/unit/static.test.ts` ("update build settings (B-038)"). Checked by building
  with the real config: the installer, its `.blockmap` and the `latest.yml` url match.
- **Found by:** comparing `latest.yml` with the build output before the first update release.
