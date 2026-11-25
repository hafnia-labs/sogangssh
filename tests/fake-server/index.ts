// The local fake school server: SSH (with port forwarding) in front of a fake RFB desktop.
// Integration tests start one per file; `start.ts` runs one as a standalone process.
import { FakeRfbServer } from './rfb.ts'
import { FakeSshServer, type FakeSshOptions } from './ssh.ts'

export { FakeRfbServer, type RfbKey } from './rfb.ts'
export {
  FakeSshServer,
  type Account,
  type ExecMatch,
  type ExecReply,
  type ExecRequest,
  type FakeSshOptions,
  type ForwardDecision,
} from './ssh.ts'

/** Test-only account. Never a real account or password. */
export const TEST_USER = 'tester'
export const TEST_PASSWORD = 'test-only-pw-1'

export type FakeServer = {
  ssh: FakeSshServer
  rfb: FakeRfbServer
  close: () => Promise<void>
}

/** Start the fake RFB and SSH servers on random 127.0.0.1 ports. */
export async function startFakeServer(
  options: FakeSshOptions = {},
  ports: { ssh?: number; rfb?: number } = {},
): Promise<FakeServer> {
  const rfb = await new FakeRfbServer().listen(ports.rfb ?? 0)
  const ssh = await new FakeSshServer({
    accounts: { [TEST_USER]: { password: TEST_PASSWORD } },
    rfbPort: rfb.port,
    ...options,
  }).listen(ports.ssh ?? 0)
  return {
    ssh,
    rfb,
    close: async () => {
      await ssh.close()
      await rfb.close()
    },
  }
}
