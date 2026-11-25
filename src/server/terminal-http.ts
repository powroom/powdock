/**
 * The HTTP response head that Docker sends back when pow/dock starts an exec over a raw socket.
 * The socket delivers bytes in chunks, so the head can arrive split across several chunks, and the
 * bytes after the head can arrive in the same chunk. This file is pure, so the unit tests can cover it.
 */

/** Docker's error heads are short. A head longer than this is not from Docker. */
const MAX_HEAD_BYTES = 16 * 1024
const HEAD_END = new Uint8Array([13, 10, 13, 10]) // CRLF CRLF

export interface HttpHead {
  status: number
  /** the Content-Length header, or null when the response has none */
  contentLength: number | null
  /** the bytes after the head: the start of the body, or the first terminal output */
  rest: Uint8Array
}

/**
 * The parsed head once the blank line after the headers has arrived, or null when more bytes are
 * needed. Throws when the bytes are not an HTTP head or the head is too large.
 */
export function parseHttpHead(bytes: Uint8Array): HttpHead | null {
  const end = indexOfBytes(bytes, HEAD_END)
  if (end === -1) {
    if (bytes.length > MAX_HEAD_BYTES) throw new Error('The Docker response headers are too large.')
    return null
  }
  const lines = new TextDecoder().decode(bytes.subarray(0, end)).split('\r\n')
  const statusMatch = /^HTTP\/1\.[01] (\d{3})/.exec(lines[0] ?? '')
  if (!statusMatch) throw new Error('Docker sent a response that is not HTTP.')

  let contentLength: number | null = null
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(':')
    if (colon === -1) continue
    if (line.slice(0, colon).trim().toLowerCase() !== 'content-length') continue
    const value = line.slice(colon + 1).trim()
    contentLength = /^\d+$/.test(value) ? Number(value) : null
  }
  return { status: Number(statusMatch[1]), contentLength, rest: bytes.subarray(end + HEAD_END.length) }
}

/** Joins two byte chunks into one new array. */
export function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  if (b.length === 0) return a
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

/** The index of the first occurrence of `needle` in `haystack`, or -1. */
export function indexOfBytes(haystack: Uint8Array, needle: Uint8Array): number {
  const last = haystack.length - needle.length
  for (let i = 0; i <= last; i += 1) {
    let match = true
    for (let j = 0; j < needle.length; j += 1) {
      if (haystack[i + j] !== needle[j]) {
        match = false
        break
      }
    }
    if (match) return i
  }
  return -1
}
