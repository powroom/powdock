import { describe, expect, test } from 'bun:test'
import { ISOLATED, runInChildProcess } from './http/test-process'

// Stateful: runs in a child process with its own POWDOCK_DATA_DIR (see test-process.ts).
// These are the sign-in, setup, state and password flows that the browser's server functions
// (src/api/session.functions.ts, src/api/account.functions.ts) call.
if (!ISOLATED) {
  test('auth flows pass in an isolated process', () => runInChildProcess(import.meta.path), 120_000)
} else {
  const PASSWORD = 'correct horse battery'
  const NEXT_PASSWORD = 'another long password'
  const IP = '198.51.100.20'

  delete process.env.POWDOCK_ADMIN_PASSWORD
  delete process.env.POWDOCK_SECURE_COOKIES

  const auth = await import('@/server/auth.server')

  describe('state before and after setup', () => {
    test('before setup: setup is required and nobody is signed in', async () => {
      expect(await auth.authState(null)).toEqual({
        setupRequired: true,
        authenticated: false,
        username: null,
      })
    })

    test('setup refuses a short password and creates no admin', async () => {
      await expect(auth.setUpFirstAdmin('admin', 'short')).rejects.toThrow('at least 8')
      expect(await auth.isSetupRequired()).toBe(true)
    })

    test('setup creates the admin and returns a 30 day session that verifies', async () => {
      const session = await auth.setUpFirstAdmin('admin', PASSWORD)
      expect(session.maxAgeSec).toBe(30 * 86_400)
      expect(await auth.verifySession(session.token)).toBe(true)
      expect(await auth.isSetupRequired()).toBe(false)
    })

    test('setup again is refused with the sign-in message, and changes nothing', async () => {
      await expect(auth.setUpFirstAdmin('other', PASSWORD)).rejects.toThrow(
        'An admin account already exists. Sign in instead.',
      )
      expect((await auth.getAuthFile()).admin?.username).toBe('admin')
    })

    test('state with a session reports the signed-in admin', async () => {
      const session = await auth.signIn('admin', PASSWORD, IP)
      expect(await auth.authState(session.token)).toEqual({
        setupRequired: false,
        authenticated: true,
        username: 'admin',
      })
    })

    test('a tampered session does not count as signed in', async () => {
      const session = await auth.signIn('admin', PASSWORD, IP)
      const forged = session.token.slice(0, -2) + (session.token.endsWith('AA') ? 'BB' : 'AA')
      expect((await auth.authState(forged)).authenticated).toBe(false)
      expect((await auth.authState(undefined)).authenticated).toBe(false)
    })
  })

  describe('sign-in', () => {
    test('a wrong password or username is refused with the same message', async () => {
      await expect(auth.signIn('admin', 'not the password', IP)).rejects.toThrow('Wrong username or password.')
      await expect(auth.signIn('root', PASSWORD, IP)).rejects.toThrow('Wrong username or password.')
    })

    test('the right password starts a session', async () => {
      const session = await auth.signIn('admin', PASSWORD, IP)
      expect(await auth.verifySession(session.token)).toBe(true)
    })

    test('more than 10 failures from one address answer with the rate limit, even for the right password', async () => {
      const limitedIp = '198.51.100.21'
      for (let i = 0; i < 10; i++) {
        await expect(auth.signIn('admin', 'wrong password', limitedIp)).rejects.toThrow('Wrong username or password.')
      }
      const limited = auth.signIn('admin', PASSWORD, limitedIp)
      await expect(limited).rejects.toBeInstanceOf(auth.RateLimitError)
      await expect(limited).rejects.toThrow('Too many failed sign-in attempts. Try again later.')
      // another address is not limited
      expect(await auth.verifyLogin('admin', PASSWORD, '198.51.100.22')).toBe(true)
    })

    test('changing the password needs a valid session', async () => {
      await expect(auth.changeOwnPassword(undefined, PASSWORD, NEXT_PASSWORD)).rejects.toThrow('Sign in to change')
    })

    test('a wrong current password is refused and nothing changes', async () => {
      const session = await auth.signIn('admin', PASSWORD, IP)
      await expect(auth.changeOwnPassword(session.token, 'wrong current one', NEXT_PASSWORD)).rejects.toThrow(
        'Current password is wrong.',
      )
      expect(await auth.verifySession(session.token)).toBe(true)
    })

    test('a short new password is refused and nothing changes', async () => {
      const session = await auth.signIn('admin', PASSWORD, IP)
      await expect(auth.changeOwnPassword(session.token, PASSWORD, 'short')).rejects.toThrow('at least 8')
      expect(await auth.verifySession(session.token)).toBe(true)
    })

    test('a change issues a new session, logs out the old one and replaces the password', async () => {
      const oldSession = await auth.signIn('admin', PASSWORD, IP)
      const newSession = await auth.changeOwnPassword(oldSession.token, PASSWORD, NEXT_PASSWORD)
      expect(newSession.token).not.toBe(oldSession.token)

      expect(await auth.verifySession(oldSession.token)).toBe(false)
      expect((await auth.authState(oldSession.token)).authenticated).toBe(false)
      expect((await auth.authState(newSession.token)).authenticated).toBe(true)

      await expect(auth.signIn('admin', PASSWORD, IP)).rejects.toThrow('Wrong username or password.')
      expect(await auth.verifyLogin('admin', NEXT_PASSWORD, IP)).toBe(true)
    })
  })
}
