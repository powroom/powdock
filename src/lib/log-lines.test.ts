import { describe, expect, test } from 'bun:test'
import {
  MAX_LOG_LINES,
  appendEntries,
  downloadText,
  estimateRows,
  filterEntries,
  formatClock,
  logFileName,
  tailLabel,
  type LogEntry,
} from './log-lines'

const line = (seq: number, m: string, s: 'out' | 'err' = 'out', t: string | null = null): LogEntry => ({
  seq,
  s,
  t,
  m,
})

describe('appendEntries', () => {
  test('adds records with consecutive sequence numbers', () => {
    const next = appendEntries(
      [line(1, 'a')],
      [
        { s: 'err', t: null, m: 'b' },
        { s: 'out', t: null, m: 'c' },
      ],
      2,
    )
    expect(next.map((entry) => [entry.seq, entry.m, entry.s])).toEqual([
      [1, 'a', 'out'],
      [2, 'b', 'err'],
      [3, 'c', 'out'],
    ])
  })

  test('keeps only the newest lines when the cap is passed', () => {
    const lines = [line(1, 'a'), line(2, 'b'), line(3, 'c')]
    const next = appendEntries(lines, [{ s: 'out', t: null, m: 'd' }], 4, 3)
    expect(next.map((entry) => entry.m)).toEqual(['b', 'c', 'd'])
  })

  test('the default cap is 10,000 lines', () => {
    const many = Array.from({ length: MAX_LOG_LINES }, (_, i) => line(i + 1, `${i}`))
    const next = appendEntries(many, [{ s: 'out', t: null, m: 'new' }], MAX_LOG_LINES + 1)
    expect(next.length).toBe(MAX_LOG_LINES)
    expect(next[0]?.seq).toBe(2)
    expect(next[next.length - 1]?.m).toBe('new')
  })

  test('an empty batch returns the same lines', () => {
    const lines = [line(1, 'a')]
    expect(appendEntries(lines, [], 2)).toEqual(lines)
  })
})

describe('filterEntries', () => {
  const lines = [line(1, 'GET /home 200'), line(2, 'ERROR timeout'), line(3, 'get /api 500')]

  test('matches case-insensitively, on the text only', () => {
    expect(filterEntries(lines, 'get').map((entry) => entry.seq)).toEqual([1, 3])
    expect(filterEntries(lines, '  ERROR ').map((entry) => entry.seq)).toEqual([2])
  })

  test('an empty query keeps every line', () => {
    expect(filterEntries(lines, '  ')).toHaveLength(3)
  })
})

describe('formatClock', () => {
  test('shows the local time with milliseconds, cutting nanoseconds', () => {
    const local = new Date(2026, 0, 2, 3, 4, 5, 123)
    const iso = local.toISOString().replace(/\.\d{3}Z$/, '.123456789Z')
    expect(formatClock(iso)).toBe(
      `${String(local.getHours()).padStart(2, '0')}:${String(local.getMinutes()).padStart(2, '0')}:05.123`,
    )
  })

  test('empty for no timestamp or an unreadable one', () => {
    expect(formatClock(null)).toBe('')
    expect(formatClock('not a time')).toBe('')
  })
})

describe('downloadText', () => {
  test('one line each, with the timestamp when there is one', () => {
    const lines = [line(1, 'first', 'out', '2026-01-02T03:04:05Z'), line(2, 'second')]
    expect(downloadText(lines)).toBe('2026-01-02T03:04:05Z first\nsecond\n')
  })

  test('empty when there are no lines', () => {
    expect(downloadText([])).toBe('')
  })
})

describe('logFileName', () => {
  test('keeps safe characters and replaces the rest', () => {
    expect(logFileName('shop-web_1.0')).toBe('shop-web_1.0.log')
    expect(logFileName('my app/../x')).toBe('my_app_.._x.log')
    expect(logFileName('...')).toBe('container.log')
  })
})

describe('tail labels and row estimates', () => {
  test('the largest choice is "All"', () => {
    expect(tailLabel(100)).toBe('Last 100')
    expect(tailLabel(MAX_LOG_LINES)).toBe('All')
  })

  test('estimateRows counts wrapped rows, never less than one', () => {
    expect(estimateRows('', 80)).toBe(1)
    expect(estimateRows('x'.repeat(80), 80)).toBe(1)
    expect(estimateRows('x'.repeat(81), 80)).toBe(2)
    expect(estimateRows('abc', 0)).toBe(3)
  })
})
