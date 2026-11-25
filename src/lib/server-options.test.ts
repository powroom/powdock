import { describe, expect, test } from 'bun:test'
import { IDLE_TIMEOUT_SECONDS, MAX_REQUEST_BODY_BYTES } from './server-options'

describe('server options', () => {
  test('the idle timeout is within what Bun accepts (seconds, at most 255)', () => {
    expect(IDLE_TIMEOUT_SECONDS).toBeGreaterThan(0)
    expect(IDLE_TIMEOUT_SECONDS).toBeLessThanOrEqual(255)
  })

  test('the request body limit is 1 MB', () => {
    expect(MAX_REQUEST_BODY_BYTES).toBe(1024 * 1024)
  })
})
