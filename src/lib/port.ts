/** The port pow/dock listens on when PORT is not set. */
export const DEFAULT_PORT = 3434

/**
 * The port from the PORT setting: the default when it is unset, otherwise the number when it is
 * an integer from 1 to 65535. Anything else (empty, "abc", "3.5", "0", "70000") gives null.
 */
export function parsePort(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_PORT
  const text = value.trim()
  if (!/^\d+$/.test(text)) return null
  const port = Number(text)
  return port >= 1 && port <= 65535 ? port : null
}
