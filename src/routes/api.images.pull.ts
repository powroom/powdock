import { createFileRoute } from '@tanstack/react-router'

// A server route (not a server function), so the session and the origin are checked here.
// Body: { "reference": "nginx:1.27" }. The answer is an NDJSON stream of Docker's progress.
// The pull itself is in src/server/image-pull.server.ts.
export const Route = createFileRoute('/api/images/pull')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { SESSION_COOKIE, verifySession } = await import('@/server/auth.server')
        const { readCookie } = await import('@/server/http/util.server')
        if (!(await verifySession(readCookie(request, SESSION_COOKIE)))) {
          return new Response('Sign in first.', { status: 401 })
        }
        // SameSite=Lax already keeps the cookie off cross-site posts. The Origin check is a second guard.
        const origin = request.headers.get('origin')
        if (origin && origin !== new URL(request.url).origin) {
          return new Response('Cross-site requests are refused.', { status: 403 })
        }

        const body: unknown = await request.json().catch(() => null)
        const reference = typeof body === 'object' && body !== null ? (body as { reference?: unknown }).reference : null
        if (typeof reference !== 'string') return new Response('Send { "reference": "name:tag" }.', { status: 400 })

        const { parseImageReference } = await import('@/lib/image-reference')
        let parsed: ReturnType<typeof parseImageReference>
        try {
          parsed = parseImageReference(reference)
        } catch (err) {
          return new Response(err instanceof Error ? err.message : 'Invalid image name.', { status: 400 })
        }

        const { imagePullResponse } = await import('@/server/image-pull.server')
        return imagePullResponse(parsed, request.signal)
      },
    },
  },
})
