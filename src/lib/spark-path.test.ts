import { describe, expect, test } from 'bun:test'
import { sparkPaths } from './spark-path'

const W = 60
const H = 16

describe('sparkPaths', () => {
  test('leading nulls draw nothing before the first value, and the line keeps the right edge', () => {
    const paths = sparkPaths([null, null, null, 10, 20], W, H)
    expect(paths).toHaveLength(1)
    // the first drawn point is the one at index 3 of 5 (x = 45 of 60), not the left edge
    expect(paths[0]?.line.startsWith('M45')).toBe(true)
  })

  test('a gap in the middle breaks the line into two runs', () => {
    const paths = sparkPaths([1, 2, null, 3, 4], W, H)
    expect(paths).toHaveLength(2)
  })

  test('only nulls draw nothing, and no values at all draw nothing', () => {
    expect(sparkPaths([null, null], W, H)).toEqual([])
    expect(sparkPaths([], W, H)).toEqual([])
  })

  test('a zero is drawn as a value at the bottom, not skipped', () => {
    const paths = sparkPaths([0, 0], W, H)
    expect(paths).toHaveLength(1)
    expect(paths[0]?.line).toContain('M0 14.5')
  })
})
