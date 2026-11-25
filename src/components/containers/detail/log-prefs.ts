// The log viewer's toggles, kept in this browser only. Storage can be blocked (private mode, full
// quota), so every access is wrapped and the viewer works without it.

const STORAGE_KEY = 'powdock.logs.prefs'

export interface LogPrefs {
  /** show the local time of each line */
  timestamps: boolean
  /** wrap long lines instead of scrolling them sideways */
  wrap: boolean
}

export const DEFAULT_LOG_PREFS: LogPrefs = { timestamps: false, wrap: false }

export function readLogPrefs(): LogPrefs {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? 'null')
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_LOG_PREFS
    const { timestamps, wrap } = parsed as Partial<Record<keyof LogPrefs, unknown>>
    return { timestamps: timestamps === true, wrap: wrap === true }
  } catch {
    return DEFAULT_LOG_PREFS
  }
}

export function writeLogPrefs(prefs: LogPrefs): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // Not saved: the toggles go back to their defaults on the next visit.
  }
}
