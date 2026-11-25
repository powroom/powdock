import { createCsrfMiddleware, createMiddleware, createStart } from '@tanstack/react-start'
import { isPublicServerFn } from '@/api/public-functions'
import { needsSignIn } from '@/api/session-gate'

// Server functions can start and stop containers, so only accept same-origin calls.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
})

// A browser that leaves mid-request (it navigated or closed the tab) closes the connection while the
// request is still read, and the read fails. Nobody waits for that answer, so the error gets the status
// 499 ("client closed request"): TanStack then answers quietly instead of logging a server error.
const clientGoneMiddleware = createMiddleware().server(async ({ next, request }) => {
  try {
    return await next()
  } catch (error) {
    if (request.signal.aborted && error instanceof Error) Object.assign(error, { status: 499 })
    throw error
  }
})

// Every server function needs a signed-in session, except those listed in src/api/public-functions.ts. The exemption is matched by the function's name and file (serverFnMeta),
// never by path or header. A call without a known identity needs a session.
const authMiddleware = createMiddleware({ type: 'function' }).server(async ({ next, serverFnMeta }) => {
  if (isPublicServerFn(serverFnMeta)) return next()
  const { getRequest } = await import('@tanstack/react-start/server')
  const { SESSION_COOKIE, verifySession } = await import('@/server/auth.server')
  const { readCookie } = await import('@/server/http/util.server')
  const sessionValid = await verifySession(readCookie(getRequest(), SESSION_COOKIE))
  if (needsSignIn({ isPublic: false, sessionValid })) {
    throw new Error('UNAUTHENTICATED')
  }
  return next()
})

// The app is a client-rendered page that talks to the Docker Engine through server functions.
export const startInstance = createStart(() => ({
  defaultSsr: false,
  requestMiddleware: [clientGoneMiddleware, csrfMiddleware],
  functionMiddleware: [authMiddleware],
}))
