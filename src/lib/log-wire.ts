/**
 * The format of the container log stream between the server and the browser: one JSON object per
 * line (NDJSON). Short keys keep the stream small: s is the stream, t the Docker timestamp (or null)
 * and m the text of the line. A line that is only a newline is a heartbeat and is skipped.
 */

export interface LogRecord {
  s: 'out' | 'err'
  t: string | null
  m: string
  /** the Compose service of the line, in the merged logs of a project only */
  service?: string | null
}

export function encodeLogRecord(record: LogRecord): string {
  return `${JSON.stringify(record)}\n`
}

function isRecord(value: unknown): value is LogRecord {
  if (typeof value !== 'object' || value === null) return false
  const { s, t, m } = value as Record<string, unknown>
  return (s === 'out' || s === 'err') && (t === null || typeof t === 'string') && typeof m === 'string'
}

/** Reads one NDJSON line. Returns null for a blank line or one that is not a log record. */
export function parseLogRecord(line: string): LogRecord | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Splits text that arrives in pieces into complete lines. The text after the last newline waits
 * for the next piece, so a record split across two reads is still read whole.
 */
export function createNdjsonReader(): { push(text: string): LogRecord[] } {
  let rest = ''
  return {
    push(text) {
      const combined = rest + text
      const lastNewline = combined.lastIndexOf('\n')
      if (lastNewline === -1) {
        rest = combined
        return []
      }
      rest = combined.slice(lastNewline + 1)
      const records: LogRecord[] = []
      for (const line of combined.slice(0, lastNewline).split('\n')) {
        const record = parseLogRecord(line)
        if (record) records.push(record)
      }
      return records
    },
  }
}
