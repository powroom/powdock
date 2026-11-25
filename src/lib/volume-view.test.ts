import { describe, expect, test } from 'bun:test'
import {
  countVolumes,
  matchesVolumeFilter,
  matchesVolumeSearch,
  shortVolumeName,
  sortVolumes,
  totalVolumeSize,
  volumeRemoveBlock,
} from './volume-view'
import type { VolumeSummary } from './types'

const ANON = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'

function volume(overrides: Partial<VolumeSummary>): VolumeSummary {
  return {
    name: 'data',
    driver: 'local',
    mountpoint: '/x',
    createdAt: '2026-01-01T00:00:00.000Z',
    project: null,
    anonymous: false,
    usedBy: [],
    size: null,
    ...overrides,
  }
}

const PGDATA = volume({
  name: 'pgdata',
  project: 'shop',
  usedBy: [{ id: '1', name: 'postgres-1', running: true }],
})
const CACHE = volume({ name: 'cache' })
const LOGS = volume({ name: 'logs', usedBy: [{ id: '2', name: 'api-1', running: false }] })
const ANONYMOUS = volume({ name: ANON, anonymous: true })
const ANON_IN_USE = volume({
  name: 'b'.repeat(64),
  anonymous: true,
  usedBy: [{ id: '3', name: 'x', running: true }],
})

describe('matchesVolumeFilter', () => {
  test('in use and unused split on the users', () => {
    expect(matchesVolumeFilter(PGDATA, 'in-use')).toBe(true)
    expect(matchesVolumeFilter(CACHE, 'in-use')).toBe(false)
    expect(matchesVolumeFilter(CACHE, 'unused')).toBe(true)
    expect(matchesVolumeFilter(PGDATA, 'unused')).toBe(false)
  })

  test('anonymous is the anonymous ones, used or not', () => {
    expect(matchesVolumeFilter(ANONYMOUS, 'anonymous')).toBe(true)
    expect(matchesVolumeFilter(ANON_IN_USE, 'anonymous')).toBe(true)
    expect(matchesVolumeFilter(PGDATA, 'anonymous')).toBe(false)
    expect(matchesVolumeFilter(PGDATA, 'all')).toBe(true)
  })
})

describe('matchesVolumeSearch', () => {
  test('matches the name and the project, without case', () => {
    expect(matchesVolumeSearch(PGDATA, 'PGD')).toBe(true)
    expect(matchesVolumeSearch(PGDATA, 'shop')).toBe(true)
    expect(matchesVolumeSearch(CACHE, 'shop')).toBe(false)
  })

  test('an empty query matches everything', () => {
    expect(matchesVolumeSearch(CACHE, '  ')).toBe(true)
  })
})

describe('countVolumes', () => {
  test('counts for each tab', () => {
    expect(countVolumes([PGDATA, CACHE, LOGS, ANONYMOUS, ANON_IN_USE])).toEqual({
      all: 5,
      'in-use': 3,
      unused: 2,
      anonymous: 2,
    })
  })
})

describe('sortVolumes', () => {
  test('in use first, then by name, anonymous volumes last', () => {
    const sorted = sortVolumes([ANONYMOUS, CACHE, LOGS, ANON_IN_USE, PGDATA]).map((item) => item.name)
    expect(sorted).toEqual(['logs', 'pgdata', 'cache', ANON, ANON_IN_USE.name])
  })

  test('does not change the input order', () => {
    const input = [CACHE, PGDATA]
    sortVolumes(input)
    expect(input).toEqual([CACHE, PGDATA])
  })
})

describe('totalVolumeSize', () => {
  test('sums the known sizes and skips the unknown ones', () => {
    const sizes = { pgdata: 1000, cache: null, logs: 500 }
    expect(totalVolumeSize([PGDATA, CACHE, LOGS], sizes)).toBe(1500)
    expect(totalVolumeSize([], sizes)).toBe(0)
  })
})

describe('shortVolumeName and volumeRemoveBlock', () => {
  test('an anonymous volume shows the first 12 characters of its ID', () => {
    expect(shortVolumeName(ANONYMOUS)).toBe('a1b2c3d4e5f6…')
    expect(shortVolumeName(PGDATA)).toBe('pgdata')
  })

  test('a volume in use names its first container, and counts the others', () => {
    expect(volumeRemoveBlock(PGDATA)).toBe('In use by postgres-1')
    expect(
      volumeRemoveBlock(
        volume({
          usedBy: [
            { id: '1', name: 'a', running: true },
            { id: '2', name: 'b', running: false },
          ],
        }),
      ),
    ).toBe('In use by a and 1 more')
    expect(volumeRemoveBlock(CACHE)).toBeNull()
  })
})
