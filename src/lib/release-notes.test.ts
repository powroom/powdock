import { describe, expect, test } from 'bun:test'
import { parseInline, parseReleaseNotes } from './release-notes'

describe('parseReleaseNotes', () => {
  test('reads GitHub generated notes into a heading, a list, and a paragraph', () => {
    const notes = [
      "## What's Changed",
      '* Faster table navigation by @user in https://github.com/powroom/powdock/pull/3',
      '',
      '**Full Changelog**: https://github.com/powroom/powdock/compare/v0.1.0...v0.1.1',
    ].join('\n')

    expect(parseReleaseNotes(notes)).toEqual([
      { type: 'heading', text: [{ type: 'text', text: "What's Changed" }] },
      {
        type: 'list',
        items: [
          [
            { type: 'text', text: 'Faster table navigation by @user in ' },
            {
              type: 'link',
              href: 'https://github.com/powroom/powdock/pull/3',
              text: 'https://github.com/powroom/powdock/pull/3',
            },
          ],
        ],
      },
      {
        type: 'paragraph',
        text: [
          { type: 'bold', children: [{ type: 'text', text: 'Full Changelog' }] },
          { type: 'text', text: ': ' },
          {
            type: 'link',
            href: 'https://github.com/powroom/powdock/compare/v0.1.0...v0.1.1',
            text: 'https://github.com/powroom/powdock/compare/v0.1.0...v0.1.1',
          },
        ],
      },
    ])
  })

  test('keeps indented bullets as list items and parses formatting inside bold', () => {
    const notes = ['* Outer item with **bold `code`**', '  - indented child', '', '### Title'].join('\n')

    expect(parseReleaseNotes(notes)).toEqual([
      {
        type: 'list',
        items: [
          [
            { type: 'text', text: 'Outer item with ' },
            {
              type: 'bold',
              children: [
                { type: 'text', text: 'bold ' },
                { type: 'code', text: 'code' },
              ],
            },
          ],
          [{ type: 'text', text: 'indented child' }],
        ],
      },
      { type: 'heading', text: [{ type: 'text', text: 'Title' }] },
    ])
  })

  test('joins consecutive paragraph lines and separates blocks at blank lines', () => {
    expect(parseReleaseNotes('line one\nline two\n\nnext')).toEqual([
      { type: 'paragraph', text: [{ type: 'text', text: 'line one line two' }] },
      { type: 'paragraph', text: [{ type: 'text', text: 'next' }] },
    ])
  })

  test('limits headings to one to six hashes', () => {
    expect(parseReleaseNotes('# A\n###### B\n####### C')).toEqual([
      { type: 'heading', text: [{ type: 'text', text: 'A' }] },
      { type: 'heading', text: [{ type: 'text', text: 'B' }] },
      { type: 'paragraph', text: [{ type: 'text', text: '####### C' }] },
    ])
  })

  test('keeps http and javascript links as plain text', () => {
    const notes = '[a](http://example.com) [b](javascript:alert(1)) http://plain.example.com'

    expect(parseReleaseNotes(notes)).toEqual([{ type: 'paragraph', text: [{ type: 'text', text: notes }] }])
  })

  test('leaves an unclosed bold marker as plain text', () => {
    expect(parseReleaseNotes('Use **bold without an end')).toEqual([
      { type: 'paragraph', text: [{ type: 'text', text: 'Use **bold without an end' }] },
    ])
  })

  test('returns no blocks for empty or blank input', () => {
    expect(parseReleaseNotes('')).toEqual([])
    expect(parseReleaseNotes('  \n\n  ')).toEqual([])
  })
})

describe('parseInline', () => {
  test('turns markdown links and bare https URLs into links', () => {
    expect(parseInline('See [the docs](https://example.com/docs) or https://example.com/a.')).toEqual([
      { type: 'text', text: 'See ' },
      { type: 'link', href: 'https://example.com/docs', text: 'the docs' },
      { type: 'text', text: ' or ' },
      { type: 'link', href: 'https://example.com/a', text: 'https://example.com/a' },
      { type: 'text', text: '.' },
    ])
  })

  test('leaves an unclosed code marker as plain text', () => {
    expect(parseInline('Unclosed `code')).toEqual([{ type: 'text', text: 'Unclosed `code' }])
  })
})
