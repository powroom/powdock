import { describe, expect, test } from 'bun:test'
import { formatBytes, formatDate, formatDateTime, formatPercent, formatRate, timeAgo } from './format'

const DAY = 86_400_000

describe('timeAgo', () => {
  test('recent times in minutes, hours and days', () => {
    expect(timeAgo(Date.now() - 5 * 60_000)).toBe('5m ago')
    expect(timeAgo(Date.now() - 3 * 3_600_000)).toBe('3h ago')
    expect(timeAgo(Date.now() - 12 * DAY)).toBe('12d ago')
  })

  test('older times in months and years, never as a calendar date', () => {
    expect(timeAgo(Date.now() - 45 * DAY)).toBe('1mo ago')
    expect(timeAgo(Date.now() - 200 * DAY)).toBe('7mo ago')
    expect(timeAgo(Date.now() - 800 * DAY)).toBe('2y ago')
  })
})

describe('timeAgo with an explicit now', () => {
  const now = Date.parse('2026-11-24T08:00:00Z')

  test('the age is measured from now, not from the clock', () => {
    expect(timeAgo(now - 5 * 60_000, now)).toBe('5m ago')
    expect(timeAgo(now - 20_000, now)).toBe('just now')
    expect(timeAgo(new Date(now - 3 * 3_600_000).toISOString(), now)).toBe('3h ago')
  })
})

describe('formatDateTime and formatDate', () => {
  test('an empty value is a dash, and text that is not a date is shown as it is', () => {
    expect(formatDateTime('')).toBe('-')
    expect(formatDateTime('not a date')).toBe('not a date')
    expect(formatDate('')).toBe('-')
    expect(formatDate('not a date')).toBe('not a date')
  })

  test('a date is formatted in the reader locale, with its year', () => {
    expect(formatDateTime('2026-04-17T06:53:00Z')).toContain('2026')
    expect(formatDate('2026-04-17T06:53:00Z')).toContain('2026')
    expect(formatDateTime(Date.parse('2026-04-17T06:53:00Z'))).toContain('2026')
  })
})

describe('formatRate and formatPercent', () => {
  test('rates are bytes per second', () => {
    expect(formatRate(0)).toBe('0 B/s')
    expect(formatRate(1.2 * 1024 * 1024)).toBe('1.2 MB/s')
    expect(formatRate(300 * 1024)).toBe('300 KB/s')
    expect(formatRate(null)).toBe('-')
  })

  test('CPU percent has one decimal', () => {
    expect(formatPercent(12.345)).toBe('12.3%')
    expect(formatPercent(0)).toBe('0.0%')
    expect(formatPercent(null)).toBe('-')
  })
})

describe('formatBytes below one kilobyte', () => {
  test('a fraction of a byte is rounded (an average is never shown with decimals)', () => {
    expect(formatBytes(170.92305124353197)).toBe('171 B')
    expect(formatRate(0.4)).toBe('0 B/s')
  })
})
