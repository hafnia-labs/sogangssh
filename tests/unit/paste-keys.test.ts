import { describe, expect, it } from 'vitest'
import {
  MODIFIERS,
  asLatin1,
  hasNonLatin1,
  missingModifiers,
  pasteEchoFilter,
  pasteKey,
  type PasteKeyEvent,
} from '@/components/app/paste-keys'

const key = (e: Partial<PasteKeyEvent>): PasteKeyEvent => ({
  altKey: false,
  metaKey: false,
  ctrlKey: false,
  shiftKey: false,
  code: '',
  key: '',
  ...e,
})

const CTRL = 0xffe3
const SHIFT = 0xffe1

describe('pasteKey', () => {
  it('knows Ctrl+V, Ctrl+Shift+V and Shift+Insert', () => {
    expect(pasteKey(key({ ctrlKey: true, code: 'KeyV', key: 'v' }))).toEqual({
      keysym: 0x76,
      code: 'KeyV',
    })
    expect(pasteKey(key({ ctrlKey: true, shiftKey: true, code: 'KeyV', key: 'V' }))).toEqual({
      keysym: 0x56,
      code: 'KeyV',
    })
    expect(pasteKey(key({ shiftKey: true, code: 'Insert', key: 'Insert' }))).toEqual({
      keysym: 0xff63,
      code: 'Insert',
    })
  })

  it('finds V by the key when the code is empty (some keyboards and input methods)', () => {
    expect(pasteKey(key({ ctrlKey: true, key: 'v' }))?.keysym).toBe(0x76)
  })

  it('leaves other keys to noVNC', () => {
    expect(pasteKey(key({ code: 'KeyV', key: 'v' }))).toBeNull()
    expect(pasteKey(key({ ctrlKey: true, code: 'KeyC', key: 'c' }))).toBeNull()
    expect(pasteKey(key({ ctrlKey: true, altKey: true, code: 'KeyV', key: 'v' }))).toBeNull()
    expect(pasteKey(key({ ctrlKey: true, metaKey: true, code: 'KeyV', key: 'v' }))).toBeNull()
    expect(pasteKey(key({ ctrlKey: true, shiftKey: true, code: 'Insert' }))).toBeNull()
    expect(pasteKey(key({ code: 'Insert', key: 'Insert' }))).toBeNull()
  })
})

describe('missingModifiers', () => {
  const ctrl = MODIFIERS.filter((m) => m.flag === 'ctrlKey')
  const both = [...MODIFIERS]

  // B-031: on Windows noVNC holds a Ctrl press back (to tell it from AltGr), so a fast Ctrl+V
  // reached the server as a plain `v`. The paste must press Ctrl itself when the server lacks it.
  it('presses Ctrl when the server does not hold it yet', () => {
    expect(missingModifiers(ctrl, new Set()).map((m) => m.keysym)).toEqual([CTRL])
  })

  it('does not press what the server already holds (left or right)', () => {
    expect(missingModifiers(ctrl, new Set([CTRL]))).toEqual([])
    expect(missingModifiers(ctrl, new Set([0xffe4]))).toEqual([])
    expect(missingModifiers(both, new Set([CTRL])).map((m) => m.keysym)).toEqual([SHIFT])
  })
})

describe('Latin-1 helpers', () => {
  it('finds characters the server clipboard cannot carry', () => {
    expect(hasNonLatin1('plain café ü')).toBe(false)
    expect(hasNonLatin1('한글')).toBe(true)
    expect(hasNonLatin1('emoji 😀')).toBe(true)
  })

  it('turns them into `?` as noVNC does, one per character', () => {
    expect(asLatin1('a한b')).toBe('a?b')
    expect(asLatin1('😀')).toBe('?')
    expect(asLatin1('café')).toBe('café')
  })
})

describe('pasteEchoFilter', () => {
  // B-032: echo suppression was permanent, so copying the pasted text again on the desktop
  // never reached the PC clipboard.
  it('skips only one echo of the last paste', () => {
    const echo = pasteEchoFilter()
    echo.pasted('hello')
    expect(echo.isEcho('hello')).toBe(true)
    expect(echo.isEcho('hello')).toBe(false)
  })

  it('compares with the text as the server got it', () => {
    const echo = pasteEchoFilter()
    echo.pasted('a한b')
    expect(echo.isEcho('a한b')).toBe(false)
    expect(echo.isEcho('a?b')).toBe(true)
  })

  it('lets other copies through', () => {
    const echo = pasteEchoFilter()
    expect(echo.isEcho('anything')).toBe(false)
    echo.pasted('one')
    expect(echo.isEcho('two')).toBe(false)
  })
})
