import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { is } from '@electron-toolkit/utils'

/** The bundled renderer page (production). */
export const rendererFile = join(__dirname, '../renderer/index.html')

/** The Vite dev server URL, only in development. */
export const devServerUrl = is.dev ? process.env['ELECTRON_RENDERER_URL'] : undefined

const rendererFileUrl = pathToFileURL(rendererFile).href

/**
 * True only for the app's own page: the exact bundled index.html, or the dev server's origin.
 * Any other file:// page (for example a file dropped onto the window) is not the app.
 */
export function isAppPage(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (devServerUrl) return parsed.origin === new URL(devServerUrl).origin
  parsed.hash = ''
  parsed.search = ''
  return parsed.href === rendererFileUrl
}
