import type { Messages } from './ko'

export const en: Messages = {
  language: {
    switchTo: '한국어',
    switchLabel: 'Change language',
  },
  login: {
    user: 'Username',
    password: 'Password',
    host: 'Server address',
    port: 'Port',
    submit: 'Log in',
    submitting: 'Connecting…',
    errorHost: 'Enter the server address.',
    errorEmpty: 'Enter your username and password.',
    errorPort: 'Port must be a number from 1 to 65535.',
    technicalDetail: 'Details',
    forgotPassword:
      'Forgot your password? Ask the server administrator (lab administrator) to reset it. The app cannot reset it.',
  },
  connectError: {
    invalidInput: 'Check what you entered.',
    hostNotFound: 'Cannot find the server address. Check that it is correct.',
    connectionRefused: 'The server refused the connection. Check the port number.',
    timeout:
      'Cannot reach the server. If you are off campus, check that the school VPN is connected.',
    authFailed: 'The username or password is incorrect.',
    otpRequired: 'This server asks for additional verification (OTP), which is not supported yet.',
    hostKeyUnknown: 'Checking this server for the first time.',
    passwordExpired: 'This is your first login: change your password first.',
    hostKeyChanged:
      'The server’s security key has changed, so the connection was blocked to keep you safe. Ask your IT administrator whether the server key was changed.',
    alreadyConnected: 'Already connected.',
    unknown: 'Could not connect because of an unknown error.',
  },
  hostKey: {
    title: 'First connection to this server',
    description: (host) =>
      `This is the fingerprint of ${host}. Check that it matches the one your IT administrator gave you, then continue. You will not be asked again for this server.`,
    trust: 'Trust and connect',
    cancel: 'Cancel',
    saved: 'Saved fingerprint',
    received: 'Received fingerprint',
  },
  toolbar: {
    openApp: (app) => `Open ${app}`,
    showServer: 'Show server status',
    hideServer: 'Hide server status',
    showTerminal: 'Show terminal',
    hideTerminal: 'Hide terminal',
    disconnect: 'Disconnect (the remote desktop keeps running on the server)',
    endSession: 'End session',
    changePassword: 'Change password',
  },
  connection: {
    connected: 'Connected',
    reconnecting: 'Reconnecting',
    disconnected: 'Disconnected',
  },
  server: {
    title: 'Server status',
    uptime: (days) => `Up ${days} days`,
    updated: (seconds) => `Updated ${seconds}s ago`,
    cpu: 'CPU load',
    cpuDetail: (l1, l5, l15, cores) => `1m ${l1} · 5m ${l5} · 15m ${l15} / ${cores} cores`,
    memory: 'Memory',
    homeDisk: 'Home disk (shared)',
    quota: 'My disk quota',
    usedOf: (used, total) => `${used} / ${total}`,
    licenses: 'Licenses',
    licenseLoading: 'Checking the license server…',
    licenseUnavailable: 'Could not read license usage.',
    licenseNoSetting: 'No license setting in ~/.bash_profile, so usage cannot be checked.',
    licenseNote:
      'Usage across the whole license server (including other schools). Updated every minute.',
    licenseFull: 'All in use',
    users: 'Users on the server',
    usersCount: (n) => `${n}`,
    you: 'You',
    moreUsers: (n) => `and ${n} more`,
    idle: (idle) => `Idle ${idle}`,
    idleOld: 'Idle over a day',
    noSession: 'Running jobs, not logged in',
    cores: (n) => `${n.toFixed(1)} cores`,
    loading: 'Loading server status…',
    active: 'Active',
    processes: 'My processes',
    noProcesses: 'No processes running.',
  },
  terminal: {
    title: 'Terminal',
    exited: 'The shell has ended.',
    openFailed: 'Could not open the terminal.',
    reopen: 'Open again',
  },
  display: {
    starting: 'Preparing the virtual display on the server…',
    connecting: 'Connecting to the virtual display…',
    ended:
      'The connection to the virtual display closed. The same session was opened on another PC, or the session ended.',
    stopped: 'The session has ended. Every program that was running on it was stopped too.',
    startNew: 'Start a new session',
    restart: 'Reconnect',
    errors: {
      notConnected: 'Not connected to the server.',
      noXvnc:
        'The server has no Xvnc, so a virtual display cannot be created. Contact your IT administrator.',
      startFailed: 'Could not start the virtual display.',
      timeout: 'The virtual display is taking too long to start. Try again.',
      vncFailed: 'Lost the connection to the virtual display.',
      vncAuthFailed: 'The virtual display rejected the session password. Try reconnecting.',
    },
    reconnecting: 'Reconnecting to the server…',
    disconnected: 'Lost connection to the server. Check your network and VPN.',
    backToLogin: 'Log in again',
  },
  launcher: {
    started: (app) =>
      `Started ${app} on the remote desktop. Its window may take a few seconds to appear.`,
    errors: {
      notConnected: (app) => `Cannot start ${app}: not connected to the server.`,
      noDisplay: (app) =>
        `Cannot start ${app} without a remote desktop. Start the remote desktop first.`,
      notFound: (app) => `${app} was not found on the server.`,
      exited: (app) => `${app} exited right after starting.`,
      failed: (app) => `Could not start ${app}.`,
      noLicense: (app) =>
        `Could not find the license setting for ${app}. Check that ~/.bash_profile exists on the server; if it does not, ask the TA.`,
      licenseReadFailed: (app) =>
        `Could not read the license setting for ${app} from the server. Try again in a moment.`,
      alreadyRunning: (app) =>
        `${app} is already open on the remote desktop. It may be behind another window.`,
    },
    openAnother: 'Open another',
  },
  endSession: {
    title: 'End the session?',
    description:
      'The remote desktop and every program running on it (simulations included) will be stopped. Unsaved work will be lost.',
    cancel: 'Cancel',
    confirm: 'End session',
    ending: 'Ending…',
    failed: 'Could not end the session.',
  },
  firstPassword: {
    title: 'First login: change your password',
    description:
      'The password you were given has expired, so the server only works after you set a new one. The app logs you in again with it right away.',
    hint: 'Use at least 8 characters and mix upper- and lowercase letters, digits and symbols. Avoid dictionary words, your student number and repeated characters.',
    submit: 'Change and log in',
    success: 'Password changed. Use the new password from now on.',
  },
  changePassword: {
    title: 'Change server password',
    description:
      'Changes the password of your school server account. You stay connected now; use the new password from the next login.',
    current: 'Current password',
    next: 'New password',
    confirm: 'Confirm new password',
    cancel: 'Cancel',
    submit: 'Change',
    submitting: 'Changing…',
    success: 'Password changed. Use the new password from the next login.',
    errorEmpty: 'Fill in every field.',
    errorMismatch: 'The new passwords do not match.',
    errorSame: 'The new password is the same as the current one.',
    errors: {
      notConnected: 'Not connected to the server.',
      invalidInput:
        'The password contains a character that cannot be used (such as a line break) or is too long. The new password must differ from the current one.',
      wrongPassword: 'The current password is incorrect.',
      rejected:
        'The server rejected the new password. Use a longer password that is harder to guess.',
      failed: 'Could not change the password.',
      timeout: 'The server did not answer in time, so the password was not changed. Try again.',
      busy: 'A password change is already running. Wait for it to finish.',
      maybeChanged:
        'The change was cut off, so it is not known whether the password changed. At the next login, try the new password first, then the current one.',
    },
  },
  exit: {
    title: 'Close the app?',
    description:
      'If you keep it running, the remote desktop and its programs keep running on the server, and the next login brings back the same screen. It ends by itself after 24 hours without a connection.',
    keep: 'Keep running and close',
    end: 'End everything and close',
    cancel: 'Cancel',
    ending: 'Ending…',
    failed: 'Could not end the session. Close and keep it running, or try again.',
  },
  guide: {
    name: 'Sogangi',
    hint: 'Click for a quick tour · drag to move',
    show: 'Show Sogangi',
    hide: 'Hide Sogangi',
    back: 'Back',
    next: 'Next',
    done: 'Get started',
    close: 'Close',
    progress: (step, total) => `${step} / ${total}`,
    login: {
      welcome: {
        title: "Hi! I'm Sogangi",
        text: "I'll show you how to use TCAD on the school server. Let's start by logging in.",
      },
      account: {
        title: 'Server and account',
        text: 'Enter the server address and port you got from your lab, then your ID and password. The app saves none of them, so enter them every time.',
      },
      hostKey: {
        title: 'First connection',
        text: 'The first time you connect, the app asks whether to trust the server key. Check the fingerprint and trust it once; it will not ask again.',
      },
      forgot: {
        title: 'Forgot your password?',
        text: 'The app cannot recover it. Ask the server administrator to reset it.',
      },
    },
    main: {
      welcome: {
        title: "You're in!",
        text: "Let's look around. Press Next and I'll point things out one by one.",
      },
      launchers: {
        title: 'Start TCAD',
        text: 'These buttons start Sentaurus Workbench and Visual right away.',
      },
      display: {
        title: 'Remote desktop',
        text: 'Programs you start appear here. The desktop runs on the server, so if you choose Keep running when closing the app, you can pick up where you left off.',
      },
      terminal: {
        title: 'Terminal',
        text: 'This is the server terminal. Typing something like swb & here also opens on the desktop.',
      },
      server: {
        title: 'Server status',
        text: 'Here you see the server load, your disk quota and license usage. If all licenses are in use, wait a little before starting a tool.',
      },
      endSession: {
        title: 'When you are done',
        text: 'Use this button to end your session. If you just close the window, the app asks whether to keep it running or end everything.',
      },
      done: {
        title: 'All set!',
        text: 'Click me any time you have a question. Good luck with your research!',
      },
    },
  },
  statusBar: {
    display: (display) => `Display :${display}`,
  },
}
