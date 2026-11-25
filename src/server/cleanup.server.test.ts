import { describe, expect, test } from 'bun:test'
import { cleanupValidators } from '@/api/validators'
import {
  buildFilters,
  buildPruneQuery,
  containerPruneQuery,
  countImagesDeleted,
  countUnusedNetworks,
  imagePruneQuery,
  networkPruneQuery,
  pruneResultOf,
  summarizeBuildCache,
  summarizeContainers,
  summarizeDiskUsage,
  summarizeImages,
  summarizeVolumes,
  volumePruneQuery,
  type RawDfContainer,
  type RawDfImage,
  type RawDfVolume,
} from './cleanup.server'

// Fixtures shaped like the Docker Engine 29 API (GET /system/df, POST *prune). Nothing here touches the
// socket: the tests call only the pure functions.

const NOW = Date.parse('2026-11-24T12:00:00Z')
const DAY = 24 * 60 * 60 * 1000
const ANON = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'

const IMAGES: RawDfImage[] = [
  { Id: 'sha256:1', RepoTags: ['nginx:1.27'], Size: 200, Containers: 2 },
  { Id: 'sha256:2', RepoTags: ['postgres:16', '<none>:<none>'], Size: 400, Containers: 0 },
  { Id: 'sha256:3', RepoTags: null, Size: 50, Containers: 0 },
  { Id: 'sha256:4', RepoTags: ['<none>:<none>'], Size: 25, Containers: -1 },
]

describe('summarizeImages', () => {
  test('total is the layer size, unused and dangling come from their own lists', () => {
    expect(summarizeImages(IMAGES, 900)).toEqual({
      total: 900,
      count: 4,
      unused: 450,
      unusedCount: 2,
      dangling: 75,
      danglingCount: 2,
    })
  })

  test('without a layer size the total is the sum of the image sizes', () => {
    expect(summarizeImages(IMAGES, undefined).total).toBe(675)
  })
})

const CONTAINERS: RawDfContainer[] = [
  { Id: 'c1', State: 'running', SizeRw: 10 },
  { Id: 'c2', State: 'exited', SizeRw: 30 },
  { Id: 'c3', State: 'created', SizeRw: null },
  { Id: 'c4', State: 'paused', SizeRw: 5 },
  { Id: 'c5', State: 'dead', SizeRw: 7 },
]

describe('summarizeContainers', () => {
  test('stopped means not running, paused or restarting', () => {
    expect(summarizeContainers(CONTAINERS)).toEqual({
      count: 5,
      stoppedCount: 3,
      size: 52,
      stoppedSize: 37,
    })
  })
})

const VOLUMES: RawDfVolume[] = [
  { Name: 'pgdata', UsageData: { Size: 1000, RefCount: 1 } },
  { Name: 'cache', Labels: {}, UsageData: { Size: 200, RefCount: 0 } },
  { Name: ANON, Labels: null, UsageData: { Size: 50, RefCount: 0 } },
  { Name: 'old', UsageData: { Size: -1, RefCount: 0 } },
  { Name: 'unknown-usage' },
]

describe('summarizeVolumes', () => {
  test('unused counts RefCount 0, anonymous unused uses the anonymous rule, unknown sizes add 0', () => {
    expect(summarizeVolumes(VOLUMES)).toEqual({
      total: 1250,
      count: 5,
      unused: 250,
      unusedCount: 3,
      anonymousUnused: 50,
      anonymousUnusedCount: 1,
    })
  })
})

describe('summarizeBuildCache', () => {
  const entries = [
    { ID: 'a', InUse: true, Size: 100, CreatedAt: new Date(NOW - 30 * DAY).toISOString() },
    {
      ID: 'b',
      InUse: false,
      Size: 200,
      CreatedAt: new Date(NOW - 10 * DAY).toISOString(),
      LastUsedAt: new Date(NOW - 2 * DAY).toISOString(),
    },
    { ID: 'c', InUse: false, Size: 300, CreatedAt: new Date(NOW - 20 * DAY).toISOString(), LastUsedAt: null },
    { ID: 'd', InUse: false, Size: 40, CreatedAt: new Date(NOW - 1 * DAY).toISOString() },
    { ID: 'e', InUse: false, Size: 5 },
  ]

  test('reclaimable is the cache not in use, older than a week uses LastUsedAt or CreatedAt', () => {
    expect(summarizeBuildCache(entries, NOW)).toEqual({
      total: 645,
      count: 5,
      reclaimable: 545,
      reclaimableCount: 4,
      olderThanWeek: 300,
      olderThanWeekCount: 1,
    })
  })

  test('an entry with no date never counts as old', () => {
    expect(summarizeBuildCache([{ ID: 'x', InUse: false, Size: 9 }], NOW).olderThanWeek).toBe(0)
  })
})

describe('countUnusedNetworks', () => {
  test('built-in networks never count, and only networks with no container count', () => {
    expect(
      countUnusedNetworks([
        { builtIn: true, containers: [] },
        { builtIn: false, containers: [] },
        { builtIn: false, containers: [{ id: 'c1', name: 'web', ipv4: '172.18.0.2' }] },
        { builtIn: false, containers: [] },
      ]),
    ).toBe(2)
  })
})

describe('summarizeDiskUsage', () => {
  test('combines the parts, treating missing lists as empty', () => {
    const usage = summarizeDiskUsage({ LayersSize: 900, Images: IMAGES }, 3, NOW)
    expect(usage.images.total).toBe(900)
    expect(usage.containers).toEqual({ count: 0, stoppedCount: 0, size: 0, stoppedSize: 0 })
    expect(usage.volumes.count).toBe(0)
    expect(usage.buildCache.count).toBe(0)
    expect(usage.unusedNetworks).toBe(3)
  })
})

describe('buildFilters', () => {
  test('encodes the non-empty lists as JSON, in the given order', () => {
    expect(buildFilters({ label: ['a=b'], dangling: ['true'] })).toBe('{"label":["a=b"],"dangling":["true"]}')
  })

  test('leaves out empty and missing lists, and gives undefined when nothing is left', () => {
    expect(buildFilters({ label: [], dangling: undefined })).toBeUndefined()
    expect(buildFilters({ label: [], dangling: ['true'] })).toBe('{"dangling":["true"]}')
  })
})

describe('prune queries', () => {
  test('containers: a label filter only when labels are given, blank labels are dropped', () => {
    expect(containerPruneQuery()).toEqual({ filters: undefined })
    expect(containerPruneQuery(['  ', ' team=test '])).toEqual({ filters: '{"label":["team=test"]}' })
  })

  test('images: dangling=true for dangling only, dangling=false for every unused image', () => {
    expect(imagePruneQuery({ all: false })).toEqual({ filters: '{"dangling":["true"]}' })
    expect(imagePruneQuery({ all: true })).toEqual({ filters: '{"dangling":["false"]}' })
    expect(imagePruneQuery({ all: true, labels: ['team=test'] })).toEqual({
      filters: '{"label":["team=test"],"dangling":["false"]}',
    })
  })

  test('volumes: the all filter is sent only for named volumes', () => {
    expect(volumePruneQuery({ named: false })).toEqual({ filters: undefined })
    expect(volumePruneQuery({ named: true, labels: ['team=test'] })).toEqual({
      filters: '{"label":["team=test"],"all":["true"]}',
    })
  })

  test('networks: label filter only', () => {
    expect(networkPruneQuery(['team=test'])).toEqual({ filters: '{"label":["team=test"]}' })
  })

  test('build cache: all=true, and until=168h only for older than a week', () => {
    expect(buildPruneQuery({ olderThanWeek: true })).toEqual({ all: true, filters: '{"until":["168h"]}' })
    expect(buildPruneQuery({ olderThanWeek: false })).toEqual({ all: true, filters: undefined })
  })
})

describe('prune results', () => {
  test('a missing size counts as 0', () => {
    expect(pruneResultOf(2, undefined)).toEqual({ removed: 2, spaceReclaimed: 0 })
    expect(pruneResultOf(1, 4096)).toEqual({ removed: 1, spaceReclaimed: 4096 })
  })

  test('image prune counts deleted images, not untagged names', () => {
    expect(
      countImagesDeleted([
        { Untagged: 'nginx:old' },
        { Untagged: 'app@sha256:1', Deleted: 'sha256:1' },
        { Deleted: 'sha256:2' },
      ]),
    ).toBe(2)
    expect(countImagesDeleted(null)).toBe(0)
  })
})

describe('cleanupValidators', () => {
  test('inputs reject extra fields, so a client cannot send labels', () => {
    const validators = cleanupValidators()
    expect(validators.imagesInput.safeParse({ all: true }).success).toBe(true)
    expect(validators.imagesInput.safeParse({ all: true, labels: ['team=test'] }).success).toBe(false)
    expect(validators.emptyInput.safeParse({ labels: ['team=test'] }).success).toBe(false)
    expect(validators.volumesInput.safeParse({}).success).toBe(false)
    expect(validators.buildInput.safeParse({ olderThanWeek: false }).success).toBe(true)
  })
})
