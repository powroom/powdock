export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return 'Unknown'
  if (bytes < 1024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`
}

/** A rate in bytes per second: "1.2 MB/s". A missing rate (the first sample) is "-". */
export function formatRate(bytesPerSecond: number | null | undefined): string {
  if (bytesPerSecond == null) return '-'
  return `${formatBytes(bytesPerSecond)}/s`
}

/** A CPU percent with one decimal: "12.3%". A missing value is "-". */
export function formatPercent(percent: number | null | undefined): string {
  if (percent == null) return '-'
  return `${percent.toFixed(1)}%`
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })
const full = new Intl.NumberFormat('en')

export function formatCount(n: number | null | undefined, opts?: { compact?: boolean }): string {
  if (n == null) return 'Unknown'
  return opts?.compact && n >= 10_000 ? compact.format(n) : full.format(n)
}

/** "1 row", "2 rows", "12,400 rows" (or "12.4K rows" when compact) */
export function countLabel(n: number, singular: string, opts?: { compact?: boolean }): string {
  return `${formatCount(n, opts)} ${n === 1 ? singular : `${singular}s`}`
}

/** A relative age: "just now", "12m ago", "3h ago", "6d ago", "7mo ago". `now` is injectable for tests. */
export function timeAgo(iso: string | number | null | undefined, now: number = Date.now()): string {
  if (!iso) return 'never'
  const date = typeof iso === 'number' ? iso : Date.parse(iso)
  if (Number.isNaN(date)) return String(iso)
  const diff = now - date
  const sec = Math.round(diff / 1000)
  if (sec < 45) return 'just now'
  const min = Math.round(sec / 60)
  if (min < 60) return `${min}m ago`
  const hours = Math.round(min / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days}d ago`
  // months and years too, so a list never mixes "28d ago" with a calendar date
  const months = Math.round(days / 30.44)
  if (months < 12) return `${months}mo ago`
  return `${Math.round(days / 365.25)}y ago`
}

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dateOnly = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

/** Formats a date with the given formatter. An empty value is "-", and text that is not a date is shown as it is. */
function formatWith(formatter: Intl.DateTimeFormat, value: string | number): string {
  if (value === '') return '-'
  const time = typeof value === 'number' ? value : Date.parse(value)
  return Number.isNaN(time) ? String(value) : formatter.format(time)
}

/** A date and time in the reader's locale: "Apr 17, 2026, 6:53 AM". */
export function formatDateTime(value: string | number): string {
  return formatWith(dateTime, value)
}

/** A date in the reader's locale: "Apr 17, 2026". */
export function formatDate(value: string | number): string {
  return formatWith(dateOnly, value)
}
