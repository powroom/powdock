import { describe, expect, test } from 'bun:test'
import { busiestRows, engineLine, machineCpuPercent, machineCpuSeries, volumeSizeTotal } from './dashboard-view'
import type { ContainerStats, ContainerSummary, TotalsSample } from './types'

function container(id: string, name: string, state: ContainerSummary['state'] = 'running'): ContainerSummary {
  return {
    id,
    shortId: id.slice(0, 12),
    name,
    image: 'img',
    imageId: 'sha256:' + 'b'.repeat(64),
    state,
    status: state === 'running' ? 'Up 1 hour' : 'Exited (0) 1 hour ago',
    createdAt: '2026-11-01T00:00:00.000Z',
    ports: [],
    project: null,
    service: null,
    isSelf: false,
  }
}

function stat(id: string, cpuPercent: number | null): ContainerStats {
  return { id, cpuPercent, memUsage: 1, memLimit: 2, spark: [] }
}

describe('machineCpuPercent', () => {
  test('divides the per-core sum by the CPU count, so 100 is the whole machine', () => {
    expect(machineCpuPercent(400, 8)).toBe(50)
    expect(machineCpuPercent(800, 8)).toBe(100)
    expect(machineCpuPercent(12.5, 4)).toBe(3.125)
  })

  test('no value or no CPUs gives null', () => {
    expect(machineCpuPercent(null, 8)).toBeNull()
    expect(machineCpuPercent(100, 0)).toBeNull()
  })

  test('the series keeps the gaps', () => {
    const totals: TotalsSample[] = [
      { t: 1, containers: 1, cpu: 200, mem: 0, netRx: null, netTx: null, blkRead: null, blkWrite: null },
      { t: 2, containers: 0, cpu: null, mem: 0, netRx: null, netTx: null, blkRead: null, blkWrite: null },
    ]
    expect(machineCpuSeries(totals, 4)).toEqual([50, null])
  })
})

describe('busiestRows', () => {
  test('running containers only, highest CPU first, then by name', () => {
    const containers = [
      container('a', 'api'),
      container('b', 'db'),
      container('c', 'cache'),
      container('d', 'stopped-one', 'exited'),
      container('e', 'worker'),
    ]
    const stats = [stat('a', 10), stat('b', 45), stat('c', 10), stat('d', 99), stat('e', null)]
    expect(busiestRows(containers, stats).map((row) => row.container.name)).toEqual(['db', 'api', 'cache', 'worker'])
  })

  test('at most five rows, and a row without stats yet has stat null', () => {
    const containers = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => container(id, `c-${id}`))
    const rows = busiestRows(containers, [stat('a', 1)])
    expect(rows).toHaveLength(5)
    expect(rows[0]?.stat?.cpuPercent).toBe(1)
    expect(rows[1]?.stat).toBeNull()
  })
})

describe('engineLine', () => {
  test('the Docker version, the system, the CPUs and the memory', () => {
    expect(engineLine({ version: '29.8.0', os: 'Ubuntu 24.04.3 LTS', cpus: 12, memTotal: 8_400_000_000 })).toBe(
      'Docker 29.8.0 · Ubuntu 24.04.3 LTS · 12 CPUs · 7.8 GB',
    )
  })

  test('one CPU is singular, and a missing system name is left out', () => {
    expect(engineLine({ version: '29.8.0', os: '', cpus: 1, memTotal: 1024 ** 3 })).toBe(
      'Docker 29.8.0 · 1 CPU · 1.0 GB',
    )
  })
})

describe('volumeSizeTotal', () => {
  test('sums the known sizes', () => {
    expect(volumeSizeTotal({ a: 100, b: null, c: 50 })).toBe(150)
    expect(volumeSizeTotal({})).toBe(0)
  })
})
