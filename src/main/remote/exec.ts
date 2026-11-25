import type { Client } from 'ssh2'

export type ExecResult = { code: number | null; stdout: string; stderr: string; error?: string }

/** Run one command to completion, optionally feeding it stdin. */
export function exec(client: Client, command: string, timeoutMs: number, stdin?: string) {
  return new Promise<ExecResult>((resolve) => {
    // ssh2 throws (instead of calling back) when the connection has just dropped (B-036).
    try {
      start()
    } catch (e) {
      resolve({
        code: null,
        stdout: '',
        stderr: '',
        error: e instanceof Error ? e.message : String(e),
      })
    }

    function start() {
      client.exec(command, (err, channel) => {
        if (err) {
          resolve({ code: null, stdout: '', stderr: '', error: err.message })
          return
        }
        let stdout = ''
        let stderr = ''
        let code: number | null = null
        const timer = setTimeout(() => {
          channel.close()
          resolve({ code: null, stdout, stderr, error: 'timeout' })
        }, timeoutMs)
        // ssh2 only emits 'close' once stdout has been consumed, so always read it.
        channel.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')))
        channel.stderr.on('data', (chunk: Buffer) => {
          stderr = (stderr + chunk.toString('utf8')).slice(-2000)
        })
        channel.on('exit', (c: number | null) => (code = c))
        // An 'error' event without a listener would crash the main process.
        channel.on('error', (e: Error) => {
          clearTimeout(timer)
          resolve({ code, stdout, stderr, error: e.message })
        })
        channel.on('close', () => {
          clearTimeout(timer)
          resolve({ code, stdout, stderr })
        })
        channel.end(stdin)
      })
    }
  })
}
