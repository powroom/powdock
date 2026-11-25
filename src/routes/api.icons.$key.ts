import { createFileRoute } from '@tanstack/react-router'

// A server route (not a server function). The brand logos are public, so no session is checked here.
// The tile uses each SVG as a CSS mask. The paths are in src/server/image-icon-paths.server.ts.
export const Route = createFileRoute('/api/icons/$key')({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const { iconSvg } = await import('@/server/image-icon-paths.server')
        const svg = iconSvg(params.key)
        if (svg === null) return new Response('Unknown icon.', { status: 404 })
        return new Response(svg, {
          headers: {
            'Content-Type': 'image/svg+xml',
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Type-Options': 'nosniff',
          },
        })
      },
    },
  },
})
