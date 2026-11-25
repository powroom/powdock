import { describe, expect, test } from 'bun:test'
import { logSocketUrl, logSourceKey, SERVICE_TONE_CLASSES, serviceToneIndex } from './log-source'

describe('logSocketUrl', () => {
  const http = { protocol: 'http:', host: 'localhost:3434' }

  test('a container keeps its own tail and timestamps, on ws for http pages', () => {
    expect(logSocketUrl({ kind: 'container', id: 'abc123def456' }, 500, http)).toBe(
      'ws://localhost:3434/api/containers/abc123def456/logs?tail=500&timestamps=1',
    )
  })

  test('a project always asks for the last 200 lines, and encodes the name', () => {
    expect(logSocketUrl({ kind: 'project', name: 'shop app' }, 500, http)).toBe(
      'ws://localhost:3434/api/projects/shop%20app/logs?tail=200',
    )
  })

  test('https pages use wss', () => {
    expect(logSocketUrl({ kind: 'container', id: 'abc123def456' }, 10, { protocol: 'https:', host: 'dock.test' })).toBe(
      'wss://dock.test/api/containers/abc123def456/logs?tail=10&timestamps=1',
    )
  })
})

describe('logSourceKey', () => {
  test('a container and a project with the same name have different keys', () => {
    expect(logSourceKey({ kind: 'container', id: 'x' })).not.toBe(logSourceKey({ kind: 'project', name: 'x' }))
  })
})

describe('serviceToneIndex', () => {
  test('the same name always gets the same tone, inside the palette', () => {
    expect(serviceToneIndex('web-1')).toBe(serviceToneIndex('web-1'))
    for (const name of ['web', 'db', 'redis', 'worker', 'a']) {
      const index = serviceToneIndex(name)
      expect(index).toBeGreaterThanOrEqual(0)
      expect(index).toBeLessThan(SERVICE_TONE_CLASSES.length)
    }
  })
})
