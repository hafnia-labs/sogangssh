// Checks on the source files themselves, for mistakes no function call would show.
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve('.')

function files(dir: string, ext: RegExp): string[] {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile() && ext.test(e.name))
    .map((e) => join(e.parentPath, e.name))
}

const read = (path: string) => readFileSync(path, 'utf8')
const rel = (path: string) => relative(root, path).replace(/\\/g, '/')

/** The bodies of every String.raw template in a source text (up to the closing backtick). */
function rawTemplates(source: string): string[] {
  const bodies: string[] = []
  let at = source.indexOf('String.raw`')
  while (at !== -1) {
    let i = at + 'String.raw`'.length
    const start = i
    while (i < source.length && !(source[i] === '`' && source[i - 1] !== '\\')) i++
    bodies.push(source.slice(start, i))
    at = source.indexOf('String.raw`', i + 1)
  }
  return bodies
}

describe('shell scripts embedded with String.raw', () => {
  it('finds the scripts it checks', () => {
    const all = files(join(root, 'src/main'), /\.ts$/).flatMap((f) => rawTemplates(read(f)))
    // display, status, license and license-setting scripts at least.
    expect(all.length).toBeGreaterThanOrEqual(4)
  })

  // A dollar sign followed by an opening brace inside String.raw is a JavaScript substitution,
  // not sh syntax: the script on the server would silently lose that part.
  it('never contain a dollar sign followed by an opening brace', () => {
    const bad = files(join(root, 'src/main'), /\.ts$/).filter((f) =>
      rawTemplates(read(f)).some((body) => body.includes('$' + '{')),
    )
    expect(bad.map(rel)).toEqual([])
  })

  it('the checker sees a substitution', () => {
    expect(rawTemplates('const s = String.raw`echo $' + '{HOME}`').join()).toContain('$' + '{')
  })
})

describe('renderer', () => {
  const sources = files(join(root, 'src'), /\.(ts|tsx)$/)

  // B-029: the 0.1.0 build showed a mock latency from a mockup file as if it were measured.
  it('never imports from a mocks folder', () => {
    const bad = sources.filter((f) => /from\s+['"][^'"]*\bmocks\//.test(read(f)))
    expect(bad.map(rel)).toEqual([])
  })

  it('shows no placeholder latency in the status bar', () => {
    const statusBar = read(join(root, 'src/renderer/src/components/app/StatusBar.tsx'))
    expect(statusBar).not.toMatch(/latency|\bms\b/i)
  })

  // B-030: a Promise from Electron's asynchronous clipboard API was put in a synchronous IPC
  // reply and froze the window. Only invoke/handle (async) and fire-and-forget send are used.
  it('uses no synchronous IPC', () => {
    const bad = sources.filter((f) => /\bsendSync\b|\breturnValue\b/.test(read(f)))
    expect(bad.map(rel)).toEqual([])
  })
})

describe('installer', () => {
  // B-002: a deny-list also packed untracked local files (personal notes) into the installer.
  it('ships only an allow-list of built files', () => {
    const yml = read(join(root, 'electron-builder.yml'))
    const block = /^files:\n((?:[ \t]+-.*\n)+)/m.exec(yml)
    expect(block).not.toBeNull()
    const entries = block![1]
      .split('\n')
      .map((l) => l.trim().replace(/^-\s*/, ''))
      .filter(Boolean)
    expect(entries).toEqual(['out/**', 'resources/**'])
  })
})
