import { describe, expect, test } from 'bun:test'
import { DEFAULT_PORT, parsePort } from './port'

describe('parsePort', () => {
  test('unset means the default port', () => {
    expect(parsePort(undefined)).toBe(DEFAULT_PORT)
    expect(DEFAULT_PORT).toBe(3434)
  })

  test('integers from 1 to 65535 are accepted', () => {
    expect(parsePort('1')).toBe(1)
    expect(parsePort('8080')).toBe(8080)
    expect(parsePort(' 8080 ')).toBe(8080)
    expect(parsePort('65535')).toBe(65535)
  })

  test('anything else is refused', () => {
    for (const bad of ['', ' ', '0', '-1', '65536', '70000', 'abc', '3.5', '3000x', '0x10', '1e3']) {
      expect(parsePort(bad)).toBeNull()
    }
  })
})
