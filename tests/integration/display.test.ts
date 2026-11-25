import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import WebSocket from 'ws'
import { DISPLAY_SCRIPT } from '../../src/main/remote/display-script'
import { RemoteDisplay } from '../../src/main/remote/display'
import { startFakeServer, type FakeServer } from '../fake-server/index.ts'
import { removeUserData } from './helpers/electron'
import { connected, sleep, until, watchUncaught } from './helpers/util'

vi.mock('electron', () => import('./helpers/electron'))

let server: FakeServer
const cleanup: (() => void)[] = []

beforeEach(async () => {
  server = await startFakeServer()
})
afterEach(async () => {
  cleanup.splice(0).forEach((f) => f())
  await server.close()
})
afterAll(() => removeUserData())

async function setup() {
  const { conn, client } = await connected(server)
  const display = new RemoteDisplay()
  cleanup.push(
    () => display.detach(),
    () => conn.disconnect(),
  )
  return { conn, client, display }
}

/** Bytes arriving on a WebSocket, read in exact amounts like an RFB client does. */
function byteReader(ws: WebSocket) {
  let buf = Buffer.alloc(0)
  let wake = () => {}
  ws.on('message', (data: Buffer) => {
    buf = Buffer.concat([buf, data])
    wake()
  })
  return async (n: number): Promise<Buffer> => {
    const end = Date.now() + 3000
    while (buf.length < n) {
      if (Date.now() > end) throw new Error(`timed out waiting for ${n} bytes`)
      await new Promise<void>((r) => {
        wake = r
        setTimeout(r, 50)
      })
    }
    const out = buf.subarray(0, n)
    buf = buf.subarray(n)
    return out
  }
}

/** Open the bridge URL and do the RFB 3.8 handshake (security None) through it. */
async function rfbClient(url: string) {
  const ws = new WebSocket(url, ['binary'])
  const read = byteReader(ws)
  await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))
  expect((await read(12)).toString()).toBe('RFB 003.008\n')
  ws.send(Buffer.from('RFB 003.008\n'))
  expect([...(await read(2))]).toEqual([1, 1])
  ws.send(Buffer.from([1]))
  expect((await read(4)).readUInt32BE(0)).toBe(0)
  ws.send(Buffer.from([1]))
  const init = await read(24)
  const name = await read(init.readUInt32BE(20))
  return { ws, read, width: init.readUInt16BE(0), height: init.readUInt16BE(2), name: `${name}` }
}

const keyEvent = (down: boolean, keysym: number) => {
  const m = Buffer.alloc(8)
  m[0] = 4
  m[1] = down ? 1 : 0
  m.writeUInt32BE(keysym, 4)
  return m
}

const clientCut = (text: string) => {
  const body = Buffer.from(text, 'latin1')
  const m = Buffer.alloc(8 + body.length)
  m[0] = 6
  m.writeUInt32BE(body.length, 4)
  body.copy(m, 8)
  return m
}

describe('remote display over SSH', () => {
  it('uploads the script, attaches, and bridges noVNC to the desktop', async () => {
    const { display, client } = await setup()
    const r = await display.attach(client, 1600, 900)
    expect(r).toMatchObject({ ok: true, display: 20, password: 'fakevncpw', reused: false })
    if (!r.ok) return
    expect(r.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/vnc\/[\w-]+$/)
    expect(server.ssh.uploadedScript).toBe(DISPLAY_SCRIPT)
    expect(server.ssh.execs.map((e) => e.command)).toContain(
      'sh ~/.sogangssh/display.sh attach 1600 900 86400',
    )
    expect(display.environment).toEqual({
      display: ':20',
      xauthority: '/home/tester/.sogangssh/session/Xauthority',
    })

    const vnc = await rfbClient(r.url)
    expect(vnc).toMatchObject({ width: 1024, height: 768, name: 'fake desktop' })
    expect(server.ssh.forwards).toMatchObject([{ destPort: server.rfb.port, accepted: true }])

    // Keys and clipboard text reach the desktop; clipboard text comes back.
    vnc.ws.send(Buffer.concat([keyEvent(true, 0x61), keyEvent(false, 0x61), clientCut('café')]))
    await until(() => server.rfb.cuts.length === 1)
    expect(server.rfb.keys).toEqual([
      { down: true, keysym: 0x61 },
      { down: false, keysym: 0x61 },
    ])
    expect(server.rfb.cuts).toEqual(['café'])
    server.rfb.sendCutText('from desktop')
    const cut = await vnc.read(8 + 12)
    expect(cut[0]).toBe(3)
    expect(cut.subarray(8).toString('latin1')).toBe('from desktop')

    // A second attach reuses the bridge without asking the server again.
    const again = await display.attach(client, 1600, 900)
    expect(again).toMatchObject({ ok: true, url: r.url, reused: true })
    expect(server.ssh.execsMatching('display.sh attach')).toHaveLength(1)

    // Closing the WebSocket closes the forwarded channel too.
    vnc.ws.close()
    await until(() => server.ssh.forwards.every((f) => !f.open) && server.rfb.openClients === 0)
  })

  it('ends the desktop with the stop mode', async () => {
    const { display, client } = await setup()
    expect(await display.attach(client, 1600, 900)).toMatchObject({ ok: true })
    expect(await display.end(client)).toEqual({ ok: true })
    expect(display.environment).toBeNull()
    expect(server.ssh.desktopRunning).toBe(false)
    // The next attach starts a new desktop.
    expect(await display.attach(client, 1600, 900)).toMatchObject({ ok: true, reused: false })
  })

  it('reports a server without Xvnc', async () => {
    const { display, client } = await setup()
    server.ssh.onExec('display.sh attach', { stdout: 'ERROR noXvnc\n' })
    expect(await display.attach(client, 1600, 900)).toEqual({
      ok: false,
      error: 'noXvnc',
      detail: '',
    })
  })

  // B-007: a WebSocket closed before forwardOut finished leaked the SSH channel.
  it('leaks no channel when the WebSocket closes before the forward opens (B-007)', async () => {
    const { display, client } = await setup()
    const r = await display.attach(client, 1600, 900)
    if (!r.ok) throw new Error('no desktop')
    let release: () => void = () => {}
    server.ssh.onForward = () => new Promise((resolve) => (release = () => resolve('accept')))

    const ws = new WebSocket(r.url, ['binary'])
    await new Promise((resolve) => ws.once('open', resolve))
    await until(() => server.ssh.forwards.length === 1)
    ws.close()
    await new Promise((resolve) => ws.once('close', resolve))
    // Let the bridge's end of the WebSocket see the close too, then let the forward open.
    await sleep(100)
    release()

    await until(() => server.ssh.forwards[0].accepted)
    await until(() => !server.ssh.forwards[0].open && server.ssh.openChannels === 0)
    expect(server.rfb.openClients).toBe(0)
  })

  // B-006: an error on the forwarded VNC channel could crash main.
  it('survives a forward the server refuses or closes (B-006)', async () => {
    const uncaught = watchUncaught()
    cleanup.push(uncaught.stop)
    const { display, client } = await setup()
    const r = await display.attach(client, 1600, 900)
    if (!r.ok) throw new Error('no desktop')

    for (const decision of ['reject', 'close'] as const) {
      server.ssh.onForward = () => decision
      const ws = new WebSocket(r.url, ['binary'])
      const closed = new Promise((resolve) => ws.once('close', resolve))
      // noVNC keeps sending while the socket closes: never write to an ended stream.
      ws.once('open', () => {
        for (let i = 0; i < 20; i++) ws.send(keyEvent(true, 0x62))
      })
      await closed
    }

    // The desktop is cut off by the server while in use.
    server.ssh.onForward = () => 'accept'
    const vnc = await rfbClient(r.url)
    const closed = new Promise((resolve) => vnc.ws.once('close', resolve))
    await server.rfb.close()
    vnc.ws.send(keyEvent(true, 0x63))
    await closed
    await sleep(50)
    expect(uncaught.errors).toEqual([])
    await until(() => server.ssh.openChannels === 0)
  })

  // B-008: a bridge error after listening left the dead bridge as the session.
  it('clears the session when the bridge breaks (B-008)', async () => {
    const { display, client } = await setup()
    const first = await display.attach(client, 1600, 900)
    if (!first.ok) throw new Error('no desktop')
    // The bridge is private; an error on its server is what a broken local socket raises.
    const session = (
      display as unknown as { session: { bridge: { emit: (...a: unknown[]) => void } } }
    ).session
    session.bridge.emit('error', new Error('bridge broke'))
    expect(display.environment).toBeNull()

    const second = await display.attach(client, 1600, 900)
    expect(second).toMatchObject({ ok: true })
    if (!second.ok) return
    expect(second.url).not.toBe(first.url)
    expect(server.ssh.execsMatching('display.sh attach')).toHaveLength(2)
    await rfbClient(second.url)
  })

  // B-004: a start still running when the connection dropped became the session.
  it('throws away a start from a dropped connection (B-004)', async () => {
    const { display, client, conn } = await setup()
    let release: () => void = () => {}
    server.ssh.onExec(
      'display.sh attach',
      () => new Promise((resolve) => (release = () => resolve({ stdout: readyLine() }))),
      { once: true },
    )
    const stale = display.attach(client, 1600, 900)
    await until(() => server.ssh.execsMatching('display.sh attach').length === 1)
    // What ipc.ts does on a dropped connection or logout.
    display.detach()
    release()
    expect(await stale).toEqual({ ok: false, error: 'notConnected' })
    expect(display.environment).toBeNull()

    conn.disconnect()
    const again = await connected(server)
    cleanup.push(() => again.conn.disconnect())
    const fresh = await display.attach(again.client, 1600, 900)
    expect(fresh).toMatchObject({ ok: true })
    // Asked the server again instead of returning the stale start.
    expect(server.ssh.execsMatching('display.sh attach')).toHaveLength(2)
    if (fresh.ok) await rfbClient(fresh.url)
  })
})

const readyLine = () =>
  `READY display=20 port=${server.rfb.port} password=fakevncpw ` +
  'xauthority=/home/tester/.sogangssh/session/Xauthority reused=0\n'
