/** Inline pieces of a release note line. Everything is data: the UI renders it as React text, never as HTML. */
export type Inline =
  | { type: 'text'; text: string }
  | { type: 'bold'; children: Inline[] }
  | { type: 'code'; text: string }
  | { type: 'link'; href: string; text: string }

export type Block =
  { type: 'heading'; text: Inline[] } | { type: 'list'; items: Inline[][] } | { type: 'paragraph'; text: Inline[] }

const HEADING_RE = /^#{1,6}\s+(.+)$/
const ITEM_RE = /^[*-]\s+(.+)$/
const LINK_RE = /^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/
// A bare URL ends before trailing sentence punctuation, and it needs at least one character after https://.
const BARE_URL_RE = /^https:\/\/[^\s<]*[^\s<.,;:!?)]/

/** Splits a line into text, **bold**, `code`, [text](https://...) links and bare https:// URLs. */
export function parseInline(source: string): Inline[] {
  const nodes: Inline[] = []
  let plain = ''
  let i = 0

  const pushText = (text: string) => {
    if (text !== '') nodes.push({ type: 'text', text })
  }

  while (i < source.length) {
    const rest = source.slice(i)

    if (rest.startsWith('**')) {
      const end = source.indexOf('**', i + 2)
      if (end > i + 2) {
        pushText(plain)
        plain = ''
        nodes.push({ type: 'bold', children: parseInline(source.slice(i + 2, end)) })
        i = end + 2
        continue
      }
    }

    if (rest.startsWith('`')) {
      const end = source.indexOf('`', i + 1)
      if (end > i + 1) {
        pushText(plain)
        plain = ''
        nodes.push({ type: 'code', text: source.slice(i + 1, end) })
        i = end + 1
        continue
      }
    }

    const link = LINK_RE.exec(rest)
    if (link) {
      pushText(plain)
      plain = ''
      nodes.push({ type: 'link', href: link[2], text: link[1] })
      i += link[0].length
      continue
    }

    const bare = BARE_URL_RE.exec(rest)
    if (bare) {
      pushText(plain)
      plain = ''
      nodes.push({ type: 'link', href: bare[0], text: bare[0] })
      i += bare[0].length
      continue
    }

    plain += source[i]
    i += 1
  }

  pushText(plain)
  return nodes
}

/**
 * Reads GitHub-style release notes into blocks: headings (# to ######), bullet lists (* or -),
 * and paragraphs. Consecutive paragraph lines join with a space; a blank line ends a block.
 */
export function parseReleaseNotes(markdown: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let items: Inline[][] = []

  const endParagraph = () => {
    if (paragraph.length > 0) blocks.push({ type: 'paragraph', text: parseInline(paragraph.join(' ')) })
    paragraph = []
  }
  const endList = () => {
    if (items.length > 0) blocks.push({ type: 'list', items })
    items = []
  }

  for (const raw of markdown.split(/\r?\n/)) {
    const line = raw.trim()
    const heading = HEADING_RE.exec(line)
    const item = ITEM_RE.exec(line)

    if (heading) {
      endParagraph()
      endList()
      blocks.push({ type: 'heading', text: parseInline(heading[1]) })
    } else if (item) {
      endParagraph()
      items.push(parseInline(item[1]))
    } else if (line === '') {
      endParagraph()
      endList()
    } else {
      endList()
      paragraph.push(line)
    }
  }

  endParagraph()
  endList()
  return blocks
}
