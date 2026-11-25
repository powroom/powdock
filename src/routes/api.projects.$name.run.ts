import { createFileRoute } from '@tanstack/react-router'

// A server route (not a server function), so the session and the origin are checked here.
// Body: { "action": "up" | "stop" | "restart" | "pull" | "down", "volumes": true (down only) }.
// The answer is an NDJSON stream of the command's output (see src/lib/compose.ts). The command is in
// src/server/compose.server.ts.
export const Route = createFileRoute('/api/projects/$name/run')({
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
          return new Response('Run the project from pow/dock in your browser.', { status: 403 })
        }
        const { PROJECT_NAME, parseRunBody } = await import('@/lib/compose')
        if (!PROJECT_NAME.test(params.name)) return new Response('Invalid project name.', { status: 400 })

        const body: unknown = await request.json().catch(() => null)
        const run = parseRunBody(body)
        if (!run.ok) return new Response(run.error, { status: 400 })

        const { projectRunResponse } = await import('@/server/compose.server')
        return projectRunResponse(params.name, run, request.signal)
      },
    },
  },
})
