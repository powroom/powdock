import { describe, expect, test } from 'bun:test'
import { compareVersions, isNewer, isVersion } from './version'

describe('compareVersions', () => {
  test('orders x.y.z numbers, comparing each part as a number', () => {
    expect(compareVersions('0.1.1', '0.1.0')).toBe(1)
    expect(compareVersions('0.1.0', '0.1.1')).toBe(-1)
    expect(compareVersions('0.1.0', '0.1.0')).toBe(0)
    expect(compareVersions('1.10.0', '1.9.0')).toBe(1)
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1)
  })

  test('a leading v is allowed on either side', () => {
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v0.2.0', 'v0.1.9')).toBe(1)
  })

  test('a prerelease is older than the same release', () => {
    expect(compareVersions('0.1.0-rc.1', '0.1.0')).toBe(-1)
    expect(compareVersions('0.1.0', '0.1.0-rc.1')).toBe(1)
    expect(compareVersions('0.1.0-rc.1', '0.0.9')).toBe(1)
    expect(compareVersions('0.1.0-beta', '0.1.0-beta')).toBe(0)
  })

  test('build metadata after + is ignored', () => {
    expect(compareVersions('0.1.0+abc', '0.1.0')).toBe(0)
  })

  test('returns null when either side is not a version', () => {
    expect(compareVersions('latest', '0.1.0')).toBeNull()
    expect(compareVersions('0.1', '0.1.0')).toBeNull()
    expect(compareVersions('0.1.0', '')).toBeNull()
  })
})

describe('isNewer', () => {
  test('only a higher version counts as newer', () => {
    expect(isNewer('0.1.1', '0.1.0')).toBe(true)
    expect(isNewer('0.1.0', '0.1.0')).toBe(false)
    expect(isNewer('0.0.9', '0.1.0')).toBe(false)
    expect(isNewer('0.1.1-rc.1', '0.1.0')).toBe(true)
    expect(isNewer('garbage', '0.1.0')).toBe(false)
  })
})

describe('isVersion', () => {
  test('accepts x.y.z with an optional v and prerelease', () => {
    expect(isVersion('1.2.3')).toBe(true)
    expect(isVersion('v1.2.3-rc.1')).toBe(true)
    expect(isVersion('1.2')).toBe(false)
    expect(isVersion('')).toBe(false)
  })
})
