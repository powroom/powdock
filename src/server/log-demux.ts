/**
 * Turns Docker's logs stream into lines. Without a TTY, Docker sends frames: an 8-byte header
 * (byte 0 is 1 for stdout and 2 for stderr, bytes 4 to 7 are the payload size as a big-endian
 * number) and then the payload. With a TTY the stream is raw bytes, and every line is stdout.
 *
 * The demuxer is pure: bytes in, lines out. Chunks may end anywhere, even inside a frame header,
 * a line or a UTF-8 character, so the bytes are kept until a line is complete and decoded only then.
 */

export type LogStream = 'out' | 'err'

export interface LogLine {
  stream: LogStream
  /** Docker's RFC 3339 time with nanoseconds, or null when the stream has none */
  timestamp: string | null
  /** the line without its timestamp, its newline and a trailing carriage return */
  text: string
}

export interface LogDemuxer {
  /** Feeds the next bytes of the stream. Returns the lines they complete, in order. */
  push(chunk: Uint8Array): LogLine[]
  /** The stream has ended: returns the partial lines still held (no newline came for them). */
  flush(): LogLine[]
}

export interface LogDemuxerOptions {
  /** the container has a TTY, so the stream is raw and has no frames */
  tty: boolean
  /** the stream starts each line with a timestamp (the timestamps query flag was set) */
  timestamps: boolean
}

/** A single line is cut at this many bytes. The rest of it is dropped up to the newline. */
export const MAX_LINE_BYTES = 16 * 1024
/** Shown after a line that was cut. */
export const CUT_MARK = ' [line cut at 16 KB]'

const FRAME_HEADER_BYTES = 8
const FRAME_SIZE_OFFSET = 4
const STDERR_FRAME = 2
const NEWLINE = 0x0a
const CARRIAGE_RETURN = '\r'
/** Docker's timestamp, then one space (or the end of the line when the message is empty). */
const TIMESTAMP = /^(\d{4}-\d{2}-\d{2}T\S+)(?: |$)/

interface LineBuffer {
  parts: Uint8Array[]
  size: number
  /** the line went over the cap: its bytes are dropped until the newline */
  skipping: boolean
}

function emptyBuffer(): LineBuffer {
  return { parts: [], size: 0, skipping: false }
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b
  const out = new Uint8Array(a.length + b.length)
  out.set(a, 0)
  out.set(b, a.length)
  return out
}

function joinParts(parts: readonly Uint8Array[], size: number): Uint8Array {
  const out = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

function splitTimestamp(line: string, timestamps: boolean): { timestamp: string | null; text: string } {
  if (!timestamps) return { timestamp: null, text: line }
  const match = TIMESTAMP.exec(line)
  if (!match) return { timestamp: null, text: line }
  return { timestamp: match[1] ?? null, text: line.slice(match[0].length) }
}

export function createLogDemuxer(options: LogDemuxerOptions): LogDemuxer {
  const buffers: Record<LogStream, LineBuffer> = { out: emptyBuffer(), err: emptyBuffer() }
  const decoder = new TextDecoder('utf-8')
  // bytes of a frame whose payload has not all arrived yet
  let pendingFrame = new Uint8Array(0)

  function emit(stream: LogStream, buffer: LineBuffer, cut: boolean, out: LogLine[]): void {
    const bytes = joinParts(buffer.parts, buffer.size)
    buffer.parts = []
    buffer.size = 0
    let line = decoder.decode(bytes)
    if (line.endsWith(CARRIAGE_RETURN)) line = line.slice(0, -1)
    const { timestamp, text } = splitTimestamp(line, options.timestamps)
    out.push({ stream, timestamp, text: cut ? `${text}${CUT_MARK}` : text })
  }

  function feed(stream: LogStream, bytes: Uint8Array, out: LogLine[]): void {
    const buffer = buffers[stream]
    let pos = 0
    for (;;) {
      const newline = bytes.indexOf(NEWLINE, pos)
      const end = newline === -1 ? bytes.length : newline
      if (!buffer.skipping) {
        const room = MAX_LINE_BYTES - buffer.size
        if (end - pos <= room) {
          addPart(buffer, bytes.subarray(pos, end))
        } else {
          addPart(buffer, bytes.subarray(pos, pos + room))
          emit(stream, buffer, true, out)
          buffer.skipping = true
        }
      }
      if (newline === -1) return
      if (!buffer.skipping) emit(stream, buffer, false, out)
      buffer.skipping = false
      pos = newline + 1
    }
  }

  return {
    push(chunk) {
      const out: LogLine[] = []
      if (options.tty) {
        feed('out', chunk, out)
        return out
      }
      const data = concat(pendingFrame, chunk)
      let pos = 0
      while (data.length - pos >= FRAME_HEADER_BYTES) {
        const size = new DataView(data.buffer, data.byteOffset + pos, FRAME_HEADER_BYTES).getUint32(FRAME_SIZE_OFFSET)
        const payloadEnd = pos + FRAME_HEADER_BYTES + size
        if (payloadEnd > data.length) break
        const stream: LogStream = data[pos] === STDERR_FRAME ? 'err' : 'out'
        feed(stream, data.subarray(pos + FRAME_HEADER_BYTES, payloadEnd), out)
        pos = payloadEnd
      }
      pendingFrame = data.slice(pos)
      return out
    },
    flush() {
      const out: LogLine[] = []
      for (const stream of ['out', 'err'] as const) {
        const buffer = buffers[stream]
        if (buffer.size > 0) emit(stream, buffer, false, out)
        buffer.skipping = false
      }
      pendingFrame = new Uint8Array(0)
      return out
    },
  }
}

/** Keeps a copy of the part, so the caller may reuse its chunk. */
function addPart(buffer: LineBuffer, part: Uint8Array): void {
  if (part.length === 0) return
  buffer.parts.push(part.slice())
  buffer.size += part.length
}
