// Minimal types for the parts of noVNC (@novnc/novnc, core/rfb.js) the app uses.
declare module '@novnc/novnc' {
  export type RfbCredentials = { username?: string; password?: string; target?: string }

  export type RfbOptions = {
    credentials?: RfbCredentials
    shared?: boolean
    wsProtocols?: string[]
  }

  export type RfbDisconnectEvent = CustomEvent<{ clean: boolean }>
  export type RfbClipboardEvent = CustomEvent<{ text: string }>
  export type RfbSecurityFailureEvent = CustomEvent<{ status: number; reason?: string }>

  export default class RFB extends EventTarget {
    constructor(target: HTMLElement, urlOrChannel: string | WebSocket, options?: RfbOptions)
    scaleViewport: boolean
    resizeSession: boolean
    clipViewport: boolean
    viewOnly: boolean
    focusOnClick: boolean
    background: string
    qualityLevel: number
    compressionLevel: number
    disconnect(): void
    sendCredentials(credentials: RfbCredentials): void
    focus(): void
    blur(): void
    clipboardPasteFrom(text: string): void
    sendKey(keysym: number, code: string, down?: boolean): void
  }
}
