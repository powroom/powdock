import { HeadContent, Scripts, createRootRouteWithContext, Link, redirect } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { BoxIcon } from 'lucide-react'
import { authStateQuery } from '@/lib/queries'
import { ToastProvider } from '@/components/ui/toast'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { useEffect } from 'react'
import { themeScript } from '@/lib/theme'
import appCss from '../styles.css?url'
import interWoff2 from '@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url'

interface RouterContext {
  queryClient: QueryClient
}

const favicon = `data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#262626"/><g fill="#fafafa"><rect x="9.25" y="5" width="5.5" height="4.5" rx="1"/><rect x="6" y="10.5" width="5.5" height="4.5" rx="1"/><rect x="12.5" y="10.5" width="5.5" height="4.5" rx="1"/><rect x="4.5" y="16.5" width="15" height="2" rx="1"/></g></svg>`,
)}`

export const Route = createRootRouteWithContext<RouterContext>()({
  // Runs in the browser on every navigation (SSR is off): first start goes to /setup,
  // signed-out visitors go to /login, and signed-in visitors skip the sign-in pages.
  beforeLoad: async ({ context, location }) => {
    const state = await context.queryClient.fetchQuery(authStateQuery())
    const path = location.pathname
    if (state.setupRequired) {
      if (path !== '/setup') throw redirect({ to: '/setup' })
      return
    }
    if (path === '/setup') throw redirect({ to: state.authenticated ? '/' : '/login' })
    if (!state.authenticated) {
      if (path !== '/login') throw redirect({ to: '/login', search: { redirect: location.href } })
      return
    }
    if (path === '/login') throw redirect({ to: '/' })
  },
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'pow/dock' },
      { name: 'description', content: 'A lightweight web UI for the Docker Engine on your machine.' },
    ],
    links: [
      // Fetch the UI font together with the HTML so text never reflows when it swaps in.
      // (Dev serves fonts lazily from node_modules, where a preload only produces warnings.)
      ...(import.meta.env.PROD
        ? [{ rel: 'preload', href: interWoff2, as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' as const }]
        : []),
      { rel: 'stylesheet', href: appCss },
      { rel: 'icon', href: favicon },
    ],
  }),
  shellComponent: RootDocument,
  notFoundComponent: NotFound,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  useQuery(authStateQuery())

  useEffect(() => {
    // Warm up the monospace font (IDs and logs) before the first list renders.
    // Not a <link rel=preload>: that warns on pages that show no monospace text.
    document.fonts.load('1em "Geist Mono Variable"').catch(() => {})
  }, [])

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <HeadContent />
      </head>
      <body className="relative">
        <TooltipProvider delay={400}>
          <ToastProvider position="bottom-right">
            <div className="isolate relative flex h-svh flex-col">{children}</div>
          </ToastProvider>
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  )
}

function NotFound() {
  return (
    <Empty className="h-full">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <BoxIcon />
        </EmptyMedia>
        <EmptyTitle>Page not found</EmptyTitle>
        <EmptyDescription>The page you are looking for does not exist.</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button render={<Link to="/containers" />} variant="outline">
          Back to containers
        </Button>
      </EmptyContent>
    </Empty>
  )
}
