import { describe, expect, test } from 'bun:test'
import { countImages, imageName, matchesImageFilter, matchesImageSearch, sortImages, totalSize } from './image-view'
import type { ImageSummary } from './types'

function image(overrides: Partial<ImageSummary>): ImageSummary {
  return {
    id: `sha256:${'0'.repeat(64)}`,
    shortId: '000000000000',
    tags: [],
    repository: '<none>',
    tag: '<none>',
    size: 1000,
    createdAt: '2026-01-01T00:00:00.000Z',
    containers: 0,
    dangling: true,
    ...overrides,
  }
}

const NGINX = image({
  id: `sha256:${'a'.repeat(64)}`,
  shortId: 'aaaaaaaaaaaa',
  tags: ['nginx:1.27', 'nginx:stable'],
  repository: 'nginx',
  tag: '1.27',
  size: 2000,
  containers: 2,
  dangling: false,
})
const ALPINE = image({
  id: `sha256:${'b'.repeat(64)}`,
  shortId: 'bbbbbbbbbbbb',
  tags: ['alpine:3.20'],
  repository: 'alpine',
  tag: '3.20',
  size: 500,
  containers: 0,
  dangling: false,
})
const DANGLING_B = image({ id: `sha256:${'d'.repeat(64)}`, shortId: 'dddddddddddd', size: 300 })
const DANGLING_A = image({ id: `sha256:${'c'.repeat(64)}`, shortId: 'cccccccccccc', size: 100 })
const REDIS = image({
  id: `sha256:${'e'.repeat(64)}`,
  shortId: 'eeeeeeeeeeee',
  tags: ['redis:7'],
  repository: 'redis',
  tag: '7',
  size: 700,
  containers: 1,
  dangling: false,
})

describe('matchesImageFilter', () => {
  test('in use and unused split on the container count', () => {
    expect(matchesImageFilter(NGINX, 'in-use')).toBe(true)
    expect(matchesImageFilter(ALPINE, 'in-use')).toBe(false)
    expect(matchesImageFilter(ALPINE, 'unused')).toBe(true)
    expect(matchesImageFilter(NGINX, 'unused')).toBe(false)
  })

  test('dangling is the images without a tag, used or not', () => {
    expect(matchesImageFilter(DANGLING_A, 'dangling')).toBe(true)
    expect(matchesImageFilter(NGINX, 'dangling')).toBe(false)
    expect(matchesImageFilter(NGINX, 'all')).toBe(true)
  })
})

describe('matchesImageSearch', () => {
  test('matches the repository, a tag, and the id', () => {
    expect(matchesImageSearch(NGINX, 'NGI')).toBe(true)
    expect(matchesImageSearch(NGINX, 'stable')).toBe(true)
    expect(matchesImageSearch(NGINX, 'aaaaaa')).toBe(true)
    expect(matchesImageSearch(NGINX, `sha256:${'a'.repeat(4)}`)).toBe(true)
    expect(matchesImageSearch(ALPINE, 'nginx')).toBe(false)
  })

  test('an empty query matches everything', () => {
    expect(matchesImageSearch(ALPINE, '   ')).toBe(true)
  })
})

describe('countImages', () => {
  test('counts for each tab', () => {
    expect(countImages([NGINX, ALPINE, DANGLING_A, REDIS])).toEqual({
      all: 4,
      'in-use': 2,
      unused: 2,
      dangling: 1,
      updates: 0,
    })
  })

  test('counts the images whose tag has an update', () => {
    const ids = new Set([NGINX.id])
    expect(countImages([NGINX, ALPINE], ids).updates).toBe(1)
    expect(matchesImageFilter(NGINX, 'updates', ids)).toBe(true)
    expect(matchesImageFilter(ALPINE, 'updates', ids)).toBe(false)
  })
})

describe('sortImages', () => {
  test('repository then tag, dangling images last', () => {
    const sorted = sortImages([DANGLING_B, REDIS, NGINX, DANGLING_A, ALPINE]).map((item) => item.shortId)
    expect(sorted).toEqual(['bbbbbbbbbbbb', 'aaaaaaaaaaaa', 'eeeeeeeeeeee', 'cccccccccccc', 'dddddddddddd'])
  })

  test('does not change the input order', () => {
    const input = [REDIS, ALPINE]
    sortImages(input)
    expect(input).toEqual([REDIS, ALPINE])
  })
})

describe('totalSize and imageName', () => {
  test('the total is the sum of the sizes', () => {
    expect(totalSize([NGINX, ALPINE, DANGLING_A])).toBe(2600)
    expect(totalSize([])).toBe(0)
  })

  test('the name is repository:tag, and null for a dangling image', () => {
    expect(imageName(NGINX)).toBe('nginx:1.27')
    expect(imageName(DANGLING_A)).toBeNull()
  })
})
