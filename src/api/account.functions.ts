import { createServerFn } from '@tanstack/react-start'
import { authValidators } from './validators'

// Both functions need a session: the global middleware in src/start.ts rejects them without one.

export const signOutFn = createServerFn({ method: 'POST' }).handler(async (): Promise<{ ok: true }> => {
  const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
  const { sessionCookieHeader } = await import('@/server/http/util.server')
  // Max-Age=0 clears the cookie in the browser.
  setResponseHeader('Set-Cookie', sessionCookieHeader(getRequest(), '', 0))
  return { ok: true }
})

export const changePasswordFn = createServerFn({ method: 'POST' })
  .validator(authValidators().passwordChange)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
    const { SESSION_COOKIE, changeOwnPassword } = await import('@/server/auth.server')
    const { readCookie, sessionCookieHeader } = await import('@/server/http/util.server')
    const { withClientErrors } = await import('@/lib/redact')
    const request = getRequest()
    // Changing the password bumps the session version, so the new cookie replaces this one.
    const session = await withClientErrors(
      () => changeOwnPassword(readCookie(request, SESSION_COOKIE), data.current, data.next),
      'Password change failed.',
    )
    setResponseHeader('Set-Cookie', sessionCookieHeader(request, session.token, session.maxAgeSec))
    return { ok: true }
  })
