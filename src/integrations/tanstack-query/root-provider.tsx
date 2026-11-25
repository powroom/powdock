import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'

const SESSION_EXPIRED = 'UNAUTHENTICATED'

export function getContext() {
  // Set once the browser is sent to the sign-in page, so a burst of failing calls
  // does not start several redirects.
  let redirecting = false

  const onError = (error: Error) => {
    if (error.message !== SESSION_EXPIRED || typeof window === 'undefined' || redirecting) return
    const { pathname, search } = window.location
    if (pathname === '/login' || pathname === '/setup') return
    redirecting = true
    void queryClient.invalidateQueries({ queryKey: ['auth'] })
    window.location.assign(`/login?redirect=${encodeURIComponent(pathname + search)}`)
  }

  const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: (count, error) =>
          error.message !== SESSION_EXPIRED &&
          count < 1 &&
          !/does not exist|not found|permission denied/i.test(error.message),
      },
    },
  })
  return { queryClient }
}
