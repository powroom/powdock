import { describe, expect, test } from 'bun:test'
import { peakOf, timeOffsetLabel } from './stats-view'

describe('peakOf', () => {
  test('the highest value, with null values left out', () => {
    expect(peakOf([1, null, 3])).toBe(3)
  })

  test('no values give null', () => {
    expect(peakOf([])).toBeNull()
    expect(peakOf([null])).toBeNull()
  })
})

describe('timeOffsetLabel', () => {
  test('now, seconds and minutes', () => {
    expect(timeOffsetLabel(0)).toBe('now')
    expect(timeOffsetLabel(400)).toBe('now')
    expect(timeOffsetLabel(12_000)).toBe('-12s')
    expect(timeOffsetLabel(60_000)).toBe('-1m 0s')
    expect(timeOffsetLabel(65_000)).toBe('-1m 5s')
  })
})
