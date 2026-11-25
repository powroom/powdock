import { afterEach, describe, expect, test } from 'bun:test'
import { clientIpFrom } from './util.server'

const SAVED = process.env.POWDOCK_TRUST_PROXY
afterEach(() => {
  if (SAVED === undefined) delete process.env.POWDOCK_TRUST_PROXY
  else process.env.POWDOCK_TRUST_PROXY = SAVED
})

const SOCKET = '198.51.100.4'

function req(headers: Record<string, string>): Request {
  return new Request('http://localhost:3335/api/auth/login', { method: 'POST', headers })
}

describe('client IP for the login rate limit', () => {
  test('with POWDOCK_TRUST_PROXY off, forwarded headers are ignored and the socket address is used', () => {
    delete process.env.POWDOCK_TRUST_PROXY
    const request = req({ 'x-forwarded-for': '203.0.113.9, 10.0.0.1', 'x-real-ip': '203.0.113.10' })
    expect(clientIpFrom(request, SOCKET)).toBe(SOCKET)
    process.env.POWDOCK_TRUST_PROXY = 'false'
    expect(clientIpFrom(request, SOCKET)).toBe(SOCKET)
  })

  test('with POWDOCK_TRUST_PROXY=true, the first X-Forwarded-For address is used', () => {
    process.env.POWDOCK_TRUST_PROXY = 'true'
    const request = req({ 'x-forwarded-for': ' 203.0.113.9 , 10.0.0.1', 'x-real-ip': '203.0.113.10' })
    expect(clientIpFrom(request, SOCKET)).toBe('203.0.113.9')
  })

  test('with trust on, X-Real-IP is the fallback, then the socket address', () => {
    process.env.POWDOCK_TRUST_PROXY = 'true'
    expect(clientIpFrom(req({ 'x-real-ip': '203.0.113.10' }), SOCKET)).toBe('203.0.113.10')
    expect(clientIpFrom(req({}), SOCKET)).toBe(SOCKET)
  })

  test('no address at all is "unknown"', () => {
    delete process.env.POWDOCK_TRUST_PROXY
    expect(clientIpFrom(req({ 'x-forwarded-for': '203.0.113.9' }), undefined)).toBe('unknown')
  })

  test('an empty socket address with no headers is "unknown"', () => {
    delete process.env.POWDOCK_TRUST_PROXY
    expect(clientIpFrom(req({}), '')).toBe('unknown')
  })

  test('an empty first X-Forwarded-For hop falls through to X-Real-IP', () => {
    process.env.POWDOCK_TRUST_PROXY = 'true'
    expect(clientIpFrom(req({ 'x-forwarded-for': ' , 10.0.0.1', 'x-real-ip': '203.0.113.20' }), SOCKET)).toBe(
      '203.0.113.20',
    )
  })

  test('an empty X-Forwarded-For header falls through to the socket address', () => {
    process.env.POWDOCK_TRUST_PROXY = 'true'
    expect(clientIpFrom(req({ 'x-forwarded-for': '' }), SOCKET)).toBe(SOCKET)
  })

  test('X-Real-IP is trimmed', () => {
    process.env.POWDOCK_TRUST_PROXY = 'true'
    expect(clientIpFrom(req({ 'x-real-ip': '  203.0.113.21  ' }), SOCKET)).toBe('203.0.113.21')
  })

  test('only the value "true" (trimmed, any case) turns trust on', () => {
    for (const value of ['1', 'yes', 'on']) {
      process.env.POWDOCK_TRUST_PROXY = value
      expect(clientIpFrom(req({ 'x-forwarded-for': '203.0.113.9' }), SOCKET)).toBe(SOCKET)
    }
    process.env.POWDOCK_TRUST_PROXY = ' True '
    expect(clientIpFrom(req({ 'x-forwarded-for': '203.0.113.9' }), SOCKET)).toBe('203.0.113.9')
  })
})
