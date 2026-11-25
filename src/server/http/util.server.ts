import { SESSION_COOKIE } from '@/server/auth.server'

/**
 * Cookie and client address helpers for the sign-in server functions. The server functions
 * run through TanStack Start, so the request comes in as a plain Request.
 */

export { readCookie } from './cookie'

/** POWDOCK_SECURE_COOKIES: true and false are forced; auto means Secure when the request is https. */
function secureCookies(request: Request): boolean {
  const setting = (process.env.POWDOCK_SECURE_COOKIES ?? 'auto').trim().toLowerCase()
  if (setting === 'true') return true
  if (setting === 'false') return false
  const forwarded = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim().toLowerCase()
  return forwarded === 'https' || new URL(request.url).protocol === 'https:'
}

/** The session cookie. A token with maxAgeSec 0 clears it (logout). */
export function sessionCookieHeader(request: Request, token: string, maxAgeSec: number): string {
  const secure = secureCookies(request) ? '; Secure' : ''
  return `${SESSION_COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}${secure}`
}

/** POWDOCK_TRUST_PROXY=true: the server sits behind a reverse proxy that sets X-Forwarded-For. */
function trustProxy(): boolean {
  return (process.env.POWDOCK_TRUST_PROXY ?? '').trim().toLowerCase() === 'true'
}

/**
 * The client address for the login rate limit. With POWDOCK_TRUST_PROXY=true, the first address
 * in X-Forwarded-For wins (then X-Real-IP). Otherwise, or when the headers are missing, the
 * socket address is used. Without a socket address the result is 'unknown'.
 */
export function clientIpFrom(request: Request, socketAddress: string | undefined): string {
  if (trustProxy()) {
    const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
    if (forwarded) return forwarded
    const realIp = request.headers.get('x-real-ip')?.trim()
    if (realIp) return realIp
  }
  return socketAddress || 'unknown'
}

/** The client's address for this request. Used only for the login rate limit. */
export async function clientIp(request: Request): Promise<string> {
  // xForwardedFor is off: the header is read only when POWDOCK_TRUST_PROXY allows it.
  const { getRequestIP } = await import('@tanstack/react-start/server')
  return clientIpFrom(request, getRequestIP({ xForwardedFor: false }) ?? undefined)
}
