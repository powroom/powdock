/**
 * Pure decisions for response compression in server.ts. No Bun or Node APIs here, so the
 * rules can be unit tested on their own.
 */

export type Encoding = 'gzip' | 'br'

/** File extensions (without the dot) that get .br and .gz copies at build time. */
const PRECOMPRESS_EXTENSIONS: ReadonlySet<string> = new Set([
  'js',
  'css',
  'html',
  'svg',
  'json',
  'txt',
  'map',
  'xml',
  'webmanifest',
])

/** Smaller files are not worth precompressing. */
export const PRECOMPRESS_MIN_BYTES = 1024

/** Whether a file in dist/client gets precompressed copies. */
export function shouldPrecompress(fileName: string, size: number): boolean {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return false
  const ext = fileName.slice(dot + 1).toLowerCase()
  return PRECOMPRESS_EXTENSIONS.has(ext) && size > PRECOMPRESS_MIN_BYTES
}

const QUALITY = /^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/

/** The q value of one Accept-Encoding entry's parameters. Missing means 1, invalid means 0. */
function qualityOf(params: string[]): number {
  for (const param of params) {
    const eq = param.indexOf('=')
    if (eq < 0) continue
    if (param.slice(0, eq).trim().toLowerCase() !== 'q') continue
    const value = param.slice(eq + 1).trim()
    return QUALITY.test(value) ? Number.parseFloat(value) : 0
  }
  return 1
}

const NAMES: Record<Encoding, readonly string[]> = {
  gzip: ['gzip', 'x-gzip'],
  br: ['br'],
}

/**
 * Whether an Accept-Encoding header allows the given coding. An entry for the coding itself
 * wins over `*`. A q value of 0 refuses the coding. Names are case-insensitive.
 */
export function acceptsEncoding(header: string | null | undefined, encoding: Encoding): boolean {
  if (!header) return false
  let named: number | undefined
  let wildcard: number | undefined
  for (const entry of header.split(',')) {
    const [rawName = '', ...params] = entry.split(';')
    const name = rawName.trim().toLowerCase()
    if (NAMES[encoding].includes(name)) {
      named ??= qualityOf(params)
    } else if (name === '*') {
      wildcard ??= qualityOf(params)
    }
  }
  return (named ?? wildcard ?? 0) > 0
}

/** Media types whose text is worth gzipping, beyond every text/* type. */
const COMPRESSIBLE_TYPES: ReadonlySet<string> = new Set([
  'application/javascript',
  'application/json',
  'application/ndjson',
  'application/x-ndjson',
  'application/xml',
  // TanStack server functions reply with this framed type, whose payloads are JSON text
  'application/x-tss-framed',
  'image/svg+xml',
])

/**
 * Whether a response with this Content-Type may be gzipped on the fly. Text, JSON, SVG and
 * the other text types the app returns qualify. Binary types, archives, images other than
 * SVG, fonts and event streams do not.
 */
export function shouldCompress(contentType: string | null | undefined): boolean {
  if (!contentType) return false
  const mime = (contentType.split(';', 1)[0] ?? '').trim().toLowerCase()
  if (!mime || mime === 'text/event-stream') return false
  if (mime.startsWith('text/')) return true
  return COMPRESSIBLE_TYPES.has(mime) || mime.endsWith('+json')
}

/**
 * False when the response says "no-transform": it must reach the browser as it is, so gzip does not hold
 * it back. Live streams (the container logs) use it.
 */
export function mayCompress(cacheControl: string | null | undefined): boolean {
  return !(cacheControl ?? '').split(',').some((directive) => directive.trim().toLowerCase() === 'no-transform')
}

/** Bodies below this many bytes are sent as they are: gzip would not pay for its own framing. */
export const COMPRESS_MIN_BYTES = 1024

/** Whether a Content-Length header says the body is under COMPRESS_MIN_BYTES. An absent or invalid header is not small. */
export function isSmallBody(contentLength: string | null | undefined): boolean {
  if (contentLength === null || contentLength === undefined) return false
  const text = contentLength.trim()
  return /^\d+$/.test(text) && Number(text) < COMPRESS_MIN_BYTES
}
