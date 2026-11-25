import { useEffect, useEffectEvent } from 'react'

export const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

export const modKey = isMac ? '⌘' : 'Ctrl'

/** Display a shortcut, e.g. shortcut('S') → "⌘S" on macOS, "Ctrl+S" elsewhere. */
export function shortcut(key: string, opts: { shift?: boolean; alt?: boolean; mod?: boolean } = {}): string {
  const mod = opts.mod ?? true
  if (isMac) return `${opts.alt ? '⌥' : ''}${opts.shift ? '⇧' : ''}${mod ? '⌘' : ''}${key}`
  return [mod && 'Ctrl', opts.alt && 'Alt', opts.shift && 'Shift', key].filter(Boolean).join('+')
}

/**
 * Global keyboard shortcut. `combo` like "mod+k", "mod+shift+enter", "/".
 * `mod` = ⌘ on macOS, Ctrl elsewhere.
 */
export function useHotkey(
  combo: string,
  handler: (event: KeyboardEvent) => void,
  options: {
    enabled?: boolean
    /** also fire while typing in a field (plain-key shortcuts never do by default) */
    allowInInputs?: boolean
    /** never fire while typing in a field, even with a modifier (e.g. Ctrl+Z keeps undoing text) */
    skipInInputs?: boolean
  } = {},
) {
  // Effect event: always calls the latest handler without re-subscribing the listener.
  const onHotkey = useEffectEvent(handler)
  const { enabled = true, allowInInputs = false, skipInInputs = false } = options

  useEffect(() => {
    if (!enabled) return
    const parts = combo.toLowerCase().split('+')
    const key = parts[parts.length - 1]!
    const wantMod = parts.includes('mod')
    const wantShift = parts.includes('shift')
    const wantAlt = parts.includes('alt')

    const onKeyDown = (e: KeyboardEvent) => {
      // already handled by something closer to the target (e.g. the SQL editor)
      if (e.defaultPrevented) return
      // The terminal takes every key (Ctrl+K is a shell key there), so no app shortcut fires inside it.
      if (e.target instanceof Element && e.target.closest('[data-terminal]')) return
      const mod = isMac ? e.metaKey : e.ctrlKey
      if (wantMod !== mod) return
      // symbols like "?" need Shift on most layouts, so Shift is not checked for them
      const symbol = !/^[a-z0-9]$/.test(key) && key.length === 1
      if (!symbol && wantShift !== e.shiftKey) return
      if (wantAlt !== e.altKey) return
      // with Alt (Option on macOS) e.key is a special character: compare the physical key too
      const pressed = e.key.toLowerCase()
      if (
        pressed !== key &&
        !(
          key.length === 1 &&
          /^[a-z0-9]$/.test(key) &&
          e.code.toLowerCase() === (/\d/.test(key) ? `digit${key}` : `key${key}`)
        )
      )
        return
      if (skipInInputs || (!allowInInputs && !wantMod)) {
        const t = e.target as HTMLElement | null
        if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      }
      e.preventDefault()
      onHotkey(e)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [combo, enabled, allowInInputs, skipInInputs])
}
