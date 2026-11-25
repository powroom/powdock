import { describe, expect, test } from 'bun:test'
import {
  isStoppedState,
  nothingToClean,
  pruneToast,
  shareOf,
  totalReclaimable,
  totalUse,
  usageSegments,
} from './cleanup-view'
import type { DiskUsage } from './types'

const USAGE: DiskUsage = {
  images: { total: 1000, count: 9, unused: 300, unusedCount: 4, dangling: 50, danglingCount: 2 },
  containers: { count: 6, stoppedCount: 2, size: 200, stoppedSize: 80 },
  volumes: { total: 500, count: 5, unused: 120, unusedCount: 2, anonymousUnused: 20, anonymousUnusedCount: 1 },
  buildCache: {
    total: 400,
    count: 7,
    reclaimable: 250,
    reclaimableCount: 5,
    olderThanWeek: 100,
    olderThanWeekCount: 2,
  },
  unusedNetworks: 1,
}

describe('isStoppedState', () => {
  test('running, paused and restarting are not stopped, every other state is', () => {
    expect(['running', 'paused', 'restarting'].map(isStoppedState)).toEqual([false, false, false])
    expect(['exited', 'created', 'dead', 'removing'].map(isStoppedState)).toEqual([true, true, true, true])
  })
})

describe('usage totals', () => {
  test('the bar has the four parts in order, and the total is their sum', () => {
    expect(usageSegments(USAGE).map((segment) => segment.key)).toEqual([
      'images',
      'containers',
      'volumes',
      'buildCache',
    ])
    expect(totalUse(USAGE)).toBe(2100)
  })

  test('reclaimable adds unused images, stopped containers, unused volumes and reclaimable build cache', () => {
    expect(totalReclaimable(USAGE)).toBe(300 + 80 + 120 + 250)
  })
})

describe('shareOf', () => {
  test('a part as a percentage, 0 for an empty total', () => {
    expect(shareOf(250, 1000)).toBe(25)
    expect(shareOf(10, 0)).toBe(0)
  })
})

describe('pruneToast', () => {
  test('nothing removed says so', () => {
    expect(pruneToast({ removed: 0, spaceReclaimed: 0 }, 'image')).toEqual({ type: 'info', title: 'Nothing to remove' })
  })

  test('space freed is the title, the count the description', () => {
    expect(pruneToast({ removed: 3, spaceReclaimed: 3_435_973_837 }, 'image')).toEqual({
      type: 'success',
      title: 'Freed 3.2 GB',
      description: '3 images removed',
    })
  })

  test('without a size (networks) the count is the title', () => {
    expect(pruneToast({ removed: 1, spaceReclaimed: 0 }, 'network')).toEqual({
      type: 'success',
      title: 'Removed 1 network',
    })
  })
})

describe('nothingToClean', () => {
  const EMPTY: DiskUsage = {
    images: { total: 1000, count: 9, unused: 0, unusedCount: 0, dangling: 0, danglingCount: 0 },
    containers: { count: 6, stoppedCount: 0, size: 200, stoppedSize: 0 },
    volumes: { total: 500, count: 5, unused: 0, unusedCount: 0, anonymousUnused: 0, anonymousUnusedCount: 0 },
    buildCache: { total: 400, count: 7, reclaimable: 0, reclaimableCount: 0, olderThanWeek: 0, olderThanWeekCount: 0 },
    unusedNetworks: 0,
  }

  test('is true when every count is zero', () => {
    expect(nothingToClean(EMPTY)).toBe(true)
  })

  test('is false when any one count is above zero', () => {
    expect(nothingToClean(USAGE)).toBe(false)
    expect(nothingToClean({ ...EMPTY, unusedNetworks: 1 })).toBe(false)
    expect(nothingToClean({ ...EMPTY, containers: { ...EMPTY.containers, stoppedCount: 1 } })).toBe(false)
  })
})
