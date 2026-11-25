// Pure helpers for the Stats tab: the summary figures of a card and the time labels of a chart.

/** The highest value that is present. Null when none is present. */
export function peakOf(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length === 0 ? null : Math.max(...present)
}

/** The time of a point as an offset from now: "now", "-12s" or "-1m 5s". */
export function timeOffsetLabel(ageMs: number): string {
  const seconds = Math.round(Math.max(0, ageMs) / 1000)
  if (seconds === 0) return 'now'
  if (seconds < 60) return `-${seconds}s`
  return `-${Math.floor(seconds / 60)}m ${seconds % 60}s`
}
