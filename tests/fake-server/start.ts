// Run the fake school server as its own process (for end-to-end tests of the built app):
//
//   node tests/fake-server/start.ts [--ssh-port N] [--rfb-port N] [--control-port N]
//
// Node 24 runs this TypeScript file directly (type stripping), so the fake server files use only
// erasable syntax and import each other with `.ts` extensions. It prints one JSON line with the
// ports, the test account and the host key fingerprint, then serves until stopped.
//
// The optional control port is a small HTTP API on 127.0.0.1: `GET /log` (keys, clipboard texts
// and RFB messages the client sent, plus exec commands), `GET /clear`, `GET /cut?text=…` (send
// clipboard text to the client).
import { createServer } from 'node:http'
import { parseArgs } from 'node:util'
import { TEST_PASSWORD, TEST_USER, startFakeServer } from './index.ts'

const { values } = parseArgs({
  options: {
    'ssh-port': { type: 'string' },
    'rfb-port': { type: 'string' },
    'control-port': { type: 'string' },
  },
})
const port = (v: string | undefined) => (v === undefined ? undefined : Number(v))

const server = await startFakeServer(
  {},
  { ssh: port(values['ssh-port']), rfb: port(values['rfb-port']) },
)

let control: number | undefined
if (values['control-port'] !== undefined) {
  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    res.setHeader('content-type', 'application/json')
    if (url.pathname === '/log') {
      const { keys, cuts, messages } = server.rfb
      const execs = server.ssh.execs.map((e) => e.command)
      res.end(JSON.stringify({ keys, cuts, messages, execs }))
      return
    }
    if (url.pathname === '/clear') {
      server.rfb.clear()
      res.end('{}')
      return
    }
    if (url.pathname === '/cut') {
      server.rfb.sendCutText(url.searchParams.get('text') ?? '')
      res.end('{}')
      return
    }
    res.statusCode = 404
    res.end('{}')
  })
  await new Promise<void>((resolve) =>
    http.listen(port(values['control-port']), '127.0.0.1', resolve),
  )
  control = (http.address() as { port: number }).port
}

console.log(
  JSON.stringify({
    host: '127.0.0.1',
    sshPort: server.ssh.port,
    rfbPort: server.rfb.port,
    controlPort: control,
    user: TEST_USER,
    password: TEST_PASSWORD,
    fingerprint: server.ssh.fingerprint,
  }),
)

const stop = () => void server.close().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
