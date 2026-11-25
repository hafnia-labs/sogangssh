import { afterEach, describe, expect, it } from 'vitest'
import WebSocket from 'ws'
import { DISPLAY_SCRIPT } from '../../src/main/remote/display-script'
import { RemoteDisplay, parseReady } from '../../src/main/remote/display'
import { FakeChannel, FakeClient, whenInputEnds } from './helpers/fake-ssh'

const READY = 'READY display=21 port=5921 password=abcDEF12 xauthority=/tmp/xa reused=0'

describe('parseReady', () => {
  it('reads the READY line among other output', () => {
    expect(parseReady(`some banner\n${READY}\n`)).toEqual({
      display: 21,
      port: 5921,
      password: 'abcDEF12',
      xauthority: '/tmp/xa',
      reused: false,
    })
    expect(parseReady(READY.replace('reused=0', 'reused=1'))?.reused).toBe(true)
  })

  it('refuses a broken or missing READY line', () => {
    expect(parseReady('')).toBeNull()
    expect(parseReady('ERROR noXvnc\n')).toBeNull()
    expect(parseReady(READY.replace('port=5921', 'port=x'))).toBeNull()
    expect(parseReady(READY.replace('reused=0', 'reused=2'))).toBeNull()
    expect(parseReady(`${READY} extra`)).toBeNull()
  })
})

describe('DISPLAY_SCRIPT', () => {
  // B-035: selecting text on the desktop overwrote the PC clipboard.
  it('starts Xvnc with -SendPrimary=0', () => {
    expect(DISPLAY_SCRIPT).toContain('-SendPrimary=0')
  })
})

/** A server whose upload and attach answer at once, or when `release()` is called. */
function displayServer(hold = false) {
  let release = () => {}
  const held = new Promise<void>((r) => (release = r))
  const client = new FakeClient(({ command, channel }) =>
    whenInputEnds(channel, () => {
      if (command.includes('attach')) {
        void (hold ? held : Promise.resolve()).then(() => {
          channel.out(`${READY}\n`)
          channel.finish()
        })
      } else {
        channel.finish()
      }
    }),
  )
  return { client, release }
}

describe('RemoteDisplay', () => {
  const displays: RemoteDisplay[] = []
  const make = () => {
    const d = new RemoteDisplay()
    displays.push(d)
    return d
  }
  afterEach(() => displays.splice(0).forEach((d) => d.detach()))

  it('starts a desktop and reuses it', async () => {
    const { client } = displayServer()
    const display = make()
    const first = await display.attach(client.asClient, 1600, 900)
    expect(first).toMatchObject({ ok: true, display: 21, reused: false })
    expect(first.ok && first.url).toMatch(/^ws:\/\/127\.0\.0\.1:\d+\/vnc\/\S+$/)
    expect(display.environment).toEqual({ display: ':21', xauthority: '/tmp/xa' })
    expect(await display.attach(client.asClient, 1600, 900)).toMatchObject({ reused: true })
  })

  // B-004: a start that was still running when the connection dropped became the session.
  it('throws away a start from a dropped connection', async () => {
    const old = displayServer(true)
    const display = make()
    const stale = display.attach(old.client.asClient, 1600, 900)
    await new Promise((r) => setTimeout(r, 10))
    display.detach()
    old.release()
    expect(await stale).toEqual({ ok: false, error: 'notConnected' })
    expect(display.environment).toBeNull()

    const fresh = displayServer()
    expect(await display.attach(fresh.client.asClient, 1600, 900)).toMatchObject({ ok: true })
    expect(fresh.client.calls.some((c) => c.command.includes('attach'))).toBe(true)
  })

  describe('bridge', () => {
    async function openBridge() {
      const { client } = displayServer()
      const display = make()
      const r = await display.attach(client.asClient, 1600, 900)
      if (!r.ok) throw new Error('no desktop')
      const ws = new WebSocket(r.url, ['binary'])
      await new Promise((resolve, reject) => ws.once('open', resolve).once('error', reject))
      await until(() => client.forwards.length === 1)
      return { client, ws }
    }

    // B-007: a WebSocket closed before forwardOut finished leaked the SSH channel.
    it('ends a forward that opens after the WebSocket closed', async () => {
      const { client, ws } = await openBridge()
      ws.close()
      await new Promise((r) => ws.once('close', r))
      await new Promise((r) => setTimeout(r, 20))
      const stream = new FakeChannel()
      client.forwards[0].callback(undefined, stream)
      expect(stream.ended).toBe(true)
    })

    // B-006 / B-007: an error on the forwarded stream crashed main; writes went to an ended one.
    it('closes the WebSocket on a stream error and never writes to an ended stream', async () => {
      const { client, ws } = await openBridge()
      const stream = new FakeChannel()
      client.forwards[0].callback(undefined, stream)
      expect(client.forwards[0].port).toBe(5921)

      ws.send(Buffer.from('hello'))
      await until(() => stream.written.length === 1)
      stream.out('from server')

      const closed = new Promise((r) => ws.once('close', r))
      stream.emit('error', new Error('channel reset'))
      await closed
      expect(stream.ended).toBe(true)
      expect(stream.written).toEqual(['hello'])
    })
  })
})

async function until(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms
  while (!check()) {
    if (Date.now() > end) throw new Error('timed out waiting')
    await new Promise((r) => setTimeout(r, 5))
  }
}
