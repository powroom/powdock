/**
 * Serves dist/client from memory. server.ts reads every file once at startup, together with its
 * .br and .gz copies, and answers requests from that table. The table building, the encoding
 * choice, the ETag and the path rules are plain functions so they can be unit tested. Bun is used
 * only for hashing and reading files.
 */
import { readdir } from 'node:fs/promises'
import path from 'node:path'
import { acceptsEncoding, type Encoding } from './compression'

/** File suffix of the precompressed copy written by scripts/precompress.ts, per coding. */
const COPY_SUFFIX: Record<Encoding, string> = { br: '.br', gzip: '.gz' }

/** Preference order when the client accepts more than one coding. */
const CODINGS: readonly Encoding[] = ['br', 'gzip']

const IMMUTABLE_CACHE = 'public, max-age=31536000, immutable'
const REVALIDATE_CACHE = 'no-cache'

/** Fixed file names that browsers and crawlers ask for. Files that are missing get a fast 404. */
const FIXED_STATIC_PATHS: ReadonlySet<string> = new Set(['/favicon.ico', '/robots.txt'])

/** One stored form of a file: the bytes, the coding they are in (null for the original) and their ETag. */
export interface Representation {
  readonly body: Uint8Array<ArrayBuffer>
  readonly encoding: Encoding | null
  readonly etag: string
}

export interface StaticAsset {
  readonly contentType: string
  readonly cacheControl: string
  readonly identity: Representation
  readonly encoded: Partial<Record<Encoding, Representation>>
}

/** A file as read from disk. `path` is relative to dist/client, with forward slashes and no leading slash. */
export interface SourceFile {
  readonly path: string
  readonly bytes: Uint8Array<ArrayBuffer>
  readonly contentType: string
}

/** A strong ETag for one body. Bun.hash is a fast 64-bit hash, enough to tell two versions apart. */
export function etagFor(body: Uint8Array): string {
  return `"${Bun.hash(body).toString(16)}"`
}

function representation(body: Uint8Array<ArrayBuffer>, encoding: Encoding | null): Representation {
  return { body, encoding, etag: etagFor(body) }
}

/**
 * Builds the lookup table. A file named x.js.br or x.js.gz is a copy of x.js when x.js exists, so
 * copies are not keys of their own. Every other file is a key, with whatever copies it has.
 */
export function buildAssetTable(files: readonly SourceFile[]): Map<string, StaticAsset> {
  const byPath = new Map(files.map((file) => [file.path, file]))
  const isCopy = (filePath: string): boolean =>
    CODINGS.some((encoding) => {
      const suffix = COPY_SUFFIX[encoding]
      return filePath.endsWith(suffix) && byPath.has(filePath.slice(0, -suffix.length))
    })

  const table = new Map<string, StaticAsset>()
  for (const file of files) {
    if (isCopy(file.path)) continue
    const encoded: Partial<Record<Encoding, Representation>> = {}
    for (const encoding of CODINGS) {
      const copy = byPath.get(file.path + COPY_SUFFIX[encoding])
      if (copy) encoded[encoding] = representation(copy.bytes, encoding)
    }
    table.set(file.path, {
      contentType: file.contentType,
      cacheControl: file.path.startsWith('assets/') ? IMMUTABLE_CACHE : REVALIDATE_CACHE,
      identity: representation(file.bytes, null),
      encoded,
    })
  }
  return table
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

/** Reads every file under dir, copies included, and builds the table. A missing dir gives an empty table. */
export async function loadAssetTable(dir: string): Promise<Map<string, StaticAsset>> {
  const files: SourceFile[] = []
  try {
    for await (const full of walk(dir)) {
      const file = Bun.file(full)
      const relative = path.relative(dir, full).split(path.sep).join('/')
      files.push({ path: relative, bytes: await file.bytes(), contentType: file.type })
    }
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return new Map()
    throw err
  }
  return buildAssetTable(files)
}

/** The request path after percent-decoding, or null when the encoding is malformed. */
export function decodeRequestPath(pathname: string): string | null {
  try {
    return decodeURIComponent(pathname)
  } catch {
    return null
  }
}

/**
 * The table key for a decoded request path, or null when the path cannot name a file: backslashes,
 * NUL bytes, empty segments, and "." or ".." segments are refused. The lookup cannot leave dist/client
 * anyway, because only keys read from disk can match.
 */
export function assetKey(decoded: string): string | null {
  if (!decoded.startsWith('/')) return null
  const key = decoded.slice(1)
  if (key === '' || key.includes('\\') || key.includes('\0')) return null
  if (key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) return null
  return key
}

/** Paths that are clearly static. A miss on one of them gets a plain 404 instead of an SSR render. */
export function isStaticRequestPath(decoded: string): boolean {
  if (decoded.startsWith('/assets/')) return true
  if (FIXED_STATIC_PATHS.has(decoded)) return true
  if (/^\/apple-touch-icon[^/]*\.png$/.test(decoded)) return true
  return decoded.endsWith('.map')
}

/** Whether an If-None-Match header matches an ETag. GET uses weak comparison, so W/ prefixes are ignored. */
export function matchesIfNoneMatch(header: string | null, etag: string): boolean {
  if (header === null) return false
  if (header.trim() === '*') return true
  return header.split(',').some((candidate) => candidate.trim().replace(/^W\//, '') === etag)
}

/** The stored form to send: br, then gzip, when the client accepts it. Otherwise the original bytes. */
export function chooseRepresentation(asset: StaticAsset, acceptEncoding: string | null): Representation {
  for (const encoding of CODINGS) {
    const rep = asset.encoded[encoding]
    if (rep && acceptsEncoding(acceptEncoding, encoding)) return rep
  }
  return asset.identity
}

/**
 * The response for a GET or HEAD of a table entry. 304 when If-None-Match matches the chosen
 * representation, otherwise the body (no body for HEAD). Content-Length is always set.
 */
export function serveAsset(request: Request, asset: StaticAsset): Response {
  const rep = chooseRepresentation(asset, request.headers.get('accept-encoding'))
  const common: Record<string, string> = {
    ETag: rep.etag,
    'Cache-Control': asset.cacheControl,
    Vary: 'Accept-Encoding',
  }
  if (matchesIfNoneMatch(request.headers.get('if-none-match'), rep.etag)) {
    return new Response(null, { status: 304, headers: common })
  }
  const headers: Record<string, string> = {
    ...common,
    'Content-Type': asset.contentType,
    'Content-Length': String(rep.body.byteLength),
  }
  if (rep.encoding) headers['Content-Encoding'] = rep.encoding
  return new Response(request.method === 'HEAD' ? null : rep.body, { headers })
}

/** A plain 404 for a static path that is not in the table. */
export function notFoundResponse(): Response {
  return new Response('Not Found', {
    status: 404,
    headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Cache-Control': 'no-cache' },
  })
}
