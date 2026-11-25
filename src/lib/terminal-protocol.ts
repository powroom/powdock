/**
 * The terminal protocol. The server bridge (src/server/terminal.server.ts) and the Terminal tab
 * both use it, so the rules live here, in pure functions that the unit tests cover.
 *
 * The WebSocket URL is /api/containers/<id>/terminal?shell=<shell>&cols=<n>&rows=<n>.
 *
 * Browser to server:
 * - binary frames: keyboard input, as the raw bytes of the text typed
 * - text frames: JSON control messages. Only { "type": "resize", "cols": n, "rows": n } exists.
 *
 * Server to browser:
 * - binary frames: terminal output, as raw bytes
 * - text frames: JSON events. { "type": "ready" } once the shell runs, { "type": "exit", "code": n | null }
 *   when the shell exits, and { "type": "error", "message": "..." } when the shell cannot start.
 */

/** The shells the Terminal tab offers, by name. Docker finds each name on the container's PATH. */
export const TERMINAL_SHELLS = ['bash', 'zsh', 'fish', 'sh'] as const
export type TerminalShell = (typeof TERMINAL_SHELLS)[number]

export const DEFAULT_SHELL: TerminalShell = 'sh'
export const COLS_RANGE = { min: 10, max: 500 } as const
export const ROWS_RANGE = { min: 5, max: 200 } as const
export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24

/** The command the exec runs for a shell. */
export function execCommand(shell: TerminalShell): string[] {
  return [shell]
}

/** The known shells named in the lines of the check's output, in TERMINAL_SHELLS order, without repeats. */
export function parseShellList(output: string): TerminalShell[] {
  const lines = new Set(output.split('\n').map((line) => line.trim()))
  return TERMINAL_SHELLS.filter((shell) => lines.has(shell))
}

/** The shell the tab opens: bash when there is one, else the first in the list, else null. */
export function preferredShell(shells: readonly TerminalShell[]): TerminalShell | null {
  return shells.includes('bash') ? 'bash' : (shells[0] ?? null)
}

/** The text for a shell that failed to start. Docker's "not found" errors become a plain line, others stay as they are. */
export function startErrorText(message: string, shell: TerminalShell): string {
  return /no such file or directory|executable file not found/.test(message)
    ? `${shell} is not installed in this container.`
    : message
}

export interface TerminalParams {
  shell: TerminalShell
  cols: number
  rows: number
}

/** The shell, cols and rows of the WebSocket URL. Missing values take their defaults. */
export function parseTerminalParams(search: URLSearchParams): TerminalParams | { error: string } {
  const shell = search.get('shell') ?? DEFAULT_SHELL
  if (!isShell(shell)) return { error: `shell must be one of ${TERMINAL_SHELLS.join(', ')}.` }
  const cols = parseRange(search.get('cols'), DEFAULT_COLS, COLS_RANGE)
  if (cols === null) return { error: `cols must be a whole number from ${COLS_RANGE.min} to ${COLS_RANGE.max}.` }
  const rows = parseRange(search.get('rows'), DEFAULT_ROWS, ROWS_RANGE)
  if (rows === null) return { error: `rows must be a whole number from ${ROWS_RANGE.min} to ${ROWS_RANGE.max}.` }
  return { shell, cols, rows }
}

export function isShell(value: string): value is TerminalShell {
  return (TERMINAL_SHELLS as readonly string[]).includes(value)
}

/** A whole number in range, or the fallback when the value is missing. Null when it is not valid. */
function parseRange(raw: string | null, fallback: number, range: { min: number; max: number }): number | null {
  if (raw === null) return fallback
  if (!/^\d+$/.test(raw)) return null
  const value = Number(raw)
  return value >= range.min && value <= range.max ? value : null
}

export interface ResizeMessage {
  type: 'resize'
  cols: number
  rows: number
}

/** A JSON control message from the browser, or null when the text is not one. */
export function parseControlMessage(text: string): ResizeMessage | null {
  const value = parseJson(text)
  if (!isRecord(value) || value.type !== 'resize') return null
  const { cols, rows } = value
  if (!isInRange(cols, COLS_RANGE) || !isInRange(rows, ROWS_RANGE)) return null
  return { type: 'resize', cols, rows }
}

export type ServerEvent = { type: 'ready' } | { type: 'exit'; code: number | null } | { type: 'error'; message: string }

export function readyEvent(): string {
  return JSON.stringify({ type: 'ready' })
}

export function exitEvent(code: number | null): string {
  return JSON.stringify({ type: 'exit', code })
}

export function errorEvent(message: string): string {
  return JSON.stringify({ type: 'error', message })
}

/** A JSON event from the server, or null when the text is not one. */
export function parseServerEvent(text: string): ServerEvent | null {
  const value = parseJson(text)
  if (!isRecord(value)) return null
  if (value.type === 'ready') return { type: 'ready' }
  if (value.type === 'exit') {
    return { type: 'exit', code: typeof value.code === 'number' ? value.code : null }
  }
  if (value.type === 'error' && typeof value.message === 'string') return { type: 'error', message: value.message }
  return null
}

/**
 * A WebSocket close reason is at most 123 bytes. The text is cut to 120 ASCII characters, and any
 * other character becomes "?", so the byte count stays small.
 */
export function closeReason(message: string): string {
  return message.replace(/[^\x20-\x7e]/g, '?').slice(0, 120)
}

/**
 * True when the Origin header names the same host as the Host header (the page that opened the
 * socket is pow/dock itself). A missing or unreadable Origin is refused.
 */
export function isSameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin || !host) return false
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase()
  } catch {
    return false
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isInRange(value: unknown, range: { min: number; max: number }): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= range.min && value <= range.max
}
