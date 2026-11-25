// Paste helpers for the remote desktop (DisplayPanel). Kept free of React and noVNC so they can be
// unit-tested.

/** The parts of a key event the paste check reads (a DOM KeyboardEvent has them all). */
export type PasteKeyEvent = {
  altKey: boolean
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  code: string
  key: string
}

/** The paste keys of X programs, as the key to send after the clipboard (X keysym and code). */
export function pasteKey(e: PasteKeyEvent): { keysym: number; code: string } | null {
  if (e.altKey || e.metaKey) return null
  // Ctrl+V (editors) and Ctrl+Shift+V (terminals): the keysym is the letter as typed. Some
  // keyboards and input methods leave `code` empty, so the key itself is checked too.
  const isV = e.code === 'KeyV' || e.key === 'v' || e.key === 'V'
  if (e.ctrlKey && isV) return { keysym: e.shiftKey ? 0x56 : 0x76, code: 'KeyV' }
  if (e.shiftKey && !e.ctrlKey && (e.code === 'Insert' || e.key === 'Insert')) {
    return { keysym: 0xff63, code: 'Insert' }
  }
  return null
}

/** Modifiers a paste key needs: their X keysyms, and the one sent when the server lacks it. */
export const MODIFIERS = [
  { flag: 'ctrlKey', keysyms: [0xffe3, 0xffe4], keysym: 0xffe3, code: 'ControlLeft' },
  { flag: 'shiftKey', keysyms: [0xffe1, 0xffe2], keysym: 0xffe1, code: 'ShiftLeft' },
] as const

export type PasteModifier = (typeof MODIFIERS)[number]

/** The modifiers of a paste key that the server does not hold yet, so the paste must press them. */
export const missingModifiers = (mods: readonly PasteModifier[], serverDown: ReadonlySet<number>) =>
  mods.filter((m) => !m.keysyms.some((k) => serverDown.has(k)))

/** Characters the server's VNC clipboard (Latin-1 only) cannot carry; they arrive as `?`. */
export const hasNonLatin1 = (text: string) => [...text].some((c) => (c.codePointAt(0) ?? 0) > 0xff)

/** The text as the server receives it: noVNC turns characters beyond Latin-1 into `?`. */
export const asLatin1 = (text: string) =>
  [...text].map((c) => ((c.codePointAt(0) ?? 0) > 0xff ? '?' : c)).join('')

/**
 * Remembers the last text pasted from the PC, as the server got it. If the server echoes it back
 * once as a desktop copy, that echo must not replace the PC clipboard (it may have lost characters
 * on the way). Only one echo is skipped: copying the same text again on the desktop goes through.
 */
export function pasteEchoFilter() {
  let lastPasted: string | null = null
  return {
    pasted(text: string): void {
      lastPasted = asLatin1(text)
    },
    /** True (once) when a desktop copy is the echo of the last paste. */
    isEcho(text: string): boolean {
      if (text !== lastPasted) return false
      lastPasted = null
      return true
    },
  }
}
