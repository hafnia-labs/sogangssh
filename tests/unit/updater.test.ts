// src/main/updater.ts with `electron` and `electron-updater` mocked: checks only in the installed
// app, allows pre-releases, reports a downloaded version, never quits by itself and swallows errors.
import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { AppUpdater } from 'electron-updater'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => ({
  app: { isPackaged: true, getVersion: () => '1.0.0' },
}))
vi.mock('electron', () => ({ ...electron, default: electron }))

class FakeAutoUpdater extends EventEmitter {
  logger: unknown = 'default'
  allowPrerelease = false
  autoDownload = false
  autoInstallOnAppQuit = false
  checkForUpdates = vi.fn(async () => null as unknown)
  quitAndInstall = vi.fn()
}

const mocked = vi.hoisted(() => ({ autoUpdater: null as unknown }))
vi.mock('electron-updater', () => ({
  get autoUpdater() {
    return mocked.autoUpdater
  },
}))

const { Updater, CHECK_INTERVAL_MS, pickAutoUpdater } = await import('../../src/main/updater')

let fake: FakeAutoUpdater
let statuses: unknown[]
let logs: string[]

function make() {
  return new Updater({ onStatus: (s) => statuses.push(s), log: (l) => logs.push(l) })
}

beforeEach(() => {
  electron.app.isPackaged = true
  fake = new FakeAutoUpdater()
  mocked.autoUpdater = fake
  statuses = []
  logs = []
})
afterEach(() => vi.useRealTimers())

describe('Updater', () => {
  it('does nothing in a development run', async () => {
    electron.app.isPackaged = false
    const updater = make()
    await updater.start()
    expect(fake.checkForUpdates).not.toHaveBeenCalled()
    expect(fake.listenerCount('update-downloaded')).toBe(0)
    expect(updater.installNow()).toBe(false)
  })

  it('checks at startup with pre-releases allowed and background download', async () => {
    const updater = make()
    await updater.start()
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(fake.allowPrerelease).toBe(true)
    expect(fake.autoDownload).toBe(true)
    expect(fake.autoInstallOnAppQuit).toBe(true)
    expect(fake.logger).toBeNull()
    updater.stop()
  })

  it('checks again every few hours until a version is ready', async () => {
    vi.useFakeTimers()
    const updater = make()
    await updater.start()
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2)
    fake.emit('update-downloaded', { version: '1.1.0' })
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS)
    expect(fake.checkForUpdates).toHaveBeenCalledTimes(2)
    updater.stop()
  })

  it('reports a downloaded version but never quits by itself', async () => {
    const updater = make()
    await updater.start()
    expect(updater.status).toEqual({ currentVersion: '1.0.0', readyVersion: null })
    fake.emit('update-available', { version: '1.1.0' })
    expect(statuses).toEqual([])
    fake.emit('update-downloaded', { version: '1.1.0' })
    expect(statuses).toEqual([{ currentVersion: '1.0.0', readyVersion: '1.1.0' }])
    expect(updater.isReady).toBe(true)
    expect(fake.quitAndInstall).not.toHaveBeenCalled()
    updater.stop()
  })

  it('installs silently and starts again only when asked, after a download', async () => {
    const updater = make()
    await updater.start()
    expect(updater.installNow()).toBe(false)
    fake.emit('update-downloaded', { version: '1.1.0' })
    expect(updater.installNow()).toBe(true)
    expect(fake.quitAndInstall).toHaveBeenCalledWith(true, true)
    updater.stop()
  })

  it('swallows errors from the check and the error event, logging one short line', async () => {
    fake.checkForUpdates.mockRejectedValueOnce(
      new Error('net::ERR_INTERNET_DISCONNECTED\n    at stack line'),
    )
    const updater = make()
    await updater.start()
    await vi.waitFor(() => expect(logs).toHaveLength(1))
    expect(logs[0]).toBe('check failed: net::ERR_INTERNET_DISCONNECTED')
    // An EventEmitter without an error listener would throw here.
    expect(() => fake.emit('error', new Error('sha512 checksum mismatch'))).not.toThrow()
    expect(logs[1]).toBe('failed: sha512 checksum mismatch')
    expect(statuses).toEqual([])
    updater.stop()
  })

  // B-037: Node's ESM view of electron-updater has autoUpdater only on `default`.
  it('finds autoUpdater on the default export of the CommonJS package (B-037)', async () => {
    // How the packaged main really sees the package: Node's own import(), outside Vitest.
    const probe = execFileSync(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "const m = await import('electron-updater'); console.log(JSON.stringify(['autoUpdater' in m, 'autoUpdater' in m.default]))",
      ],
      { encoding: 'utf8' },
    )
    expect(JSON.parse(probe)).toEqual([false, true])
    const updater = { checkForUpdates: () => null } as unknown as AppUpdater
    expect(pickAutoUpdater({ default: { autoUpdater: updater } })).toBe(updater)
    expect(pickAutoUpdater({ autoUpdater: updater })).toBe(updater)
    expect(() => pickAutoUpdater({ default: {} })).toThrow('no autoUpdater')
  })

  it('stays quiet when electron-updater cannot be loaded', async () => {
    const updater = new Updater({
      onStatus: (s) => statuses.push(s),
      log: (l) => logs.push(l),
      load: () => Promise.reject(new Error('missing app-update.yml')),
    })
    await expect(updater.start()).resolves.toBeUndefined()
    expect(logs).toEqual(['not available: missing app-update.yml'])
  })
})
