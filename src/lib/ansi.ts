/**
 * Splits log text into styled pieces. It reads the SGR codes (colors, bold, dim and reset) and
 * drops every other escape sequence (cursor moves, titles, and so on). Background colors and
 * other styles are dropped too: a log line only keeps its text color and weight.
 */

export interface AnsiSegment {
  text: string
  /** 0 to 7 for the standard colors, 8 to 15 for the bright ones, null for the default color */
  fg: number | null
  bold: boolean
  dim: boolean
}

interface Style {
  fg: number | null
  bold: boolean
  dim: boolean
}

const DEFAULT_STYLE: Style = { fg: null, bold: false, dim: false }
const ESC = String.fromCharCode(0x1b)
const BEL = String.fromCharCode(0x07)

/** Applies the codes of one SGR sequence (the parameters between ESC [ and m). */
function applySgr(params: string, style: Style): Style {
  const codes = params === '' ? [0] : params.split(';').map((part) => (part === '' ? 0 : Number(part)))
  let next = { ...style }
  for (let i = 0; i < codes.length; i++) {
    const code = codes[i] ?? Number.NaN
    if (code === 0) next = { ...DEFAULT_STYLE }
    else if (code === 1) next.bold = true
    else if (code === 2) next.dim = true
    else if (code === 22) {
      next.bold = false
      next.dim = false
    } else if (code >= 30 && code <= 37) next.fg = code - 30
    else if (code >= 90 && code <= 97) next.fg = code - 90 + 8
    else if (code === 39) next.fg = null
    else if (code === 38 || code === 48) {
      // extended colors (38;5;n and 38;2;r;g;b) are not shown, so their numbers are skipped
      const mode = codes[i + 1]
      if (mode === 5) i += 2
      else if (mode === 2) i += 4
    }
  }
  return next
}

function sameStyle(a: Style, b: Style): boolean {
  return a.fg === b.fg && a.bold === b.bold && a.dim === b.dim
}

/**
 * The end of the escape sequence that starts at `start` (the ESC character), and its final
 * character. A CSI ends at its final byte (0x40 to 0x7e), an OSC at BEL or ESC \, and a two-byte
 * escape after its second byte. A bare ESC at the end of the text is just skipped.
 */
function escapeEnd(text: string, start: number): { end: number; kind: string; params: string } {
  const next = text.charAt(start + 1)
  if (next === '[') {
    let index = start + 2
    while (index < text.length && text.charCodeAt(index) >= 0x30 && text.charCodeAt(index) <= 0x3f) index++
    const params = text.slice(start + 2, index)
    while (index < text.length && text.charCodeAt(index) >= 0x20 && text.charCodeAt(index) <= 0x2f) index++
    if (index >= text.length) return { end: text.length, kind: '', params }
    return { end: index + 1, kind: text.charAt(index), params }
  }
  if (next === ']') {
    const bel = text.indexOf(BEL, start + 2)
    const stop = text.indexOf(`${ESC}\\`, start + 2)
    if (bel === -1 && stop === -1) return { end: text.length, kind: '', params: '' }
    if (bel !== -1 && (stop === -1 || bel < stop)) return { end: bel + 1, kind: '', params: '' }
    return { end: stop + 2, kind: '', params: '' }
  }
  if (next === '') return { end: start + 1, kind: '', params: '' }
  return { end: start + 2, kind: '', params: '' }
}

export function ansiToSegments(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let style: Style = DEFAULT_STYLE

  const pushText = (text: string) => {
    if (text === '') return
    const previous = segments[segments.length - 1]
    if (previous && sameStyle(previous, style)) previous.text += text
    else segments.push({ text, ...style })
  }

  let last = 0
  let start = input.indexOf(ESC)
  while (start !== -1) {
    pushText(input.slice(last, start))
    const escape = escapeEnd(input, start)
    // only a CSI that ends with "m" changes the style
    if (escape.kind === 'm') style = applySgr(escape.params, style)
    last = escape.end
    start = input.indexOf(ESC, last)
  }
  pushText(input.slice(last))
  return segments
}
