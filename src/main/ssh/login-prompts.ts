// Keyboard-interactive prompts during login (see connection.ts). Kept apart so they can be
// unit-tested without Electron.

// Prompts we can answer with the login password. Anything else (OTP, verification code)
// needs user input, which arrives in a later stage.
const PASSWORD_PROMPT = /password|passwd|암호|비밀번호/i
// A password change asked during authentication: never answer it with the login password.
const CHANGE_PROMPT = /new|retype|again|current|새|재입력|현재|다시/i

/** True for a prompt that asks for the login password itself (not a new one, not an OTP). */
export function isLoginPasswordPrompt(prompt: string): boolean {
  return PASSWORD_PROMPT.test(prompt) && !CHANGE_PROMPT.test(prompt)
}
