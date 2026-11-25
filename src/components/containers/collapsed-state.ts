// The project sections the user collapsed, kept in this browser only. Storage can be blocked
// (private mode, full quota), so every access is wrapped and the page works without it.

const STORAGE_KEY = 'powdock.containers.collapsed'

export function readCollapsed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '[]')
    return new Set(Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [])
  } catch {
    return new Set()
  }
}

export function writeCollapsed(keys: ReadonlySet<string>): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...keys]))
  } catch {
    // Not saved: the sections just open again on the next visit.
  }
}
