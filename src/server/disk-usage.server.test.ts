import { describe, expect, test } from 'bun:test'
import { DISK_USAGE_TTL_MS, decideDiskUsage, type DiskUsageDecisionInput } from './disk-usage.server'

// The pure decision of the disk usage cache. Nothing here reads Docker.

const NOW = 1_000_000

function input(overrides: Partial<DiskUsageDecisionInput> = {}): DiskUsageDecisionInput {
  return {
    hasValue: true,
    builtAt: NOW - 1_000,
    builtGeneration: 5,
    generation: 5,
    now: NOW,
    ttlMs: DISK_USAGE_TTL_MS,
    force: false,
    ...overrides,
  }
}

describe('decideDiskUsage', () => {
  test('no answer yet means a load (the caller waits)', () => {
    expect(decideDiskUsage(input({ hasValue: false }))).toBe('load')
  })

  test('a forced read always loads, even when the answer is fresh', () => {
    expect(decideDiskUsage(input({ force: true }))).toBe('load')
  })

  test('a fresh answer is served as it is', () => {
    expect(decideDiskUsage(input())).toBe('serve')
  })

  test('an answer older than 60 seconds is served and refreshed in the background', () => {
    expect(decideDiskUsage(input({ builtAt: NOW - DISK_USAGE_TTL_MS + 1 }))).toBe('serve')
    expect(decideDiskUsage(input({ builtAt: NOW - DISK_USAGE_TTL_MS }))).toBe('refresh')
  })

  test('a disk generation that moved (destroy event, prune) makes the answer stale at once', () => {
    expect(decideDiskUsage(input({ generation: 6 }))).toBe('refresh')
  })

  test('a stale answer is never a load, so the pages do not wait for it', () => {
    expect(decideDiskUsage(input({ generation: 6, builtAt: NOW - 5 * DISK_USAGE_TTL_MS }))).toBe('refresh')
  })
})
