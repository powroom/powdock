import { describe, expect, test } from 'bun:test'
import { highlightYaml, highlightYamlLine } from './yaml-highlight'

const kinds = (line: string) => highlightYamlLine(line).map((token) => `${token.kind}:${token.text}`)

describe('highlightYamlLine', () => {
  test('a key is marked, its value is marked by type', () => {
    expect(kinds('  image: nginx')).toEqual(['plain:  ', 'key:image', 'plain:: nginx'])
    expect(kinds('  restart: true')).toEqual(['plain:  ', 'key:restart', 'plain:: ', 'bool:true'])
    expect(kinds('  port: 8080')).toEqual(['plain:  ', 'key:port', 'plain:: ', 'number:8080'])
  })

  test('a list item keeps its dash and marks the key after it', () => {
    expect(kinds('  - name: web')).toEqual(['plain:  - ', 'key:name', 'plain:: web'])
  })

  test('a quoted string keeps a # inside it', () => {
    expect(kinds('  cmd: "a # b"')).toEqual(['plain:  ', 'key:cmd', 'plain:: ', 'string:"a # b"'])
  })

  test('a comment at the end of a line is marked, and a whole comment line too', () => {
    expect(kinds('  x: 1 # note')).toEqual(['plain:  ', 'key:x', 'plain:: ', 'number:1', 'plain: ', 'comment:# note'])
    expect(kinds('# top comment')).toEqual(['comment:# top comment'])
  })

  test('words inside a value and URLs are not marked as bools or numbers', () => {
    expect(kinds('  image: nginx:1.27')).toEqual(['plain:  ', 'key:image', 'plain:: nginx:1.27'])
    expect(kinds('  url: http://host:80/online')).toEqual(['plain:  ', 'key:url', 'plain:: http://host:80/online'])
  })

  test('joined tokens give the line back exactly', () => {
    for (const line of ['services:', '  - "x: y" # c', '    environment:', '', '  key: a\tb']) {
      expect(
        highlightYamlLine(line)
          .map((token) => token.text)
          .join(''),
      ).toBe(line)
    }
  })
})

describe('highlightYaml', () => {
  test('one entry per line', () => {
    const lines = highlightYaml('a: 1\nb: 2\n')
    expect(lines.length).toBe(3)
    expect(lines[2]).toEqual([])
  })
})
