import { describe, expect, it } from 'vitest'
import {
  LicenseSetting,
  READ_SCRIPT,
  parseLicenseOutput,
} from '../../src/main/remote/license-setting'
import { FakeClient, whenInputEnds } from './helpers/fake-ssh'

// Made-up license servers: never put real server details in tests (the repository is public).
const ONE = '27000@license.example'
const TRIAD = '27000@a.example,27000@b.example,27000@c.example'

describe('parseLicenseOutput', () => {
  it('reads the value of the LICENSE line', () => {
    expect(parseLicenseOutput(`LICENSE ${ONE}\n`)).toEqual({ ok: true, value: ONE })
    expect(parseLicenseOutput(`LICENSE ${ONE}\r\n`)).toEqual({ ok: true, value: ONE })
  })

  it('accepts several servers and a redundant triad (B-023)', () => {
    expect(parseLicenseOutput(`LICENSE ${ONE}:${TRIAD}\n`)).toEqual({
      ok: true,
      value: `${ONE}:${TRIAD}`,
    })
  })

  it('refuses a value with a trailing `;` or other shell syntax (B-025)', () => {
    for (const bad of [`${ONE};`, `${ONE} x`, '$HOME/license.dat', '~/license.dat', '`id`']) {
      expect(parseLicenseOutput(`LICENSE ${bad}\n`)).toEqual({ ok: false, reason: 'notSet' })
    }
  })

  it('refuses a value that starts with `-`, so it is never read as an option (B-025)', () => {
    expect(parseLicenseOutput('LICENSE -c\n')).toEqual({ ok: false, reason: 'notSet' })
  })

  it('takes the last LICENSE line, ignoring lines a profile printed itself (B-026)', () => {
    const out = `LICENSE_NOTE hello\nLICENSE 1@printed.by.cshrc\nLICENSE ${ONE}\n`
    expect(parseLicenseOutput(out)).toEqual({ ok: true, value: ONE })
    expect(parseLicenseOutput('LICENSEX 1@x\n')).toMatchObject({ ok: false, reason: 'failed' })
  })

  it('tells "not set" apart from a failed read (B-027)', () => {
    expect(parseLicenseOutput('LICENSE \n')).toEqual({ ok: false, reason: 'notSet' })
    expect(parseLicenseOutput('LICENSE\n')).toEqual({ ok: false, reason: 'notSet' })
    expect(parseLicenseOutput('')).toMatchObject({ ok: false, reason: 'failed' })
  })
})

describe('READ_SCRIPT', () => {
  // B-024: sourcing ~/.bash_profile with csh could hang or stop before the license line.
  // Running the script itself is planned for stage 4 (shell script tests on Linux).
  it('stops csh after 5 s and gives it no input', () => {
    expect(READ_SCRIPT).toMatch(/timeout 5 csh -f -c '[^']*' < \/dev\/null/)
  })

  it('falls back to reading the setenv line from the file', () => {
    expect(READ_SCRIPT).toContain('setenv[[:space:]][[:space:]]*SNPSLMD_LICENSE_FILE')
    // B-025: a trailing `;` or a comment is cut off in the fallback.
    expect(READ_SCRIPT).toContain("sed 's/[#;].*//'")
  })
})

describe('LicenseSetting', () => {
  it('keeps a successful read for the connection and retries a failed one (B-027)', async () => {
    let answer = 'garbage'
    const client = new FakeClient(({ channel }) =>
      whenInputEnds(channel, () => {
        channel.out(answer)
        channel.finish()
      }),
    )
    const setting = new LicenseSetting()
    expect(await setting.get(client.asClient)).toMatchObject({ ok: false, reason: 'failed' })
    answer = `LICENSE ${ONE}\n`
    expect(await setting.get(client.asClient)).toEqual({ ok: true, value: ONE })
    expect(await setting.get(client.asClient)).toEqual({ ok: true, value: ONE })
    expect(client.calls).toHaveLength(2)
    setting.forget()
    await setting.get(client.asClient)
    expect(client.calls).toHaveLength(3)
  })
})
