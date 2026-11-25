// Pure helpers for the log viewer: the line buffer, the search, the clock column, the download and the
// tail choices. The React code in src/components/containers/detail uses them.

import type { LogRecord } from './log-wire'

/** The most lines the viewer holds. The oldest go first. */
export const MAX_LOG_LINES = 10_000

export interface LogEntry extends LogRecord {
  /** counts every line of the stream, so each one has a key that stays the same */
  seq: number
}

/** Adds records after `lines`, keeps the newest `max`, and returns a new array. */
export function appendEntries(
  lines: readonly LogEntry[],
  records: readonly LogRecord[],
  firstSeq: number,
  max: number = MAX_LOG_LINES,
): LogEntry[] {
  const added = records.map((record, index): LogEntry => ({ ...record, seq: firstSeq + index }))
  const combined = lines.length === 0 ? added : [...lines, ...added]
  return combined.length > max ? combined.slice(combined.length - max) : combined
}

/** Lines whose text contains the query, ignoring case. An empty query keeps every line. */
export function filterEntries(lines: readonly LogEntry[], query: string): LogEntry[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return [...lines]
  return lines.filter((line) => line.m.toLowerCase().includes(needle))
}

const pad = (value: number, width = 2) => String(value).padStart(width, '0')

/**
 * The local clock time of a Docker timestamp, as HH:mm:ss.SSS. Docker keeps nanoseconds, which
 * are cut to milliseconds. Empty when there is no timestamp or it cannot be read.
 */
export function formatClock(time: string | null): string {
  if (!time) return ''
  const ms = Date.parse(time.replace(/(\.\d{3})\d+/, '$1'))
  if (Number.isNaN(ms)) return ''
  const date = new Date(ms)
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

/** The text of the lines for a download: one per line, with the Docker timestamp when there is one. */
export function downloadText(lines: readonly LogEntry[]): string {
  if (lines.length === 0) return ''
  return `${lines.map((line) => (line.t ? `${line.t} ${line.m}` : line.m)).join('\n')}\n`
}

/** "<name>.log" with the characters a file name should not have replaced. */
export function logFileName(containerName: string): string {
  const safe = containerName.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^[._]+/, '')
  return `${safe || 'container'}.log`
}

/** How many lines the tail menu offers. The last choice is every line the viewer holds. */
export const TAIL_CHOICES: readonly number[] = [100, 500, 1000, 5000, MAX_LOG_LINES]

export function tailLabel(count: number): string {
  return count === MAX_LOG_LINES ? 'All' : `Last ${count}`
}

/**
 * How many text rows a line takes when it wraps in `columns` characters. The viewer measures
 * the real height once a line is drawn, so this only has to be close.
 */
export function estimateRows(text: string, columns: number): number {
  return Math.max(1, Math.ceil(text.length / Math.max(1, columns)))
}
