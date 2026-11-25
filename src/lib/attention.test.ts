import { describe, expect, test } from 'bun:test'
import { attentionItems, reasonOf } from './attention'
import type { RecentFailure } from './recent-failures'
import type { ContainerStats, ContainerSummary } from './types'

const HOST_MEMORY = 8 * 1024 ** 3

function container(overrides: Partial<ContainerSummary>): ContainerSummary {
  return {
    id: 'a'.repeat(64),
    shortId: 'aaaaaaaaaaaa',
    name: 'web',
    image: 'nginx:1.27',
    imageId: 'sha256:' + 'b'.repeat(64),
    state: 'running',
    status: 'Up 3 hours',
    createdAt: '2026-11-01T00:00:00.000Z',
    ports: [],
    project: null,
    service: null,
    isSelf: false,
    ...overrides,
  }
}

function stat(id: string, memUsage: number, memLimit: number): ContainerStats {
  return { id, cpuPercent: 1, memUsage, memLimit, spark: [] }
}

const OOM: RecentFailure = { id: 'x', name: 'db', reason: 'Ran out of memory' }

describe('reasonOf', () => {
  test('an unhealthy container says so', () => {
    expect(reasonOf(container({ status: 'Up 4 minutes (unhealthy)' }), undefined, HOST_MEMORY, undefined)).toEqual({
      kind: 'unhealthy',
      reason: 'Unhealthy',
    })
  })

  test('a container that keeps restarting', () => {
    const restarting = container({ state: 'restarting', status: 'Restarting (1) 4 seconds ago' })
    expect(reasonOf(restarting, undefined, null, undefined)).toEqual({ kind: 'restarting', reason: 'Keeps restarting' })
  })

  test('a recent failure of a stopped container is shown with its reason', () => {
    const stopped = container({ state: 'exited', status: 'Exited (1) 2 hours ago' })
    expect(reasonOf(stopped, undefined, null, OOM)).toEqual({ kind: 'exited', reason: 'Ran out of memory' })
  })

  test('a failure counts only while the container is stopped', () => {
    expect(reasonOf(container({}), undefined, null, OOM)).toBeNull()
  })

  test('memory above 90% of a limit below the host memory needs attention', () => {
    const limit = 1024 ** 3
    expect(reasonOf(container({}), stat('a', limit * 0.93, limit), HOST_MEMORY, undefined)).toEqual({
      kind: 'memory',
      reason: 'Memory 93% of limit',
    })
  })

  test('no limit, or a limit at the host memory, is never flagged', () => {
    expect(reasonOf(container({}), stat('a', HOST_MEMORY, HOST_MEMORY), HOST_MEMORY, undefined)).toBeNull()
    expect(reasonOf(container({}), stat('a', 95, 0), HOST_MEMORY, undefined)).toBeNull()
  })

  test('the memory check is skipped while the host memory is unknown', () => {
    expect(reasonOf(container({}), stat('a', 95, 100), null, undefined)).toBeNull()
  })

  test('a healthy container with normal memory is not flagged', () => {
    const limit = 1024 ** 3
    expect(reasonOf(container({}), stat('a', limit * 0.5, limit), HOST_MEMORY, undefined)).toBeNull()
  })
})

describe('attentionItems', () => {
  test('nothing to look at gives an empty list', () => {
    expect(attentionItems([container({})], [], HOST_MEMORY, [])).toEqual([])
  })

  test('the most urgent first, then by name, one reason per container', () => {
    const items = attentionItems(
      [
        container({ id: '1', name: 'zeta', status: 'Up 1 hour (unhealthy)' }),
        container({ id: '2', name: 'beta', state: 'exited', status: 'Exited (1) 1 hour ago' }),
        container({ id: '3', name: 'alpha', state: 'restarting', status: 'Restarting (2) 3 seconds ago' }),
        container({ id: '4', name: 'gamma', status: 'Up 1 hour (unhealthy)', state: 'running' }),
        container({ id: '5', name: 'delta' }),
      ],
      [stat('5', 99, 100)],
      HOST_MEMORY,
      [{ id: '2', name: 'beta', reason: 'Stopped with code 1, 1h ago' }],
    )
    expect(items.map((item) => [item.name, item.kind, item.reason])).toEqual([
      ['gamma', 'unhealthy', 'Unhealthy'],
      ['zeta', 'unhealthy', 'Unhealthy'],
      ['alpha', 'restarting', 'Keeps restarting'],
      ['beta', 'exited', 'Stopped with code 1, 1h ago'],
      ['delta', 'memory', 'Memory 99% of limit'],
    ])
  })

  test('a container with two problems shows the first one only', () => {
    const items = attentionItems(
      [container({ id: '1', name: 'busy', status: 'Up 1 hour (unhealthy)' })],
      [stat('1', 99, 100)],
      200,
      [],
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.kind).toBe('unhealthy')
  })
})
