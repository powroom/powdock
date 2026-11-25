import { describe, expect, test } from 'bun:test'
import { concatBytes, indexOfBytes, parseHttpHead } from './terminal-http'

const encoder = new TextEncoder()
const bytes = (text: string) => encoder.encode(text)
const text = (value: Uint8Array) => new TextDecoder().decode(value)

describe('parseHttpHead', () => {
  test('returns null until the blank line after the headers has arrived', () => {
    expect(parseHttpHead(bytes('HTTP/1.1 101 UPGRADED\r\nUpgrade: tcp\r\n'))).toBeNull()
    expect(parseHttpHead(bytes('HTTP/1.1 101 UPGRADED\r\nUpgrade: tcp\r\n\r'))).toBeNull()
  })

  test('reads the head when it is split across several chunks', () => {
    const chunks = ['HTTP/1.1 101 UPG', 'RADED\r\nConnection: Upgr', 'ade\r\n', '\r\n']
    let buffer: Uint8Array = new Uint8Array(0)
    let head = null
    for (const chunk of chunks) {
      buffer = concatBytes(buffer, bytes(chunk))
      head = parseHttpHead(buffer)
    }
    expect(head).not.toBeNull()
    expect(head?.status).toBe(101)
    expect(head?.rest.length).toBe(0)
  })

  test('keeps the bytes that came after the head in the same chunk', () => {
    const head = parseHttpHead(
      bytes('HTTP/1.1 101 UPGRADED\r\nContent-Type: application/vnd.docker.raw-stream\r\n\r\nhello\r\n'),
    )
    expect(head?.status).toBe(101)
    expect(text(head?.rest ?? new Uint8Array())).toBe('hello\r\n')
  })

  test('reads a 200 status and the content length of an error body', () => {
    const body = '{"message":"exec failed"}'
    const head = parseHttpHead(
      bytes(
        `HTTP/1.1 500 Internal Server Error\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
      ),
    )
    expect(head?.status).toBe(500)
    expect(head?.contentLength).toBe(body.length)
    expect(text(head?.rest ?? new Uint8Array())).toBe(body)
  })

  test('reads the header names without regard to case', () => {
    const head = parseHttpHead(bytes('HTTP/1.1 404 Not Found\r\ncontent-length: 4\r\n\r\nnone'))
    expect(head?.contentLength).toBe(4)
  })

  test('has no content length when the header is missing', () => {
    const head = parseHttpHead(bytes('HTTP/1.1 200 OK\r\n\r\n'))
    expect(head?.status).toBe(200)
    expect(head?.contentLength).toBeNull()
  })

  test('refuses bytes that are not an HTTP response', () => {
    expect(() => parseHttpHead(bytes('SSH-2.0-OpenSSH\r\n\r\n'))).toThrow('not HTTP')
  })

  test('refuses a head that grows too large without a blank line', () => {
    expect(() => parseHttpHead(new Uint8Array(17 * 1024).fill(65))).toThrow('too large')
  })
})

describe('byte helpers', () => {
  test('indexOfBytes finds the first match, or -1', () => {
    expect(indexOfBytes(bytes('ab\r\n\r\ncd'), bytes('\r\n\r\n'))).toBe(2)
    expect(indexOfBytes(bytes('abc'), bytes('\r\n'))).toBe(-1)
  })

  test('concatBytes joins without losing bytes', () => {
    expect(text(concatBytes(bytes('ab'), bytes('cd')))).toBe('abcd')
    expect(text(concatBytes(new Uint8Array(0), bytes('x')))).toBe('x')
  })
})
