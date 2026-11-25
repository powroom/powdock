import { describe, expect, test } from 'bun:test'
import { areaPath, runsOf, smoothPath } from './chart-path'

/** Every number in a path string, in order. */
function numbersIn(path: string): number[] {
  return (path.match(/-?\d+(\.\d+)?/g) ?? []).map(Number)
}

describe('smoothPath', () => {
  test('no points give an empty path, one point gives a move', () => {
    expect(smoothPath([])).toBe('')
    expect(smoothPath([{ x: 3, y: 4 }])).toBe('M3 4')
  })

  test('two points give one curve that starts and ends on them', () => {
    const path = smoothPath([
      { x: 0, y: 10 },
      { x: 30, y: 40 },
    ])
    expect(path.startsWith('M0 10C')).toBe(true)
    expect(path.endsWith(' 30 40')).toBe(true)
    expect(path.match(/C/g)).toHaveLength(1)
  })

  test('one curve per segment, and each curve passes through its points', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: 2 },
      { x: 30, y: 9 },
    ]
    const path = smoothPath(points)
    expect(path.match(/C/g)).toHaveLength(3)
    const numbers = numbersIn(path)
    // "M x y" is two numbers, then each curve adds six: the end point is the last pair of each curve
    expect(numbers.slice(6, 8)).toEqual([10, 5])
    expect(numbers.slice(12, 14)).toEqual([20, 2])
    expect(numbers.slice(18, 20)).toEqual([30, 9])
  })

  test('a peak does not overshoot: every control point stays inside the range of the data', () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 30, y: 0 },
      { x: 40, y: 0 },
      { x: 50, y: 10 },
    ]
    const numbers = numbersIn(smoothPath(points))
    // the y values sit at odd indexes after the first move (x y pairs)
    const ys = numbers.filter((_, i) => i % 2 === 1)
    for (const y of ys) {
      expect(y).toBeGreaterThanOrEqual(-0.01)
      expect(y).toBeLessThanOrEqual(10.01)
    }
  })

  test('a flat run stays flat', () => {
    const numbers = numbersIn(
      smoothPath([
        { x: 0, y: 5 },
        { x: 10, y: 5 },
        { x: 20, y: 5 },
      ]),
    )
    expect(numbers.filter((_, i) => i % 2 === 1).every((y) => y === 5)).toBe(true)
  })
})

describe('areaPath', () => {
  test('closes the curve down to the baseline', () => {
    const path = areaPath(
      [
        { x: 0, y: 4 },
        { x: 10, y: 2 },
      ],
      16,
    )
    expect(path.endsWith('L10 16L0 16Z')).toBe(true)
  })

  test('needs at least two points', () => {
    expect(areaPath([{ x: 0, y: 4 }], 16)).toBe('')
  })
})

describe('runsOf', () => {
  test('a gap splits the series into runs', () => {
    const a = { x: 0, y: 0 }
    const b = { x: 1, y: 1 }
    const c = { x: 2, y: 2 }
    expect(runsOf([a, b, null, c])).toEqual([[a, b], [c]])
  })

  test('no gaps give one run, and leading or trailing gaps give none', () => {
    const a = { x: 0, y: 0 }
    expect(runsOf([null, a, null])).toEqual([[a]])
    expect(runsOf([null, null])).toEqual([])
    expect(runsOf([])).toEqual([])
  })
})
