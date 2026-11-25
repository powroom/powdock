import { useSyncExternalStore } from 'react'

export type Theme = 'light' | 'dark' | 'system'

const KEY = 'dbx-theme'
const listeners = new Set<() => void>()

/** Inline script for <head>: applies the theme before the first paint. */
export const themeScript = `(function(){try{var t=localStorage.getItem('${KEY}')||'system';var d=t==='dark'||(t==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d)}catch(e){}})()`

function read(): Theme {
  try {
    const t = localStorage.getItem(KEY)
    return t === 'light' || t === 'dark' ? t : 'system'
  } catch {
    return 'system'
  }
}

function apply(theme: Theme) {
  const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
  document.documentElement.classList.toggle('dark', dark)
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // storage unavailable: still apply for this session
  }
  apply(theme)
  listeners.forEach((l) => l())
}

if (typeof window !== 'undefined') {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (read() === 'system') {
      apply('system')
      listeners.forEach((l) => l())
    }
  })
}

function subscribe(cb: () => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function useTheme(): { theme: Theme } {
  return { theme: useSyncExternalStore(subscribe, read, () => 'system') }
}
