import { describe, expect, test } from 'bun:test'
import { CUT_MARK, MAX_LINE_BYTES, createLogDemuxer, type LogLine } from './log-demux'

const encoder = new TextEncoder()

/** One Docker frame: the 8-byte header, then the payload. */
function frame(kind: 1 | 2, text: string): Uint8Array {
  const payload = encoder.encode(text)
  const out = new Uint8Array(8 + payload.length)
  out[0] = kind
  new DataView(out.buffer).setUint32(4, payload.length)
  out.set(payload, 8)
  return out
}

function joinBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0))
  let offset = 0
  for (const part of parts) {
    out.set(part, offset)
    offset += part.length
  }
  return out
}

/** Pushes the bytes in pieces of the given size, then flushes. */
function run(bytes: Uint8Array, pieceSize: number, options = { tty: false, timestamps: true }): LogLine[] {
  const demux = createLogDemuxer(options)
  const lines: LogLine[] = []
  for (let pos = 0; pos < bytes.length; pos += pieceSize) {
    lines.push(...demux.push(bytes.subarray(pos, pos + pieceSize)))
  }
  lines.push(...demux.flush())
  return lines
}

const TS = '2026-01-02T03:04:05.123456789Z'

describe('framed stream (no TTY)', () => {
  test('splits stdout and stderr frames into lines', () => {
    const bytes = joinBytes(frame(1, `${TS} hello\n`), frame(2, `${TS} oops\n`))
    expect(run(bytes, bytes.length)).toEqual([
      { stream: 'out', timestamp: TS, text: 'hello' },
      { stream: 'err', timestamp: TS, text: 'oops' },
    ])
  })

  test('a line split across two frames of one stream is joined, while the other stream keeps its own line', () => {
    const bytes = joinBytes(frame(1, `${TS} sta`), frame(2, `${TS} warn\n`), frame(1, 'rt\n'))
    expect(run(bytes, bytes.length)).toEqual([
      { stream: 'err', timestamp: TS, text: 'warn' },
      { stream: 'out', timestamp: TS, text: 'start' },
    ])
  })

  test('the same stream gives the same lines whatever the chunk size', () => {
    const text = `${TS} first\n${TS} second line\n\n${TS} third\n`
    const bytes = joinBytes(frame(1, text.slice(0, 20)), frame(1, text.slice(20)))
    const whole = run(bytes, bytes.length)
    for (const size of [1, 2, 3, 5, 7, 8, 9, 13]) {
      expect(run(bytes, size)).toEqual(whole)
    }
    expect(whole.map((line) => line.text)).toEqual(['first', 'second line', '', 'third'])
  })

  test('a frame header split across chunks is read once it is complete', () => {
    const bytes = frame(1, `${TS} split header\n`)
    const demux = createLogDemuxer({ tty: false, timestamps: true })
    expect(demux.push(bytes.subarray(0, 3))).toEqual([])
    expect(demux.push(bytes.subarray(3, 8))).toEqual([])
    expect(demux.push(bytes.subarray(8))).toEqual([{ stream: 'out', timestamp: TS, text: 'split header' }])
  })

  test('a UTF-8 character split across chunks is decoded whole', () => {
    const payload = encoder.encode(`${TS} café \u{1F680}\n`)
    const bytes = frame(1, '')
    const full = joinBytes(bytes.subarray(0, 0), frame(1, `${TS} café \u{1F680}\n`))
    expect(payload.length).toBeGreaterThan(20)
    for (const size of [1, 2, 3, 4, 5, 6]) {
      expect(run(full, size)).toEqual([{ stream: 'out', timestamp: TS, text: 'café \u{1F680}' }])
    }
  })

  test('a trailing line without a newline is returned by flush', () => {
    const demux = createLogDemuxer({ tty: false, timestamps: true })
    expect(demux.push(frame(2, `${TS} done\n${TS} half`))).toEqual([{ stream: 'err', timestamp: TS, text: 'done' }])
    expect(demux.flush()).toEqual([{ stream: 'err', timestamp: TS, text: 'half' }])
    expect(demux.flush()).toEqual([])
  })

  test('carriage returns before the newline are removed', () => {
    const bytes = frame(1, `${TS} windows\r\n`)
    expect(run(bytes, bytes.length)).toEqual([{ stream: 'out', timestamp: TS, text: 'windows' }])
  })

  test('a line over the cap is cut, its rest is dropped, and the next line is intact', () => {
    const long = 'x'.repeat(MAX_LINE_BYTES + 5000)
    const bytes = joinBytes(frame(1, `${long}\nnext\n`))
    const lines = run(bytes, 1000, { tty: false, timestamps: false })
    expect(lines).toEqual([
      { stream: 'out', timestamp: null, text: `${'x'.repeat(MAX_LINE_BYTES)}${CUT_MARK}` },
      { stream: 'out', timestamp: null, text: 'next' },
    ])
  })

  test('without the timestamps flag the text is kept whole', () => {
    const bytes = frame(1, `${TS} not split\n`)
    expect(run(bytes, bytes.length, { tty: false, timestamps: false })).toEqual([
      { stream: 'out', timestamp: null, text: `${TS} not split` },
    ])
  })

  test('a line with only a timestamp has an empty text', () => {
    const bytes = frame(1, `${TS}\n`)
    expect(run(bytes, bytes.length)).toEqual([{ stream: 'out', timestamp: TS, text: '' }])
  })

  test('a line without a timestamp keeps its text', () => {
    const bytes = frame(1, 'plain text\n')
    expect(run(bytes, bytes.length)).toEqual([{ stream: 'out', timestamp: null, text: 'plain text' }])
  })
})

describe('raw stream (TTY)', () => {
  test('bytes are read as stdout lines with no frame headers', () => {
    const raw = encoder.encode(`${TS} one\r\n${TS} two\n${TS} three`)
    expect(run(raw, raw.length, { tty: true, timestamps: true })).toEqual([
      { stream: 'out', timestamp: TS, text: 'one' },
      { stream: 'out', timestamp: TS, text: 'two' },
      { stream: 'out', timestamp: TS, text: 'three' },
    ])
  })

  test('a raw stream split at any point gives the same lines', () => {
    const raw = encoder.encode(`${TS} alpha\n${TS} été\n`)
    const whole = run(raw, raw.length, { tty: true, timestamps: true })
    for (const size of [1, 2, 3, 4, 7]) {
      expect(run(raw, size, { tty: true, timestamps: true })).toEqual(whole)
    }
    expect(whole.map((line) => line.text)).toEqual(['alpha', 'été'])
  })
})
