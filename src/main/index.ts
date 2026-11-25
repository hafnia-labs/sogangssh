import { join } from 'node:path'
import { app, BrowserWindow, shell } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { devServerUrl, rendererFile } from './app-page'
import { askBeforeQuit, registerIpcHandlers, ssh, updater } from './ipc'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'sogangSSH',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  win.once('ready-to-show', () => win.show())

  // While connected, closing asks "keep running" or "end everything" first.
  win.on('close', (event) => {
    if (askBeforeQuit()) event.preventDefault()
  })

  // Open external links in the default browser and never create new app windows.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // The app is a single page: never navigate away from it. This also stops a file dropped onto
  // the window from opening there with the preload API (reloads are not navigations).
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())

  if (devServerUrl) {
    void win.loadURL(devServerUrl)
  } else {
    void win.loadFile(rendererFile)
  }
}

void app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.sogangssh.app')
  registerIpcHandlers()

  // F12 opens DevTools in development; Ctrl+R reload is disabled in production.
  app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

  createWindow()

  // Installed app only: look for a new release now and every few hours.
  void updater.start()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quitting (e.g. Cmd+Q) asks the same question. Once allowed, close the SSH connection; the
// remote desktop stays on the server unless the user chose to end it.
app.on('before-quit', (event) => {
  if (askBeforeQuit()) event.preventDefault()
  else ssh.disconnect()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
