import { describe, expect, test } from 'bun:test'
import {
  applyPullEvent,
  createPullLineReader,
  EMPTY_PROGRESS,
  encodePullEvent,
  layerCounts,
  outcomeOf,
  parsePullLine,
  type PullEvent,
  type PullProgress,
} from './image-pull'

// Lines shaped like the Docker Engine 29 stream of POST /images/create.
const PULL_LINES: PullEvent[] = [
  { status: '1.27: Pulling from library/nginx', id: '1.27' },
  { status: 'Pulling fs layer', progressDetail: {}, id: 'a1b2c3d4e5f6' },
  { status: 'Downloading', progressDetail: { current: 512, total: 2048 }, progress: '[=>  ]', id: 'a1b2c3d4e5f6' },
  { status: 'Download complete', progressDetail: {}, id: 'a1b2c3d4e5f6' },
  { status: 'Pull complete', progressDetail: {}, id: 'a1b2c3d4e5f6' },
  { status: 'Digest: sha256:0123456789abcdef' },
  { status: 'Status: Downloaded newer image for nginx:1.27' },
]

function fold(events: readonly PullEvent[]): PullProgress {
  return events.reduce(applyPullEvent, EMPTY_PROGRESS)
}

describe('parsePullLine', () => {
  test('reads one JSON object', () => {
    expect(parsePullLine('{"status":"Pulling fs layer","id":"abc"}')).toEqual({
      status: 'Pulling fs layer',
      id: 'abc',
    })
  })

  test('a blank line and a line that is not an object are skipped', () => {
    expect(parsePullLine('   ')).toBeNull()
    expect(parsePullLine('[1,2]')).toBeNull()
    expect(parsePullLine('"text"')).toBeNull()
    expect(parsePullLine('{not json')).toBeNull()
  })
})

describe('createPullLineReader', () => {
  test('a line split across two reads is read whole', () => {
    const reader = createPullLineReader()
    expect(reader.push('{"status":"Down')).toEqual([])
    expect(reader.push('loading","id":"x"}\n{"status":"Done"}\r\n')).toEqual([
      { status: 'Downloading', id: 'x' },
      { status: 'Done' },
    ])
  })

  test('a line with no newline waits for the next read', () => {
    const reader = createPullLineReader()
    expect(reader.push('{"status":"a"}')).toEqual([])
    expect(reader.push('\n')).toEqual([{ status: 'a' }])
  })
})

describe('encodePullEvent', () => {
  test('writes one line that parses back to the same event', () => {
    const line = encodePullEvent({ status: 'Pull complete', id: 'abc' })
    expect(line.endsWith('\n')).toBe(true)
    expect(parsePullLine(line)).toEqual({ status: 'Pull complete', id: 'abc' })
  })
})

describe('applyPullEvent', () => {
  test('one row per layer, updated in place', () => {
    const progress = fold(PULL_LINES)
    expect(progress.layers).toEqual([
      { id: 'a1b2c3d4e5f6', status: 'Pull complete', current: 512, total: 2048, done: true },
    ])
  })

  test('the size of a layer is kept when a later line has no size', () => {
    const progress = fold([
      { status: 'Downloading', id: 'x', progressDetail: { current: 10, total: 100 } },
      { status: 'Waiting', id: 'x', progressDetail: {} },
    ])
    expect(progress.layers[0]).toMatchObject({ status: 'Waiting', current: 10, total: 100, done: false })
  })

  test('the outcome comes from the status lines', () => {
    expect(fold(PULL_LINES).outcome).toBe('downloaded')
    expect(fold([{ status: 'Status: Image is up to date for nginx:1.27' }]).outcome).toBe('up-to-date')
    expect(fold([{ status: 'Pulling from library/nginx' }]).outcome).toBeNull()
  })

  test('the message is the newest line that is not about one layer', () => {
    expect(fold(PULL_LINES).message).toBe('Status: Downloaded newer image for nginx:1.27')
    expect(fold([{ status: '1.27: Pulling from library/nginx', id: '1.27' }]).layers).toEqual([])
  })

  test('an error line sets the error, with Docker message first', () => {
    const progress = fold([
      { status: 'Pulling fs layer', id: 'x' },
      { error: 'manifest unknown', errorDetail: { message: 'manifest for nginx:9 not found: manifest unknown' } },
    ])
    expect(progress.error).toBe('manifest for nginx:9 not found: manifest unknown')
    expect(fold([{ error: 'pull access denied' }]).error).toBe('pull access denied')
  })

  test('layer counts show finished layers out of all', () => {
    const progress = fold([
      { status: 'Pull complete', id: 'a' },
      { status: 'Already exists', id: 'b' },
      { status: 'Downloading', id: 'c', progressDetail: { current: 1, total: 4 } },
    ])
    expect(layerCounts(progress)).toEqual({ done: 2, total: 3 })
  })
})

describe('outcomeOf', () => {
  test('recognises the two success messages and nothing else', () => {
    expect(outcomeOf('Status: Downloaded newer image for nginx:1.27')).toBe('downloaded')
    expect(outcomeOf('Status: Image is up to date for nginx:1.27')).toBe('up-to-date')
    expect(outcomeOf('Waiting')).toBeNull()
  })
})
