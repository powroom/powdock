import { describe, expect, test } from 'bun:test'
import { createTtlCache } from './ttl-cache'

function clock(start = 0) {
  let time = start
  return { now: () => time, advance: (ms: number) => (time += ms) }
}

describe('createTtlCache', () => {
  test('keeps the value for the time to live, then loads again', async () => {
    const time = clock()
    const cache = createTtlCache<number>(60_000, time.now)
    let loads = 0
    const load = async () => (loads += 1)

    expect(await cache(load)).toBe(1)
    time.advance(59_000)
    expect(await cache(load)).toBe(1)
    time.advance(2_000)
    expect(await cache(load)).toBe(2)
    expect(loads).toBe(2)
  })

  test('overlapping calls share one load', async () => {
    const cache = createTtlCache<string>(1000, clock().now)
    let loads = 0
    const load = () => {
      loads += 1
      return Promise.resolve('ok')
    }
    const results = await Promise.all([cache(load), cache(load), cache(load)])
    expect(results).toEqual(['ok', 'ok', 'ok'])
    expect(loads).toBe(1)
  })

  test('a failed load is not kept', async () => {
    const cache = createTtlCache<string>(60_000, clock().now)
    await expect(cache(() => Promise.reject(new Error('down')))).rejects.toThrow('down')
    expect(await cache(() => Promise.resolve('back'))).toBe('back')
  })
})
