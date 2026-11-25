// A small YAML highlighter for the read-only Compose file view. It is not a parser: it marks comments,
// keys, quoted strings, numbers and booleans, line by line, and leaves everything else as plain text.

export type YamlKind = 'plain' | 'key' | 'string' | 'number' | 'bool' | 'comment'

export interface YamlToken {
  kind: YamlKind
  text: string
}

/** A key at the start of a line (after the indent and an optional "- "), quoted or not. */
const KEY_START = /^(\s*(?:-\s+)?)("[^"]*"|'[^']*'|[^\s#'"-][^:#]*?)(?=\s*:(?:\s|$))/
/** The parts of a value: quoted strings, comments, booleans and numbers. The first match at each place wins. */
const VALUE_PART =
  /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')|(#.*$)|(?<![\w.-])(true|false|yes|no|on|off|null)(?![\w.-])|(?<![\w.:/-])(-?\d+(?:\.\d+)?)(?![\w.-])/gi

/** Tokens of the value part of a line (everything after the key). */
function valueTokens(text: string): YamlToken[] {
  const tokens: YamlToken[] = []
  let last = 0
  for (const match of text.matchAll(VALUE_PART)) {
    const index = match.index ?? 0
    if (index > last) tokens.push({ kind: 'plain', text: text.slice(last, index) })
    const [whole, quoted, comment, bool, number] = match
    let kind: YamlKind = 'plain'
    if (quoted !== undefined) kind = 'string'
    else if (comment !== undefined) kind = 'comment'
    else if (bool !== undefined) kind = 'bool'
    else if (number !== undefined) kind = 'number'
    tokens.push({ kind, text: whole })
    last = index + whole.length
  }
  if (last < text.length) tokens.push({ kind: 'plain', text: text.slice(last) })
  return tokens
}

/** The tokens of one line. Joined in order, they give the line back exactly. */
export function highlightYamlLine(line: string): YamlToken[] {
  const trimmed = line.trimStart()
  if (trimmed.startsWith('#')) return [{ kind: 'comment', text: line }]
  const key = KEY_START.exec(line)
  if (!key) return valueTokens(line)
  const prefix = key[1] ?? ''
  const keyText = key[2] ?? ''
  const tokens: YamlToken[] = []
  if (prefix) tokens.push({ kind: 'plain', text: prefix })
  tokens.push({ kind: 'key', text: keyText })
  return [...tokens, ...valueTokens(line.slice(prefix.length + keyText.length))]
}

/** The tokens of every line of a file. */
export function highlightYaml(text: string): YamlToken[][] {
  return text.split('\n').map(highlightYamlLine)
}
