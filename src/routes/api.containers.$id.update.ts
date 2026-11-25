import { createFileRoute } from '@tanstack/react-router'

// A server route (not a server function), so the session and the origin are checked here. The body is
// empty. The answer is an NDJSON stream of the steps (see src/lib/compose.ts). The update itself is in
// src/server/container-update.server.ts. Only containers that are not Compose services use this route.
export const Route = createFileRoute('/api/containers/$id/update')({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        const { SESSION_COOKIE, verifySession } = await import('@/server/auth.server')
        const { readCookie } = await import('@/server/http/util.server')
        if (!(await verifySession(readCookie(request, SESSION_COOKIE)))) {
          return new Response('Sign in first.', { status: 401 })
        }
        const { isSameOrigin } = await import('@/lib/terminal-protocol')
        if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
          return new Response('Update the container from pow/dock in your browser.', { status: 403 })
        }
        const { CONTAINER_ID } = await import('@/api/validators')
        if (!CONTAINER_ID.test(params.id)) return new Response('Invalid container ID.', { status: 400 })

        const { containerUpdateResponse } = await import('@/server/container-update.server')
        return containerUpdateResponse(params.id)
      },
    },
  },
})
