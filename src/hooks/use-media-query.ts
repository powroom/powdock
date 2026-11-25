import { useCallback, useSyncExternalStore } from 'react'

// The two widths the app asks for: `lg` from 1024px up, `max-md` below 800px.
const QUERIES = {
  lg: '(min-width: 1024px)',
  'max-md': '(max-width: 799px)',
} as const

function getServerSnapshot(): boolean {
  return false
}

export function useMediaQuery(query: keyof typeof QUERIES): boolean {
  const mediaQuery = QUERIES[query]

  const subscribe = useCallback(
    (callback: () => void) => {
      const mql = window.matchMedia(mediaQuery)
      mql.addEventListener('change', callback)
      return () => mql.removeEventListener('change', callback)
    },
    [mediaQuery],
  )

  const getSnapshot = useCallback(() => window.matchMedia(mediaQuery).matches, [mediaQuery])

  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
