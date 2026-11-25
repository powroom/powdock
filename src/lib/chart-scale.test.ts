import { describe, expect, test } from 'bun:test'
import {
  AXIS_MINIMUM,
  axisScale,
  HISTORY_MS,
  MIN_WINDOW_MS,
  nearestSample,
  niceAtLeast,
  timeTicks,
  timeWindow,
} from './chart-scale'

describe('niceAtLeast', () => {
  test('the smallest 1, 2, 2.5, 5 or 10 times a power of ten that is at least the value', () => {
    expect(niceAtLeast(0.25)).toBe(0.25)
    expect(niceAtLeast(3)).toBe(5)
    expect(niceAtLeast(2.2)).toBe(2.5)
    expect(niceAtLeast(1000)).toBe(1000)
    expect(niceAtLeast(22.5)).toBe(25)
  })
})

describe('axisScale headroom', () => {
  test('the top is at least 20% above the highest value, and the ticks are nice', () => {
    expect(axisScale(50)).toEqual({ top: 80, ticks: [20, 40, 60, 80] })
    const scale = axisScale(37)
    expect(scale.top).toBeGreaterThanOrEqual(37 * 1.2)
    expect(scale.ticks.at(-1)).toBe(scale.top)
  })

  test('three steps give three grid lines', () => {
    expect(axisScale(50, { steps: 3 })).toEqual({ top: 60, ticks: [20, 40, 60] })
  })

  test('a memory value that fills its range still has room above it', () => {
    const scale = axisScale(100 * 1024 * 1024, { binary: true })
    expect(scale.top).toBeGreaterThanOrEqual(120 * 1024 * 1024)
    expect(scale.top).toBe(200 * 1024 * 1024)
  })

  test('the steps of a binary axis are whole multiples of the unit', () => {
    // 75 MB in view: the top is 100 MB, with ticks at 25, 50, 75 and 100 MB
    const scale = axisScale(75 * 1024 * 1024, { binary: true, minTop: AXIS_MINIMUM.memory.minTop })
    expect(scale.ticks).toEqual([25, 50, 75, 100].map((mb) => mb * 1024 * 1024))
  })
})

describe('axisScale minimum top per unit', () => {
  test('an idle rate (all zero) gets a 1 KB/s scale, not 1 B/s', () => {
    const scale = axisScale(0, AXIS_MINIMUM.rate)
    expect(scale.top).toBe(1024)
    expect(scale.ticks).toEqual([256, 512, 768, 1024])
  })

  test('an idle CPU gets a 1% scale', () => {
    expect(axisScale(0, AXIS_MINIMUM.percent)).toEqual({ top: 1, ticks: [0.25, 0.5, 0.75, 1] })
  })

  test('an idle memory gets a 1 MB scale', () => {
    const scale = axisScale(0, AXIS_MINIMUM.memory)
    expect(scale.top).toBe(1024 * 1024)
    expect(scale.ticks).toEqual([256, 512, 768, 1024].map((kb) => kb * 1024))
  })

  test('a value above the minimum is not clamped to it', () => {
    expect(axisScale(50, AXIS_MINIMUM.percent).top).toBe(80)
  })

  test('no minimum and no values still gives a positive top', () => {
    const scale = axisScale(0)
    expect(scale.top).toBeGreaterThan(0)
    expect(scale.ticks).toHaveLength(4)
  })
})

describe('timeWindow', () => {
  test('a long history shows the last five minutes', () => {
    expect(timeWindow(0, HISTORY_MS * 3)).toEqual({ start: HISTORY_MS * 2, end: HISTORY_MS * 3 })
  })

  test('a short history starts at the first sample', () => {
    const { start, end } = timeWindow(100_000 - 20_000, 100_000)
    expect(end - start).toBe(MIN_WINDOW_MS)
  })

  test('the window is never shorter than a minute, even with one sample', () => {
    const { start, end } = timeWindow(500_000, 500_000)
    expect(end - start).toBe(MIN_WINDOW_MS)
  })

  test('a window of 2 minutes starts at its first sample', () => {
    const { start, end } = timeWindow(0, 120_000)
    expect(end - start).toBe(120_000)
  })
})

describe('timeTicks', () => {
  test('a one minute window is labelled every 15 seconds', () => {
    expect(timeTicks(60_000).map((tick) => tick.label)).toEqual(['now', '-15s', '-30s', '-45s'])
    expect(timeTicks(60_000).map((tick) => tick.offsetMs)).toEqual([0, 15_000, 30_000, 45_000])
  })

  test('a two minute window is labelled every 30 seconds', () => {
    expect(timeTicks(120_000).map((tick) => tick.label)).toEqual(['now', '-30s', '-60s', '-90s'])
  })

  test('a longer window is labelled every minute', () => {
    expect(timeTicks(300_000).map((tick) => tick.label)).toEqual(['now', '-1m', '-2m', '-3m', '-4m'])
  })
})

describe('nearestSample', () => {
  const times = [0, 2000, 4000, 6000]

  test('snaps to the nearest sample that has a value', () => {
    const present = [false, true, true, true]
    // at 500 ms the nearest sample (index 0) has no value, so the next one with a value is taken
    expect(nearestSample(times, present, 500)).toBe(1)
    expect(nearestSample(times, present, 3900)).toBe(2)
  })

  test('no tooltip left of the first sample', () => {
    expect(nearestSample(times, [true, true, true, true], -10)).toBe(-1)
  })

  test('right of the last sample it is the last one with a value', () => {
    expect(nearestSample(times, [true, true, true, false], 9000)).toBe(2)
  })

  test('no values or no samples give -1', () => {
    expect(nearestSample(times, [false, false, false, false], 2000)).toBe(-1)
    expect(nearestSample([], [], 5)).toBe(-1)
  })
})
