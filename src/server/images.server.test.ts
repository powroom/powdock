import { describe, expect, test } from 'bun:test'
import { imageValidators, IMAGE_ID } from '@/api/validators'
import type { IconKey } from '@/lib/image-icon'
import {
  countContainersByImage,
  resolveImageStacks,
  splitTag,
  tagsOf,
  toImageDetails,
  toImageRemoval,
  toImageSummary,
  type RawHistory,
  type RawImage,
  type RawImageInspect,
} from './images.server'

// Fixtures shaped like the Docker Engine 29 API (GET /images/json, GET /images/{id}/json and /history).
// Nothing here touches the socket: the tests call only the pure functions.

const NGINX_ID = 'sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499'
const DANGLING_ID = 'sha256:0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0'

const NGINX: RawImage = {
  Id: NGINX_ID,
  RepoTags: ['nginx:1.27', 'nginx:stable', '<none>:<none>'],
  Created: 1795400000,
  Size: 192_000_000,
}
const DANGLING: RawImage = { Id: DANGLING_ID, RepoTags: null, Created: 1795300000, Size: 4096 }

describe('splitTag', () => {
  test('a plain repository and tag', () => {
    expect(splitTag('nginx:1.27')).toEqual({ repository: 'nginx', tag: '1.27' })
  })

  test('a registry port is not taken for the tag', () => {
    expect(splitTag('localhost:5000/team/app')).toEqual({ repository: 'localhost:5000/team/app', tag: 'latest' })
    expect(splitTag('localhost:5000/team/app:2.0')).toEqual({ repository: 'localhost:5000/team/app', tag: '2.0' })
  })
})

describe('tagsOf', () => {
  test('leaves out the placeholder and empty names', () => {
    expect(tagsOf(['nginx:1.27', '<none>:<none>', ''])).toEqual(['nginx:1.27'])
    expect(tagsOf(null)).toEqual([])
  })
})

describe('toImageSummary', () => {
  test('one row per image: the first tag, the rest kept in tags', () => {
    const counts = new Map([[NGINX_ID, 2]])
    expect(toImageSummary(NGINX, counts)).toEqual({
      id: NGINX_ID,
      shortId: '858f009f9709',
      tags: ['nginx:1.27', 'nginx:stable'],
      repository: 'nginx',
      tag: '1.27',
      size: 192_000_000,
      createdAt: new Date(1795400000 * 1000).toISOString(),
      containers: 2,
      dangling: false,
    })
  })

  test('an image with no tag is dangling, with the placeholder names', () => {
    expect(toImageSummary(DANGLING, new Map())).toMatchObject({
      tags: [],
      repository: '<none>',
      tag: '<none>',
      containers: 0,
      dangling: true,
      shortId: '0f1e2d3c4b5a',
    })
  })
})

describe('countContainersByImage', () => {
  test('counts containers of every state per image id', () => {
    const counts = countContainersByImage([{ ImageID: NGINX_ID }, { ImageID: NGINX_ID }, { ImageID: DANGLING_ID }, {}])
    expect(counts.get(NGINX_ID)).toBe(2)
    expect(counts.get(DANGLING_ID)).toBe(1)
    expect(counts.size).toBe(2)
  })
})

describe('toImageDetails', () => {
  const INSPECT: RawImageInspect = {
    Id: NGINX_ID,
    RepoTags: ['nginx:1.27'],
    Created: '2026-11-20T10:15:30.123456789Z',
    Size: 192_000_000,
    Os: 'linux',
    Architecture: 'amd64',
    Author: '',
    RootFS: { Layers: ['sha256:a', 'sha256:b', 'sha256:c'] },
    Config: {
      Entrypoint: ['/docker-entrypoint.sh'],
      Cmd: ['nginx', '-g', 'daemon off;'],
      WorkingDir: '',
      User: '',
      ExposedPorts: { '80/tcp': {}, '443/tcp': {} },
      Env: ['PATH=/usr/bin', 'NGINX_VERSION=1.27.0', 'EMPTY'],
      Labels: { 'org.opencontainers.image.version': '1.27', maintainer: 'someone' },
    },
  }
  const HISTORY: RawHistory[] = [
    { Created: 1795400000, CreatedBy: '/bin/sh -c #(nop)  CMD ["nginx" "-g" "daemon off;"]', Size: 0 },
    { Created: 0, CreatedBy: '/bin/sh -c apt-get update', Size: 52_000_000 },
  ]

  test('maps the inspect data and the history', () => {
    const details = toImageDetails(INSPECT, HISTORY)
    expect(details).toMatchObject({
      id: NGINX_ID,
      shortId: '858f009f9709',
      tags: ['nginx:1.27'],
      size: 192_000_000,
      os: 'linux',
      architecture: 'amd64',
      entrypoint: ['/docker-entrypoint.sh'],
      cmd: ['nginx', '-g', 'daemon off;'],
      exposedPorts: ['443/tcp', '80/tcp'],
      layers: 3,
    })
    expect(details.createdAt).toBe('2026-11-20T10:15:30.123Z')
    expect(details.env).toEqual([
      { key: 'PATH', value: '/usr/bin' },
      { key: 'NGINX_VERSION', value: '1.27.0' },
      { key: 'EMPTY', value: '' },
    ])
    expect(details.labels).toEqual([
      { key: 'maintainer', value: 'someone' },
      { key: 'org.opencontainers.image.version', value: '1.27' },
    ])
    expect(details.history).toEqual([
      {
        createdBy: '/bin/sh -c #(nop)  CMD ["nginx" "-g" "daemon off;"]',
        size: 0,
        createdAt: new Date(1795400000 * 1000).toISOString(),
      },
      { createdBy: '/bin/sh -c apt-get update', size: 52_000_000, createdAt: null },
    ])
  })

  test('missing fields come out as empty values, not as errors', () => {
    const details = toImageDetails({ Id: DANGLING_ID }, null)
    expect(details).toMatchObject({
      tags: [],
      createdAt: null,
      entrypoint: [],
      cmd: [],
      exposedPorts: [],
      env: [],
      labels: [],
      layers: 0,
      history: [],
    })
  })
})

describe('toImageRemoval', () => {
  test('separates the untagged names from the deleted layers', () => {
    expect(
      toImageRemoval([
        { Untagged: 'nginx:1.27' },
        { Untagged: 'nginx@sha256:abc' },
        { Deleted: `sha256:${'f'.repeat(64)}` },
        {},
      ]),
    ).toEqual({
      untagged: ['nginx:1.27', 'nginx@sha256:abc'],
      deleted: [`sha256:${'f'.repeat(64)}`],
    })
    expect(toImageRemoval(null)).toEqual({ untagged: [], deleted: [] })
  })
})

describe('image id validation', () => {
  test('accepts the full form and 12 to 64 hex characters', () => {
    expect(IMAGE_ID.test(NGINX_ID)).toBe(true)
    expect(IMAGE_ID.test('858f009f9709')).toBe(true)
    expect(IMAGE_ID.test('858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499')).toBe(true)
  })

  test('refuses short hex, upper case, and a wrong prefix or length', () => {
    expect(IMAGE_ID.test('858f009f970')).toBe(false)
    expect(IMAGE_ID.test('858F009F9709')).toBe(false)
    expect(IMAGE_ID.test(`sha256:${'a'.repeat(63)}`)).toBe(false)
    expect(IMAGE_ID.test(`sha512:${'a'.repeat(64)}`)).toBe(false)
    expect(IMAGE_ID.test(`${'a'.repeat(65)}`)).toBe(false)
  })

  test('remove takes a tag or an ID, and refuses anything else', () => {
    const schema = imageValidators().removeInput
    expect(schema.safeParse({ ref: '858f009f9709', force: true })).toMatchObject({
      success: true,
      data: { ref: '858f009f9709', force: true },
    })
    expect(schema.safeParse({ ref: 'registry:5000/team/app:v2', force: false }).success).toBe(true)
    expect(schema.safeParse({ ref: 'nginx:1.27', force: false }).success).toBe(true)
    expect(schema.safeParse({ ref: 'my image', force: false }).success).toBe(false)
    expect(schema.safeParse({ ref: '../etc', force: false }).success).toBe(false)
    expect(schema.safeParse({ ref: '', force: false }).success).toBe(false)
  })
})

describe('resolveImageStacks', () => {
  /** An inspect that answers from a table: a missing id is a 404, like Docker's answer for a deleted image. */
  function fakeInspect(table: Record<string, IconKey | null | 'error'>) {
    const calls: string[] = []
    const inspect = async (id: string): Promise<IconKey | null> => {
      calls.push(id)
      const answer = table[id]
      if (answer === 'error') throw new Error('socket hiccup')
      if (answer === undefined) throw Object.assign(new Error('no such image'), { status: 404 })
      return answer
    }
    return { calls, inspect }
  }

  test('returns the icon of every id, and null for the unknown ones', async () => {
    const { inspect } = fakeInspect({ a: 'php', b: null })
    const result = await resolveImageStacks(['a', 'b', 'a'], new Map(), inspect)
    expect(result).toEqual({ a: 'php', b: null })
  })

  test('inspects each image once, and never again once it is cached', async () => {
    const cache = new Map<string, IconKey | null>()
    const first = fakeInspect({ a: 'nodedotjs' })
    await resolveImageStacks(['a'], cache, first.inspect)
    const second = fakeInspect({ a: 'nodedotjs' })
    const result = await resolveImageStacks(['a'], cache, second.inspect)
    expect(first.calls).toEqual(['a'])
    expect(second.calls).toEqual([])
    expect(result).toEqual({ a: 'nodedotjs' })
  })

  test('a deleted image (404) is cached as null, so it is not asked for again', async () => {
    const cache = new Map<string, IconKey | null>()
    const gone = fakeInspect({})
    expect(await resolveImageStacks(['gone'], cache, gone.inspect)).toEqual({ gone: null })
    expect(cache.get('gone')).toBe(null)
    const again = fakeInspect({})
    await resolveImageStacks(['gone'], cache, again.inspect)
    expect(again.calls).toEqual([])
  })

  test('another failure gives null for this call only, and is not cached', async () => {
    const cache = new Map<string, IconKey | null>()
    const flaky = fakeInspect({ a: 'error' })
    expect(await resolveImageStacks(['a'], cache, flaky.inspect)).toEqual({ a: null })
    expect(cache.has('a')).toBe(false)
    const recovered = fakeInspect({ a: 'rust' })
    expect(await resolveImageStacks(['a'], cache, recovered.inspect)).toEqual({ a: 'rust' })
  })

  test('inspects at most eight images at a time', async () => {
    let running = 0
    let peak = 0
    const ids = Array.from({ length: 30 }, (_, i) => `img${i}`)
    const inspect = async (): Promise<IconKey | null> => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 1))
      running -= 1
      return 'go'
    }
    const result = await resolveImageStacks(ids, new Map(), inspect)
    expect(peak).toBe(8)
    expect(Object.keys(result)).toHaveLength(30)
  })
})
