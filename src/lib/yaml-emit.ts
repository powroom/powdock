// A small YAML writer for the Compose files pow/dock creates. It handles what the converter needs:
// maps, lists, strings, numbers and booleans, with 2-space indents. Quotes are used only when a plain
// value could be read as something else (a number, a boolean, a value with a colon, and so on).

export type YamlNode = string | number | boolean | YamlNode[] | { [key: string]: YamlNode }

/** Words a YAML 1.1 reader may take as a boolean or null, so they are always quoted. */
const RESERVED = new Set(['true', 'false', 'yes', 'no', 'on', 'off', 'null', 'y', 'n', '~'])
/** A plain value: starts with a letter or underscore, and has only characters that need no quotes. */
const SAFE_PLAIN = /^[A-Za-z_][A-Za-z0-9_.=/-]*$/
/** A key that needs no quotes. */
const SAFE_KEY = /^[A-Za-z_][A-Za-z0-9_.-]*$/

function isMap(node: YamlNode): node is { [key: string]: YamlNode } {
  return typeof node === 'object' && node !== null && !Array.isArray(node)
}

/** A string as YAML: plain when that is safe, otherwise a JSON string (which is valid YAML too). */
export function yamlScalar(value: string): string {
  if (SAFE_PLAIN.test(value) && !RESERVED.has(value.toLowerCase())) return value
  return JSON.stringify(value)
}

function scalar(value: string | number | boolean): string {
  if (typeof value === 'string') return yamlScalar(value)
  return String(value)
}

function keyText(key: string): string {
  return SAFE_KEY.test(key) ? key : JSON.stringify(key)
}

function isEmpty(node: YamlNode): boolean {
  if (Array.isArray(node)) return node.length === 0
  if (isMap(node)) return Object.keys(node).length === 0
  return false
}

function mapLines(map: { [key: string]: YamlNode }, indent: number): string[] {
  const pad = ' '.repeat(indent)
  const lines: string[] = []
  for (const [key, value] of Object.entries(map)) {
    if (value === undefined) continue
    const head = `${pad}${keyText(key)}:`
    if (typeof value !== 'object' || value === null) {
      lines.push(`${head} ${scalar(value)}`)
    } else if (isEmpty(value)) {
      lines.push(`${head} ${Array.isArray(value) ? '[]' : '{}'}`)
    } else if (Array.isArray(value)) {
      lines.push(head, ...listLines(value, indent + 2))
    } else {
      lines.push(head, ...mapLines(value, indent + 2))
    }
  }
  return lines
}

function listLines(list: YamlNode[], indent: number): string[] {
  const pad = ' '.repeat(indent)
  const lines: string[] = []
  for (const item of list) {
    if (typeof item !== 'object' || item === null) {
      lines.push(`${pad}- ${scalar(item)}`)
    } else if (isEmpty(item)) {
      lines.push(`${pad}- ${Array.isArray(item) ? '[]' : '{}'}`)
    } else if (Array.isArray(item)) {
      lines.push(`${pad}-`, ...listLines(item, indent + 2))
    } else {
      // The first key shares the line with the dash: "- image: nginx", then the other keys follow.
      const body = mapLines(item, indent + 2)
      lines.push(`${pad}- ${body[0]!.slice(indent + 2)}`, ...body.slice(1))
    }
  }
  return lines
}

/**
 * The text of a YAML document whose top level is a map. `header` lines (without the "#") become
 * comments at the top. The output ends with a newline.
 */
export function emitYaml(doc: { [key: string]: YamlNode }, header: readonly string[] = []): string {
  const comments = header.map((line) => `# ${line}`)
  const body = mapLines(doc, 0)
  return [...comments, ...body].join('\n') + '\n'
}
