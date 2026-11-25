// A minimal RFB (VNC) server for tests: RFB 3.8, security type None, a 1024×768 ServerInit. It
// never sends a framebuffer; it parses what the client sends and records key presses and
// clipboard text, and it can send clipboard text to the client (ServerCutText).
import { createServer, type AddressInfo, type Server, type Socket } from 'node:net'

export type RfbKey = { down: boolean; keysym: number }

/** Client message types (RFC 6143 and the extensions noVNC sends) and their fixed sizes. */
const MESSAGE_NAMES: Record<number, string> = {
  0: 'SetPixelFormat',
  2: 'SetEncodings',
  3: 'FramebufferUpdateRequest',
  4: 'KeyEvent',
  5: 'PointerEvent',
  6: 'ClientCutText',
  150: 'EnableContinuousUpdates',
  251: 'SetDesktopSize',
}

/** Bytes the message at the start of `buf` needs, or 0 until its length is known. */
function messageLength(buf: Buffer): number | null {
  switch (buf[0]) {
    case 0:
      return 20
    case 2:
      return buf.length < 4 ? 0 : 4 + 4 * buf.readUInt16BE(2)
    case 3:
      return 10
    case 4:
      return 8
    case 5:
      return 6
    case 6:
      return buf.length < 8 ? 0 : 8 + buf.readUInt32BE(4)
    case 150:
      return 10
    case 251:
      return buf.length < 8 ? 0 : 8 + 16 * buf[6]
    default:
      return null
  }
}

export class FakeRfbServer {
  readonly keys: RfbKey[] = []
  /** Clipboard texts the client sent (ClientCutText, Latin-1 like TigerVNC 1.8). */
  readonly cuts: string[] = []
  /** Every parsed client message by name, in order. */
  readonly messages: string[] = []
  /** Clients that finished the handshake. */
  connections = 0
  private readonly sockets = new Set<Socket>()
  readonly width: number
  readonly height: number
  private readonly server: Server

  // No parameter properties: Node runs this file with type stripping only (see start.ts).
  constructor(width = 1024, height = 768) {
    this.width = width
    this.height = height
    this.server = createServer((sock) => this.handle(sock))
  }

  get port(): number {
    return (this.server.address() as AddressInfo).port
  }

  /** Clients connected right now. */
  get openClients(): number {
    return this.sockets.size
  }

  listen(port = 0): Promise<this> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(port, '127.0.0.1', () => resolve(this))
    })
  }

  /** Send clipboard text to every connected client (ServerCutText). */
  sendCutText(text: string): void {
    const body = Buffer.from(text, 'latin1')
    const msg = Buffer.alloc(8 + body.length)
    msg[0] = 3
    msg.writeUInt32BE(body.length, 4)
    body.copy(msg, 8)
    for (const s of this.sockets) s.write(msg)
  }

  clear(): void {
    this.keys.length = 0
    this.cuts.length = 0
    this.messages.length = 0
  }

  close(): Promise<void> {
    for (const s of this.sockets) s.destroy()
    return new Promise((resolve) => this.server.close(() => resolve()))
  }

  private handle(sock: Socket): void {
    this.sockets.add(sock)
    sock.on('close', () => this.sockets.delete(sock))
    sock.on('error', () => {})
    let stage: 'version' | 'security' | 'init' | 'messages' = 'version'
    let buf = Buffer.alloc(0)
    sock.write('RFB 003.008\n')

    sock.on('data', (data) => {
      buf = Buffer.concat([buf, data])
      for (;;) {
        if (stage === 'version') {
          if (buf.length < 12) return
          buf = buf.subarray(12)
          // One security type: None.
          sock.write(Buffer.from([1, 1]))
          stage = 'security'
        } else if (stage === 'security') {
          if (buf.length < 1) return
          buf = buf.subarray(1)
          // SecurityResult: OK.
          sock.write(Buffer.alloc(4))
          stage = 'init'
        } else if (stage === 'init') {
          // ClientInit (shared flag).
          if (buf.length < 1) return
          buf = buf.subarray(1)
          sock.write(this.serverInit())
          stage = 'messages'
          this.connections++
        } else {
          if (buf.length < 1) return
          const need = messageLength(buf)
          if (need === null) {
            this.messages.push(`Unknown(${buf[0]})`)
            buf = Buffer.alloc(0)
            return
          }
          if (need === 0 || buf.length < need) return
          const msg = buf.subarray(0, need)
          buf = buf.subarray(need)
          this.messages.push(MESSAGE_NAMES[msg[0]])
          if (msg[0] === 4) this.keys.push({ down: msg[1] === 1, keysym: msg.readUInt32BE(4) })
          if (msg[0] === 6) this.cuts.push(msg.subarray(8).toString('latin1'))
        }
      }
    })
  }

  /** ServerInit: size, a 32-bit true-colour pixel format and the desktop name. */
  private serverInit(): Buffer {
    const name = Buffer.from('fake desktop')
    const init = Buffer.alloc(24 + name.length)
    init.writeUInt16BE(this.width, 0)
    init.writeUInt16BE(this.height, 2)
    Buffer.from([32, 24, 0, 1, 0, 255, 0, 255, 0, 255, 16, 8, 0, 0, 0, 0]).copy(init, 4)
    init.writeUInt32BE(name.length, 20)
    name.copy(init, 24)
    return init
  }
}
