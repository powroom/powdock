import { describe, expect, test } from 'bun:test'
import {
  COMPRESS_MIN_BYTES,
  PRECOMPRESS_MIN_BYTES,
  acceptsEncoding,
  isSmallBody,
  mayCompress,
  shouldCompress,
  shouldPrecompress,
} from './compression'

describe('acceptsEncoding', () => {
  test('accepts a listed coding', () => {
    expect(acceptsEncoding('gzip, deflate, br', 'gzip')).toBe(true)
    expect(acceptsEncoding('gzip, deflate, br', 'br')).toBe(true)
    expect(acceptsEncoding('deflate', 'gzip')).toBe(false)
  })

  test('q=0 refuses the coding', () => {
    expect(acceptsEncoding('gzip;q=0', 'gzip')).toBe(false)
    expect(acceptsEncoding('gzip;q=0.000, br', 'gzip')).toBe(false)
    expect(acceptsEncoding('gzip;q=0.5', 'gzip')).toBe(true)
  })

  test('an explicit entry overrides the wildcard, in either direction', () => {
    expect(acceptsEncoding('*', 'gzip')).toBe(true)
    expect(acceptsEncoding('*;q=0', 'gzip')).toBe(false)
    expect(acceptsEncoding('gzip;q=0, *', 'gzip')).toBe(false)
    expect(acceptsEncoding('*;q=0, br', 'gzip')).toBe(false)
    expect(acceptsEncoding('*;q=0, br', 'br')).toBe(true)
  })

  test('names and parameters are case-insensitive, and spaces are tolerated', () => {
    expect(acceptsEncoding('GZIP', 'gzip')).toBe(true)
    expect(acceptsEncoding(' Gzip ; Q=0 ', 'gzip')).toBe(false)
    expect(acceptsEncoding('BR;q=1', 'br')).toBe(true)
  })

  test('x-gzip is an alias for gzip', () => {
    expect(acceptsEncoding('x-gzip', 'gzip')).toBe(true)
  })

  test('a malformed q value refuses the coding', () => {
    expect(acceptsEncoding('gzip;q=abc', 'gzip')).toBe(false)
    expect(acceptsEncoding('gzip;q=2', 'gzip')).toBe(false)
  })

  test('missing or empty header accepts nothing', () => {
    expect(acceptsEncoding(null, 'gzip')).toBe(false)
    expect(acceptsEncoding(undefined, 'br')).toBe(false)
    expect(acceptsEncoding('', 'gzip')).toBe(false)
  })
})

describe('shouldCompress', () => {
  test.each([
    'text/html; charset=utf-8',
    'text/plain',
    'text/csv; charset=utf-8',
    'text/javascript',
    'application/json',
    'application/json; charset=utf-8',
    'application/javascript',
    'application/x-ndjson',
    'application/problem+json',
    'application/x-tss-framed; v=1',
    'image/svg+xml',
    'APPLICATION/JSON',
  ])('compresses %p', (type) => {
    expect(shouldCompress(type)).toBe(true)
  })

  test.each([
    'text/event-stream',
    'application/gzip',
    'application/x-gzip',
    'application/octet-stream',
    'application/zip',
    'image/png',
    'image/jpeg',
    'image/webp',
    'font/woff2',
    'application/font-woff',
    'application/wasm',
    null,
    undefined,
    '',
  ])('does not compress %p', (type) => {
    expect(shouldCompress(type)).toBe(false)
  })
})

describe('isSmallBody', () => {
  test('a Content-Length under the floor is small', () => {
    expect(isSmallBody('0')).toBe(true)
    expect(isSmallBody('80')).toBe(true)
    expect(isSmallBody(' 1023 ')).toBe(true)
  })

  test('a Content-Length at or over the floor is not small', () => {
    expect(COMPRESS_MIN_BYTES).toBe(1024)
    expect(isSmallBody('1024')).toBe(false)
    expect(isSmallBody('90000')).toBe(false)
  })

  test('a missing or invalid Content-Length is not small, so the body is compressed', () => {
    expect(isSmallBody(null)).toBe(false)
    expect(isSmallBody(undefined)).toBe(false)
    expect(isSmallBody('')).toBe(false)
    expect(isSmallBody('-1')).toBe(false)
    expect(isSmallBody('12abc')).toBe(false)
  })
})

describe('shouldPrecompress', () => {
  test('listed extensions over the size floor', () => {
    expect(shouldPrecompress('assets/index-abc.js', PRECOMPRESS_MIN_BYTES + 1)).toBe(true)
    expect(shouldPrecompress('index.HTML', 5000)).toBe(true)
    expect(shouldPrecompress('site.webmanifest', 2000)).toBe(true)
  })

  test('small files, other types and names without an extension are skipped', () => {
    expect(shouldPrecompress('assets/a.js', PRECOMPRESS_MIN_BYTES)).toBe(false)
    expect(shouldPrecompress('logo.png', 90_000)).toBe(false)
    expect(shouldPrecompress('font.woff2', 90_000)).toBe(false)
    expect(shouldPrecompress('LICENSE', 90_000)).toBe(false)
    expect(shouldPrecompress('a.js.gz', 90_000)).toBe(false)
  })
})

describe('mayCompress', () => {
  test('a response with no-transform is never compressed', () => {
    expect(mayCompress('no-store, no-transform')).toBe(false)
    expect(mayCompress('No-Transform')).toBe(false)
  })

  test('other cache headers and a missing one allow compression', () => {
    expect(mayCompress('no-store')).toBe(true)
    expect(mayCompress('no-transform-ish')).toBe(true)
    expect(mayCompress(null)).toBe(true)
  })
})
