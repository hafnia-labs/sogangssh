import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

// A packaged build: no dev server. (@electron-toolkit/utils needs Electron itself.)
vi.mock('@electron-toolkit/utils', () => ({ is: { dev: false } }))

const { isAppPage, rendererFile } = await import('../../src/main/app-page')

// B-001: any file:// page counted as the app, so a file dropped onto the window got the preload
// API and could type into the live SSH shell.
describe('isAppPage', () => {
  const app = pathToFileURL(rendererFile).href

  it('accepts only the bundled index.html (with any hash or query)', () => {
    expect(isAppPage(app)).toBe(true)
    expect(isAppPage(`${app}#/main`)).toBe(true)
    expect(isAppPage(`${app}?x=1`)).toBe(true)
  })

  it('refuses any other page', () => {
    expect(isAppPage(pathToFileURL(rendererFile.replace('index.html', 'other.html')).href)).toBe(
      false,
    )
    expect(isAppPage(pathToFileURL('/tmp/dropped.html').href)).toBe(false)
    expect(isAppPage('https://example.com/')).toBe(false)
    expect(isAppPage('not a url')).toBe(false)
  })
})
