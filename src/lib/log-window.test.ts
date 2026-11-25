import { describe, expect, test } from 'bun:test'
import { buildOffsets, visibleRows } from './log-window'

describe('buildOffsets', () => {
  test('starts at 0 and adds each height', () => {
    expect([...buildOffsets(3, (i) => (i + 1) * 10)]).toEqual([0, 10, 30, 60])
  })

  test('no rows gives a single 0', () => {
    expect([...buildOffsets(0, () => 18)]).toEqual([0])
  })
})

describe('visibleRows', () => {
  const fixed = buildOffsets(100, () => 18)

  test('shows the rows that overlap the viewport', () => {
    expect(visibleRows(fixed, 0, 100, 0)).toEqual({ start: 0, end: 6 })
    expect(visibleRows(fixed, 180, 36, 0)).toEqual({ start: 10, end: 12 })
  })

  test('a row that is cut at the top edge is still drawn', () => {
    expect(visibleRows(fixed, 20, 18, 0)).toEqual({ start: 1, end: 3 })
  })

  test('overscan adds rows on both sides, inside the list', () => {
    expect(visibleRows(fixed, 180, 36, 2)).toEqual({ start: 8, end: 14 })
    expect(visibleRows(fixed, 0, 36, 5)).toEqual({ start: 0, end: 7 })
    expect(visibleRows(fixed, 1800, 500, 5)).toEqual({ start: 94, end: 100 })
  })

  test('a scroll position past the end still gives the last row', () => {
    expect(visibleRows(fixed, 99999, 100, 0)).toEqual({ start: 99, end: 100 })
  })

  test('variable heights are found by their real positions', () => {
    const tall = buildOffsets(4, (i) => (i === 1 ? 100 : 10))
    // rows start at 0, 10, 110, 120; the viewport 50..70 is inside row 1
    expect(visibleRows(tall, 50, 20, 0)).toEqual({ start: 1, end: 2 })
    expect(visibleRows(tall, 100, 30, 0)).toEqual({ start: 1, end: 4 })
  })

  test('an empty list gives an empty span', () => {
    expect(
      visibleRows(
        buildOffsets(0, () => 18),
        0,
        500,
        3,
      ),
    ).toEqual({ start: 0, end: 0 })
  })
})
