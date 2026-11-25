// Pure axis maths for the charts: the value scale, the time window and the time labels.

/** The history the Stats tab keeps: five minutes. */
export const HISTORY_MS = 300_000
/** The shortest time window. A fresh container still gets this much space. */
export const MIN_WINDOW_MS = 60_000
/** The top of the value axis is at least this much above the highest value in view. */
export const HEADROOM = 1.2

/** The kinds of value axis. Each has its own smallest top, so an idle line sits on a sensible scale. */
export type AxisKind = 'percent' | 'rate' | 'memory'

export const AXIS_MINIMUM: Record<AxisKind, { minTop: number; binary: boolean }> = {
  percent: { minTop: 1, binary: false },
  rate: { minTop: 1024, binary: true },
  memory: { minTop: 1024 * 1024, binary: true },
}

const NICE = [1, 2, 2.5, 5, 10]

/** The smallest nice number (1, 2, 2.5, 5 or 10 times a power of ten) that is at least x. x must be positive. */
export function niceAtLeast(x: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(x))
  const candidate = NICE.map((multiplier) => multiplier * magnitude).find((value) => value >= x * (1 - 1e-9))
  return candidate ?? 10 * magnitude
}

/** The largest power of 1024 that is at most value (1 for anything below 1024). */
function binaryUnit(value: number): number {
  let unit = 1
  while (unit * 1024 <= value) unit *= 1024
  return unit
}

/**
 * A value axis that starts at 0. Its top is a nice number at least HEADROOM times the largest value
 * (and at least `minTop`), split into `steps` equal steps. With `binary`, the steps are nice multiples
 * of a power of 1024 (bytes), so the labels read as 25 MB, 50 MB and not as 26.2 MB.
 */
export function axisScale(
  max: number,
  options: { steps?: number; minTop?: number; binary?: boolean } = {},
): { top: number; ticks: number[] } {
  const steps = options.steps ?? 4
  const minTop = options.minTop ?? 0
  const binary = options.binary ?? false
  const target = Math.max(minTop, max * HEADROOM)
  const safeTarget = target > 0 ? target : 1
  const unit = binary ? binaryUnit(safeTarget) : 1
  const step = niceAtLeast(safeTarget / steps / unit) * unit
  // toPrecision drops the float noise (0.1 * 3 is not exactly 0.3)
  const clean = (value: number) => Number(value.toPrecision(12))
  return {
    top: clean(step * steps),
    ticks: Array.from({ length: steps }, (_, i) => clean(step * (i + 1))),
  }
}

/**
 * The start and end of the time window, in Unix milliseconds. The window ends at the last sample and
 * starts five minutes back, or at the first sample when that is later. It is never shorter than a minute.
 */
export function timeWindow(first: number, last: number): { start: number; end: number } {
  const end = last
  const start = Math.min(Math.max(first, end - HISTORY_MS), end - MIN_WINDOW_MS)
  return { start, end }
}

export interface TimeTick {
  /** how far back from the end of the window, in milliseconds */
  offsetMs: number
  label: string
}

/**
 * The labels of the time axis for a window of `spanMs`. Up to 90 seconds they are 15 seconds apart
 * ("now", "-15s", "-30s", "-45s" for a minute), up to three minutes 30 seconds apart, and longer windows
 * get one label per minute ("-1m", "-2m"). A label is kept only when it is inside the window.
 */
export function timeTicks(spanMs: number): TimeTick[] {
  const step = spanMs <= 90_000 ? 15_000 : spanMs <= 180_000 ? 30_000 : 60_000
  const inSeconds = step < 60_000
  const ticks: TimeTick[] = []
  for (let offsetMs = 0; offsetMs < spanMs; offsetMs += step) {
    ticks.push({ offsetMs, label: timeLabel(offsetMs, inSeconds) })
  }
  return ticks
}

function timeLabel(offsetMs: number, inSeconds: boolean): string {
  if (offsetMs === 0) return 'now'
  return inSeconds ? `-${offsetMs / 1000}s` : `-${offsetMs / 60_000}m`
}

/**
 * The index of the sample nearest to `time` that has a value (`present[i]`). It is -1 when the time is
 * left of the first sample, or when no sample has a value. Ties go to the earlier sample.
 */
export function nearestSample(times: readonly number[], present: readonly boolean[], time: number): number {
  if (times.length === 0 || time < (times[0] ?? 0)) return -1
  let best = -1
  let bestDistance = Number.POSITIVE_INFINITY
  for (let i = 0; i < times.length; i++) {
    if (!present[i]) continue
    const distance = Math.abs((times[i] ?? 0) - time)
    if (distance < bestDistance) {
      best = i
      bestDistance = distance
    }
  }
  return best
}
