# sogangSSH

English | [한국어](README.ko.md)

A desktop app for using GUI programs such as Synopsys Sentaurus TCAD on the Sogang University school server, with no terminal setup. You log in with your school ID and password; the app shows the server's terminal, a remote desktop and live server status in one window.

The UI is available in Korean and English.

## What it does

- **Login**: enter your ID and password only. The server address is built in, and the app remembers the server and ID of your last login (never the password). The server's host key is checked on every connection.
- **Remote desktop**: starts a virtual display (TigerVNC `Xvnc`) on the server and shows it in the app through the SSH connection. You need no X server, X11 forwarding or VNC client on your PC.
- **Persistent session**: each user has one remote desktop on the server. Closing the app asks whether to keep it running (long simulations continue, and the same screen comes back at the next login) or to end everything.
- **Launchers**: toolbar buttons start Sentaurus Workbench and Sentaurus Visual with the TCAD environment and license servers already set, so you need no personal profile.
- **Terminal**: the server's login shell, with `DISPLAY` set so programs started there (`swb &`, `xterm &`) appear on the remote desktop.
- **Server status**: CPU load, memory, your disk quota, who is using the server, your processes and Sentaurus license usage, refreshed while you are connected.

## Security

- The password is used only for the SSH login. It is never stored, logged or sent anywhere else.
- The remote desktop listens only on the server's localhost and is reached only through your SSH connection. It needs a random per-session VNC password and an X authority cookie. Both are kept in a private folder (`~/.sogangssh`, mode 700) on the server, so other users on the shared server cannot view or control your session.
- The app installs nothing on the server that needs administrator rights. It uses only programs that are already there, plus a small shell script in `~/.sogangssh`.

## Installing

Installers will be published on this repository's Releases page. The first release targets Windows.

## Development

Requirements: Node.js 24 and npm.

```
npm install
npm run dev          # run with hot reload
npm run typecheck    # type-check main/preload and renderer
npm run lint         # ESLint
npm run build:win    # Windows installer (release/)
```

Stack: Electron, electron-vite, React, TypeScript, Tailwind CSS, shadcn/ui, ssh2, xterm.js, noVNC.

- [DESIGN.md](DESIGN.md): the product design.
- [CLAUDE.md](CLAUDE.md): implementation notes and the results of checks on the school server.

## License

[MIT](LICENSE). The MIT license covers this project's code only. It does not cover the Sogang University emblem, which stays subject to the university's rules.

## Notes

- This is a student project. It is not an official Sogang University service.
- The Sogang University emblem is used unaltered, following the university's identity guidelines.
- No binaries, manuals or license files of any third-party program are included.
