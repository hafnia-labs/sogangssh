# Security checklist

sogangSSH logs students into a shared school server and the repository is public. Go through section 1 before every commit, section 2 when adding or changing a feature, section 3 before a release, and section 4 whenever the school server is used for testing.

This file must never contain server details itself. Where a check needs the actual values (addresses, ports, host name, host key fingerprint, license servers, account names), take them from the git-ignored `CLAUDE.local.md`.

## 1. Every commit (public repository)

- [ ] **No server details in the diff.** Search the staged diff for each value listed in `CLAUDE.local.md` (server address and port, host name, host key fingerprint, license servers and their ports, account names).
- [ ] **No server details in the commit message.** Run the same search on the message.
- [ ] **No secrets.** No passwords, private keys, OTPs, VNC passwords, X cookies or tokens in code, tests, fixtures or comments.
- [ ] **No confidential material.** Nothing copied from the school's confidential server guide or other internal documents.
- [ ] **Local-only files stay local.** `CLAUDE.local.md`, `.env*`, `report4me/` and `.claude/` are ignored (`git check-ignore -v <path>`), and `git status` shows none of them as added.

## 2. Adding or changing a feature

### Passwords and other secrets
- [ ] The login password is used only for the SSH handshake, and the passwords for a change only by `passwd` over a PTY. They are never stored or kept in main after use.
- [ ] No secret goes on a command line (other users on the server can read `ps`), into a log, a settings file, an error detail sent to the renderer or a toast. Server output shown to the user has the passwords removed.
- [ ] The VNC password and the X cookie reach the server tools over standard input (`vncpasswd -f`, `xauth source -`). Session files stay in `~/.sogangssh/` with mode 700.
- [ ] The license setting is kept in main's memory for the current connection only and is forgotten on logout. It reaches the license query over standard input.
- [ ] Renderer state that held a password is cleared when its dialog closes or the login succeeds.

### Commands on the server
- [ ] Scripts are streamed to `sh -s` over standard input. The exec command itself stays plain (the login shell is csh).
- [ ] Scripts written with `String.raw` contain no dollar sign followed by an opening brace.
- [ ] Every value inserted into a script is checked word by word against an allow-list (no spaces, quotes, `;`, backticks, `$(`), and a value can never start with `-`.
- [ ] No text typed by the user is put into a command. Values come only from the app's own config, from checked server output, or from checked user files such as `~/.bash_profile`.
- [ ] Every exec channel has `data` and `error` listeners (a missing `error` listener crashes main), and a timeout.

### Electron
- [ ] `contextIsolation: true`, `nodeIntegration: false` and `sandbox: true` are unchanged. The preload exposes only the IPC the renderer needs and has no dependencies.
- [ ] Every new IPC handler checks `isTrustedSender` first and validates every argument (type, length, allowed values).
- [ ] Navigation away from the app page stays blocked, new windows stay denied, and only `https://` links open externally.
- [ ] The CSP is not widened. The renderer loads no remote content.

### SSH
- [ ] Host keys stay trust-on-first-use: an unknown key needs the user's confirmation, a changed key blocks the connection. Nothing auto-trusts a key.
- [ ] During login, a prompt that asks for a new or retyped password is never answered with the login password.
- [ ] A first login with an expired password is detected before anything runs on the connection, and that connection never becomes "connected".

### Shared-server hygiene
- [ ] The remote desktop listens on the server's localhost only, needs the session's VNC password, and the X display needs the private cookie.
- [ ] "End session" stops every process on the user's display, and tests confirm nothing is left behind.
- [ ] Nothing is written where other users can read it (no world-readable files, nothing in `/tmp` except what Xvnc creates).
- [ ] Launchers start one copy per program unless the user asks for another (each copy takes a license).

### Local data on the user's PC
- [ ] The PC clipboard is read only when the user presses a paste key on the remote desktop, never in the background or on focus.
- [ ] The app stores only trusted host key fingerprints (`known-hosts.json`) and the language and guide settings in local storage. No passwords, server addresses or account names.

## 3. Before a release

- [ ] **Build output is clean.** Build with `npx electron-vite build` and search `out/` for the values in `CLAUDE.local.md`. There must be no matches. Do the same for the packaged app.
- [ ] **Dependencies.** Run `npm audit` and review anything in runtime `dependencies` (ssh2, ws, @electron-toolkit/utils, electron-updater) first. Check that Electron is on a supported version with current security fixes.
- [ ] **Release notes and assets.** The release text, screenshots and attached files contain no server details or account names.
- [ ] **New version.** `version` in `package.json` is higher than every published release. Never replace or re-upload files of an existing release: installed copies have already seen that version and ignore it.
- [ ] **Update files.** The new release has the installer, `latest.yml` and the `.blockmap` from the same `release/<version>/` build (a mismatched `latest.yml` fails the SHA-512 check and nobody updates). The files keep their names (`latest.yml` points at `sogangSSH-Setup-<version>.exe`). The tag is `v<version>`.
- [ ] **GitHub account.** Without code signing, a release is trusted by every installed copy: the account that publishes it has 2FA, and nobody else has write access to releases.
- [ ] **Section 1 holds for every commit in the release.**

## 4. Testing on the school server

- [ ] Use only the read-only development access described in `CLAUDE.local.md`, with the host key checked against the pinned fingerprint.
- [ ] Never change files or settings on the server, and never change a real password.
- [ ] Say beforehand when a test starts something (a desktop, a program), check first that no real session is running, and confirm afterwards that nothing is left.
- [ ] Never print secret values in test output; compare them instead.
