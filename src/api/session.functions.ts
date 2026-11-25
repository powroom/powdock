import { createServerFn } from '@tanstack/react-start'
import type { AuthState } from '@/lib/types'
import { authValidators } from './validators'

/**
 * The only server functions that run without a session. They are listed in
 * src/api/public-functions.ts, and that list must match this file (see public-functions.test.ts).
 * Do not add a function here unless it has to work before sign-in.
 */

export const authStateFn = createServerFn({ method: 'GET' }).handler(async (): Promise<AuthState> => {
  const { getRequest } = await import('@tanstack/react-start/server')
  const { SESSION_COOKIE, authState } = await import('@/server/auth.server')
  const { readCookie } = await import('@/server/http/util.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => authState(readCookie(getRequest(), SESSION_COOKIE)), 'Could not load sign-in state.')
})

export const signInFn = createServerFn({ method: 'POST' })
  .validator(authValidators().credentials)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
    const { signIn } = await import('@/server/auth.server')
    const { clientIp, sessionCookieHeader } = await import('@/server/http/util.server')
    const { withClientErrors } = await import('@/lib/redact')
    const request = getRequest()
    const session = await withClientErrors(
      async () => signIn(data.username.trim(), data.password, await clientIp(request)),
      'Sign-in failed.',
    )
    setResponseHeader('Set-Cookie', sessionCookieHeader(request, session.token, session.maxAgeSec))
    return { ok: true }
  })

export const completeSetupFn = createServerFn({ method: 'POST' })
  .validator(authValidators().credentials)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { getRequest, setResponseHeader } = await import('@tanstack/react-start/server')
    const { setUpFirstAdmin } = await import('@/server/auth.server')
    const { sessionCookieHeader } = await import('@/server/http/util.server')
    const { withClientErrors } = await import('@/lib/redact')
    const request = getRequest()
    const session = await withClientErrors(() => setUpFirstAdmin(data.username.trim(), data.password), 'Setup failed.')
    setResponseHeader('Set-Cookie', sessionCookieHeader(request, session.token, session.maxAgeSec))
    return { ok: true }
  })
