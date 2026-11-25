import { describe, expect, test } from 'bun:test'
import {
  backoffMs,
  changesDiskUsage,
  countsKey,
  createEventParser,
  debounceWaitMs,
  kindOf,
  needsRefresh,
  staleKindOf,
  parseEventLine,
  CONTAINER_MAX_AGE_MS,
  DOWN_MAX_AGE_MS,
  type FreshnessInput,
} from './docker-cache.server'

// The pure parts of the Docker cache. Nothing here touches the Docker socket.

const CONTAINER_EVENT = '{"Type":"container","Action":"start","Actor":{"ID":"abc"},"time":1795490750}'
const IMAGE_EVENT = '{"Type":"image","Action":"pull","Actor":{"ID":"sha256:1"},"time":1795490751}'

function freshness(overrides: Partial<FreshnessInput> = {}): FreshnessInput {
  return {
    hasValue: true,
    builtAt: 1_000_000,
    builtVersion: 3,
    version: 3,
    now: 1_000_000,
    streamUp: true,
    maxAgeMs: CONTAINER_MAX_AGE_MS,
    ...overrides,
  }
}

describe('parseEventLine', () => {
  test('reads the type and the action of one event', () => {
    expect(parseEventLine(CONTAINER_EVENT)).toEqual({ type: 'container', action: 'start' })
  })

  test('accepts lower case keys too', () => {
    expect(parseEventLine('{"type":"volume","action":"create"}')).toEqual({ type: 'volume', action: 'create' })
  })

  test('gives an empty action when the event has none', () => {
    expect(parseEventLine('{"Type":"network"}')).toEqual({ type: 'network', action: '' })
  })

  test('returns null for blank lines, bad JSON, non-objects and events without a type', () => {
    expect(parseEventLine('')).toBeNull()
    expect(parseEventLine('   ')).toBeNull()
    expect(parseEventLine('{"Type":')).toBeNull()
    expect(parseEventLine('42')).toBeNull()
    expect(parseEventLine('null')).toBeNull()
    expect(parseEventLine('{"Action":"start"}')).toBeNull()
    expect(parseEventLine('{"Type":5}')).toBeNull()
  })
})

describe('createEventParser', () => {
  test('reads several objects in one chunk', () => {
    const parser = createEventParser()
    const events = parser.push(`${CONTAINER_EVENT}\n${IMAGE_EVENT}\n`)
    expect(events.map((event) => event.type)).toEqual(['container', 'image'])
  })

  test('keeps a line that is cut by the end of a chunk until the rest arrives', () => {
    const parser = createEventParser()
    const cut = 20
    expect(parser.push(CONTAINER_EVENT.slice(0, cut))).toEqual([])
    const events = parser.push(`${CONTAINER_EVENT.slice(cut)}\n`)
    expect(events).toEqual([{ type: 'container', action: 'start' }])
  })

  test('joins a line split into three chunks', () => {
    const parser = createEventParser()
    expect(parser.push(IMAGE_EVENT.slice(0, 5))).toEqual([])
    expect(parser.push(IMAGE_EVENT.slice(5, 40))).toEqual([])
    expect(parser.push(`${IMAGE_EVENT.slice(40)}\n`)).toEqual([{ type: 'image', action: 'pull' }])
  })

  test('reads a complete line and keeps the start of the next one', () => {
    const parser = createEventParser()
    const events = parser.push(`${CONTAINER_EVENT}\n${IMAGE_EVENT.slice(0, 10)}`)
    expect(events).toHaveLength(1)
    const rest = parser.push(`${IMAGE_EVENT.slice(10)}\n`)
    expect(rest).toEqual([{ type: 'image', action: 'pull' }])
  })

  test('skips lines that are not events and keeps the good ones', () => {
    const parser = createEventParser()
    const events = parser.push(`not json\n\n${CONTAINER_EVENT}\n{"oops":true}\n`)
    expect(events).toEqual([{ type: 'container', action: 'start' }])
  })
})

describe('kindOf', () => {
  test('maps the four cached types and ignores the rest', () => {
    expect(kindOf('container')).toBe('container')
    expect(kindOf('image')).toBe('image')
    expect(kindOf('volume')).toBe('volume')
    expect(kindOf('network')).toBe('network')
    expect(kindOf('daemon')).toBeNull()
    expect(kindOf('Container')).toBeNull()
  })
})

describe('staleKindOf', () => {
  test('a container start or a health status marks the containers stale', () => {
    expect(staleKindOf({ type: 'container', action: 'start' })).toBe('container')
    expect(staleKindOf({ type: 'container', action: 'health_status: healthy' })).toBe('container')
  })

  test('exec events of a container (health checks) change no list', () => {
    expect(staleKindOf({ type: 'container', action: 'exec_create: /bin/sh -c true' })).toBeNull()
    expect(staleKindOf({ type: 'container', action: 'exec_start: /bin/sh -c true' })).toBeNull()
    expect(staleKindOf({ type: 'container', action: 'exec_die' })).toBeNull()
  })

  test('image, volume and network events map to their own kind', () => {
    expect(staleKindOf({ type: 'image', action: 'pull' })).toBe('image')
    expect(staleKindOf({ type: 'volume', action: 'create' })).toBe('volume')
    expect(staleKindOf({ type: 'network', action: 'destroy' })).toBe('network')
    expect(staleKindOf({ type: 'daemon', action: 'reload' })).toBeNull()
  })
})

describe('backoffMs', () => {
  test('waits 1, 2, 5 and then 30 seconds, and keeps 30 seconds after that', () => {
    expect([0, 1, 2, 3, 4, 50].map(backoffMs)).toEqual([1_000, 2_000, 5_000, 30_000, 30_000, 30_000])
  })

  test('treats a negative attempt as the first one', () => {
    expect(backoffMs(-1)).toBe(1_000)
  })
})

describe('debounceWaitMs', () => {
  test('waits the rest of the 250 ms since the last refresh started', () => {
    expect(debounceWaitMs(1_000, 1_100)).toBe(150)
    expect(debounceWaitMs(1_000, 1_250)).toBe(0)
    expect(debounceWaitMs(1_000, 5_000)).toBe(0)
  })

  test('does not wait before the first refresh', () => {
    expect(debounceWaitMs(-Infinity, 5_000)).toBe(0)
  })
})

describe('needsRefresh', () => {
  test('a fresh value is kept', () => {
    expect(needsRefresh(freshness())).toBe(false)
  })

  test('no value yet means a read', () => {
    expect(needsRefresh(freshness({ hasValue: false }))).toBe(true)
  })

  test('an event after the read means a read', () => {
    expect(needsRefresh(freshness({ version: 4 }))).toBe(true)
  })

  test('a value older than its maximum age means a read (containers: 15 seconds)', () => {
    expect(needsRefresh(freshness({ now: 1_000_000 + CONTAINER_MAX_AGE_MS - 1 }))).toBe(false)
    expect(needsRefresh(freshness({ now: 1_000_000 + CONTAINER_MAX_AGE_MS }))).toBe(true)
  })

  test('images never age out by time', () => {
    expect(needsRefresh(freshness({ maxAgeMs: Infinity, now: 1_000_000 + 10 * 60_000 }))).toBe(false)
  })

  test('while the stream is down a value is stale after 3 seconds', () => {
    const down = { streamUp: false, maxAgeMs: Infinity }
    expect(needsRefresh(freshness({ ...down, now: 1_000_000 + DOWN_MAX_AGE_MS - 1 }))).toBe(false)
    expect(needsRefresh(freshness({ ...down, now: 1_000_000 + DOWN_MAX_AGE_MS }))).toBe(true)
  })
})

describe('countsKey', () => {
  test('changes when any counter moves, and not otherwise', () => {
    const base = { container: 1, image: 2, volume: 3, network: 4 }
    expect(countsKey(base)).toBe('1:2:3:4')
    expect(countsKey({ ...base, volume: 9 })).not.toBe(countsKey(base))
    expect(countsKey({ ...base })).toBe(countsKey(base))
  })
})

describe('changesDiskUsage', () => {
  test('destroy events of containers, images and volumes change the disk usage', () => {
    expect(changesDiskUsage({ type: 'container', action: 'destroy' })).toBe(true)
    expect(changesDiskUsage({ type: 'image', action: 'destroy' })).toBe(true)
    expect(changesDiskUsage({ type: 'volume', action: 'destroy' })).toBe(true)
  })

  test('other events do not', () => {
    expect(changesDiskUsage({ type: 'container', action: 'start' })).toBe(false)
    expect(changesDiskUsage({ type: 'image', action: 'pull' })).toBe(false)
    expect(changesDiskUsage({ type: 'network', action: 'destroy' })).toBe(false)
  })
})
