import { describe, expect, test } from 'bun:test'
import type { ContainerSummary } from '@/lib/types'
import {
  bulkTargets,
  countByFilter,
  groupByProject,
  isActiveState,
  matchesFilter,
  matchesSearch,
  OTHER_GROUP,
  OTHER_GROUP_TITLE,
  paletteMatches,
} from './container-view'

function container(overrides: Partial<ContainerSummary> & { name: string }): ContainerSummary {
  return {
    id: `${overrides.name}-id-0000000000000000000000000000000000000000000000000000`.slice(0, 64),
    shortId: overrides.name.slice(0, 12),
    image: 'nginx:1.27',
    imageId: 'sha256:' + 'b'.repeat(64),
    state: 'running',
    status: 'Up 1 hour',
    createdAt: '2026-11-01T00:00:00.000Z',
    ports: [],
    project: null,
    service: null,
    isSelf: false,
    ...overrides,
  }
}

const WEB = container({ name: 'shop-web-1', image: 'nginx:1.27', project: 'shop', service: 'web' })
const DB = container({
  name: 'shop-db-1',
  image: 'postgres:17',
  project: 'shop',
  service: 'db',
  state: 'exited',
  status: 'Exited (0) 2 days ago',
})
const CACHE = container({ name: 'shop-cache-1', image: 'redis:7', project: 'shop', service: 'cache', state: 'paused' })
const PORTAL = container({ name: 'acme-portal', image: 'acme/portal:2', project: 'acme' })
const LOOSE = container({ name: 'redis-scratch', image: 'redis:7-alpine', state: 'exited' })
const SELF = container({ name: 'powdock', image: 'powdock:0.0.1', isSelf: true })

describe('filters and search', () => {
  test('running means the running state only', () => {
    expect(matchesFilter(WEB, 'running')).toBe(true)
    expect(matchesFilter(CACHE, 'running')).toBe(false)
    expect(matchesFilter(DB, 'stopped')).toBe(true)
    expect(matchesFilter(CACHE, 'stopped')).toBe(true)
    expect(matchesFilter(WEB, 'all')).toBe(true)
  })

  test('counts split running and stopped', () => {
    expect(countByFilter([WEB, DB, CACHE, LOOSE])).toEqual({ all: 4, running: 1, stopped: 3 })
    expect(countByFilter([])).toEqual({ all: 0, running: 0, stopped: 0 })
  })

  test('search matches name, image, project and service, ignoring case', () => {
    expect(matchesSearch(PORTAL, 'ACME')).toBe(true)
    expect(matchesSearch(DB, 'postgres')).toBe(true)
    expect(matchesSearch(WEB, 'web')).toBe(true)
    expect(matchesSearch(WEB, '  shop-web ')).toBe(true)
    expect(matchesSearch(WEB, 'mysql')).toBe(false)
  })

  test('an empty search matches everything', () => {
    expect(matchesSearch(WEB, '')).toBe(true)
    expect(matchesSearch(WEB, '   ')).toBe(true)
  })

  test('active states are running, paused and restarting', () => {
    expect(isActiveState('running')).toBe(true)
    expect(isActiveState('paused')).toBe(true)
    expect(isActiveState('restarting')).toBe(true)
    expect(isActiveState('exited')).toBe(false)
    expect(isActiveState('created')).toBe(false)
  })
})

describe('grouping', () => {
  test('projects sorted by name, containers without a project last', () => {
    const groups = groupByProject([LOOSE, WEB, PORTAL, DB])
    expect(groups.map((g) => g.key)).toEqual(['acme', 'shop', OTHER_GROUP])
    expect(groups[2]?.title).toBe(OTHER_GROUP_TITLE)
    expect(groups[2]?.isProject).toBe(false)
    expect(groups[0]?.isProject).toBe(true)
  })

  test('projects with something running come before projects that are all stopped', () => {
    const idle = container({ name: 'alpha-db', project: 'alpha', state: 'exited', status: 'Exited (0)' })
    const groups = groupByProject([idle, WEB, PORTAL])
    expect(groups.map((g) => g.key)).toEqual(['acme', 'shop', 'alpha'])
  })

  test('containers inside a group are sorted by name, so rows keep their place', () => {
    const group = groupByProject([CACHE, WEB, DB]).find((g) => g.key === 'shop')
    expect(group?.containers.map((c) => c.name)).toEqual(['shop-cache-1', 'shop-db-1', 'shop-web-1'])
  })

  test('the running count is per group', () => {
    const shop = groupByProject([WEB, DB, CACHE]).find((g) => g.key === 'shop')
    expect(shop?.running).toBe(1)
    expect(shop?.containers.length).toBe(3)
  })

  test('no containers gives no groups', () => {
    expect(groupByProject([])).toEqual([])
  })
})

describe('bulk targets', () => {
  const shop = [WEB, DB, CACHE]

  test('start: every container that is not running', () => {
    expect(bulkTargets(shop, 'start').map((c) => c.name)).toEqual(['shop-db-1', 'shop-cache-1'])
  })

  test('stop: every container with a live process', () => {
    expect(bulkTargets(shop, 'stop').map((c) => c.name)).toEqual(['shop-web-1', 'shop-cache-1'])
  })

  test('restart: only running containers', () => {
    expect(bulkTargets(shop, 'restart').map((c) => c.name)).toEqual(['shop-web-1'])
  })

  test('pow/dock itself is left out of stop and restart, but not start', () => {
    const project = [SELF, WEB]
    expect(bulkTargets(project, 'stop').map((c) => c.name)).toEqual(['shop-web-1'])
    expect(bulkTargets(project, 'restart').map((c) => c.name)).toEqual(['shop-web-1'])
    expect(bulkTargets([{ ...SELF, state: 'exited' }], 'start')).toHaveLength(1)
  })

  test('nothing to do gives an empty list', () => {
    expect(bulkTargets([WEB], 'start')).toEqual([])
  })
})

describe('paletteMatches', () => {
  const list = (names: string[]): ContainerSummary[] =>
    names.map((name, index) => ({
      id: String(index),
      shortId: String(index).padStart(12, '0'),
      name,
      image: 'img',
      imageId: 'sha256:' + 'c'.repeat(64),
      state: 'running',
      status: 'Up 1 hour',
      createdAt: '2026-11-01T00:00:00.000Z',
      ports: [],
      project: null,
      service: null,
      isSelf: false,
    }))

  test('an empty query matches nothing', () => {
    expect(paletteMatches(list(['web']), '   ')).toEqual([])
  })

  test('names that start with the query come first, running and stopped alike', () => {
    const found = paletteMatches(list(['old-web', 'web-2', 'api', 'web']), 'WEB')
    expect(found.map((container) => container.name)).toEqual(['web', 'web-2', 'old-web'])
  })

  test('at most eight matches', () => {
    const many = list(Array.from({ length: 12 }, (_, index) => `svc-${index}`))
    expect(paletteMatches(many, 'svc')).toHaveLength(8)
  })
})
