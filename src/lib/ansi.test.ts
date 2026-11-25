import { describe, expect, test } from 'bun:test'
import { ansiToSegments, type AnsiSegment } from './ansi'

const plain = (text: string): AnsiSegment => ({ text, fg: null, bold: false, dim: false })

describe('ansiToSegments', () => {
  test('plain text is one segment', () => {
    expect(ansiToSegments('hello world')).toEqual([plain('hello world')])
  })

  test('an empty string has no segments', () => {
    expect(ansiToSegments('')).toEqual([])
  })

  test('the 8 standard colors and their bright versions', () => {
    for (let code = 0; code < 8; code++) {
      expect(ansiToSegments(`\u001b[${30 + code}mx`)).toEqual([{ text: 'x', fg: code, bold: false, dim: false }])
      expect(ansiToSegments(`\u001b[${90 + code}mx`)).toEqual([{ text: 'x', fg: code + 8, bold: false, dim: false }])
    }
  })

  test('bold and dim, with 22 clearing both', () => {
    expect(ansiToSegments('\u001b[1mB\u001b[2mD\u001b[22mN')).toEqual([
      { text: 'B', fg: null, bold: true, dim: false },
      { text: 'D', fg: null, bold: true, dim: true },
      plain('N'),
    ])
  })

  test('reset with 0 or an empty code, and default color with 39', () => {
    expect(ansiToSegments('\u001b[31mred\u001b[0mplain\u001b[32mgreen\u001b[mplain\u001b[33mxx\u001b[39mdef')).toEqual([
      { text: 'red', fg: 1, bold: false, dim: false },
      plain('plain'),
      { text: 'green', fg: 2, bold: false, dim: false },
      plain('plain'),
      { text: 'xx', fg: 3, bold: false, dim: false },
      plain('def'),
    ])
  })

  test('styles combine in one sequence', () => {
    expect(ansiToSegments('\u001b[1;91mhot\u001b[0m')).toEqual([{ text: 'hot', fg: 9, bold: true, dim: false }])
  })

  test('background colors and other SGR codes are dropped, the text stays', () => {
    expect(ansiToSegments('\u001b[41;4;3mtext\u001b[0m')).toEqual([plain('text')])
  })

  test('extended colors are skipped with their numbers, so the next code still applies', () => {
    expect(ansiToSegments('\u001b[38;5;196;1mA\u001b[38;2;1;2;3mB')).toEqual([
      { text: 'AB', fg: null, bold: true, dim: false },
    ])
  })

  test('non-SGR escape sequences are removed', () => {
    expect(ansiToSegments('a\u001b[2Kb\u001b[?25lc\u001b[1Ad')).toEqual([plain('abcd')])
  })

  test('OSC sequences (titles) are removed, both BEL and ESC backslash ends', () => {
    expect(ansiToSegments('x\u001b]0;title\u0007y\u001b]2;t2\u001b\\z')).toEqual([plain('xyz')])
  })

  test('a two-byte escape is removed', () => {
    expect(ansiToSegments('a\u001bMb')).toEqual([plain('ab')])
  })

  test('a lone escape at the end does not break the text before it', () => {
    expect(ansiToSegments('ok\u001b')).toEqual([plain('ok')])
  })

  test('adjacent pieces with the same style are merged', () => {
    expect(ansiToSegments('\u001b[32ma\u001b[32mb')).toEqual([{ text: 'ab', fg: 2, bold: false, dim: false }])
  })

  test('unicode text is kept', () => {
    expect(ansiToSegments('\u001b[34mété \u{1F680}\u001b[0m')).toEqual([
      { text: 'été \u{1F680}', fg: 4, bold: false, dim: false },
    ])
  })
})
