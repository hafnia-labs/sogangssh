import { describe, expect, it } from 'vitest'
import { isLoginPasswordPrompt } from '../../src/main/ssh/login-prompts'

describe('isLoginPasswordPrompt', () => {
  it('answers plain password prompts', () => {
    for (const p of ['Password: ', 'password:', "student's password: ", '암호:', '비밀번호: ']) {
      expect(isLoginPasswordPrompt(p)).toBe(true)
    }
  })

  // B-015: on a first login with an expired password, a "new password" prompt must never be
  // answered with the login password.
  it('never answers a password change prompt', () => {
    const change = [
      'New password: ',
      'Retype new password: ',
      'Enter new password again: ',
      '(current) UNIX password: ',
      '새 암호:',
      '새 암호 재입력:',
      '(현재) UNIX 암호:',
      '암호를 다시 입력하십시오:',
    ]
    for (const p of change) expect(isLoginPasswordPrompt(p)).toBe(false)
  })

  it('leaves other prompts (OTP) unanswered', () => {
    expect(isLoginPasswordPrompt('Verification code: ')).toBe(false)
  })
})
