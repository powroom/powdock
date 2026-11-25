import { afterAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import {
  assetKey,
  buildAssetTable,
  chooseRepresentation,
  decodeRequestPath,
  etagFor,
  isStaticRequestPath,
  loadAssetTable,
  matchesIfNoneMatch,
  notFoundResponse,
  serveAsset,
  type SourceFile,
  type StaticAsset,
} from './static-assets'

const enc = (text: string) => new TextEncoder().encode(text)
const js = (filePath: string, text: string): SourceFile => ({
  path: filePath,
  bytes: enc(text),
  contentType: 'text/javascript;charset=utf-8',
})

/** The key a request path maps to, or null, the way server.ts resolves it. */
function keyOf(pathname: string): string | null {
  const decoded = decodeRequestPath(pathname)
  return decoded === null ? null : assetKey(decoded)
}

function oneAsset(): StaticAsset {
  const table = buildAssetTable([
    js('assets/app.js', 'plain text'),
    js('assets/app.js.br', 'brotli bytes'),
    js('assets/app.js.gz', 'gzip bytes'),
  ])
  const asset = table.get('assets/app.js')
  if (!asset) throw new Error('asset missing from the table')
  return asset
}

describe('decodeRequestPath and assetKey', () => {
  test('a plain path becomes a key without the leading slash', () => {
    expect(keyOf('/assets/index-1.js')).toBe('assets/index-1.js')
    expect(keyOf('/favicon.ico')).toBe('favicon.ico')
  })

  test('percent-encoding is decoded before the key is built', () => {
    expect(keyOf('/assets/%69ndex-1.js')).toBe('assets/index-1.js')
  })

  test('malformed percent-encoding does not decode', () => {
    expect(decodeRequestPath('/assets/%E0%A4%A')).toBeNull()
    expect(keyOf('/assets/%E0%A4%A')).toBeNull()
  })

  test('traversal and odd separators never produce a key, in any spelling', () => {
    const attempts = [
      '/',
      '/../server.ts',
      '/assets/../../server.ts',
      '/assets/%2e%2e/server.ts',
      '/assets/%2E%2E%2Fserver.ts',
      '/..%2fserver.ts',
      '/..%5cserver.ts',
      '/assets//index.js',
      '/assets/./index.js',
      '/assets\\..\\server.ts',
      '/assets/%5C..%5Cserver.ts',
      '/assets/a%00b.js',
    ]
    for (const attempt of attempts) expect(keyOf(attempt)).toBeNull()
  })
})

describe('isStaticRequestPath', () => {
  test('assets, favicon, robots, apple touch icons and source maps are static', () => {
    for (const p of [
      '/assets/missing.js',
      '/assets/',
      '/favicon.ico',
      '/robots.txt',
      '/apple-touch-icon.png',
      '/apple-touch-icon-180x180.png',
      '/assets/index.js.map',
      '/some/app.js.map',
    ]) {
      expect(isStaticRequestPath(p)).toBe(true)
    }
  })

  test('app routes and look-alike names are not static', () => {
    for (const p of ['/', '/login', '/api/health', '/favicon.icon', '/robots.txt.bak', '/apple-touch-icon.jpg']) {
      expect(isStaticRequestPath(p)).toBe(false)
    }
  })
})

describe('matchesIfNoneMatch', () => {
  const etag = '"abc123"'

  test('no header or a different tag does not match', () => {
    expect(matchesIfNoneMatch(null, etag)).toBe(false)
    expect(matchesIfNoneMatch('"other"', etag)).toBe(false)
  })

  test('the same tag matches, also inside a list and with a weak prefix', () => {
    expect(matchesIfNoneMatch(etag, etag)).toBe(true)
    expect(matchesIfNoneMatch('"x", "abc123"', etag)).toBe(true)
    expect(matchesIfNoneMatch('W/"abc123"', etag)).toBe(true)
  })

  test('* matches any current representation', () => {
    expect(matchesIfNoneMatch('*', etag)).toBe(true)
  })
})

describe('buildAssetTable', () => {
  test('copies are paired with their original and are not keys of their own', () => {
    const table = buildAssetTable([
      js('assets/a.js', 'aaa'),
      js('assets/a.js.br', 'bbb'),
      js('assets/a.js.gz', 'ccc'),
      { path: 'assets/b.css', bytes: enc('body{}'), contentType: 'text/css' },
    ])
    expect([...table.keys()].sort()).toEqual(['assets/a.js', 'assets/b.css'])
    expect(new TextDecoder().decode(table.get('assets/a.js')?.encoded.br?.body)).toBe('bbb')
    expect(new TextDecoder().decode(table.get('assets/a.js')?.encoded.gzip?.body)).toBe('ccc')
    expect(table.get('assets/b.css')?.encoded.br).toBeUndefined()
  })

  test('a .gz file with no original next to it is a file of its own', () => {
    const table = buildAssetTable([js('assets/lonely.js.gz', 'zzz')])
    expect([...table.keys()]).toEqual(['assets/lonely.js.gz'])
  })

  test('files under assets are immutable, everything else revalidates', () => {
    const table = buildAssetTable([js('assets/a.js', 'a'), js('favicon.ico', 'i')])
    expect(table.get('assets/a.js')?.cacheControl).toBe('public, max-age=31536000, immutable')
    expect(table.get('favicon.ico')?.cacheControl).toBe('no-cache')
  })

  test('each stored form gets its own ETag, and it is a strong one', () => {
    const asset = oneAsset()
    expect(asset.identity.etag).toMatch(/^"[0-9a-f]+"$/)
    expect(asset.encoded.br?.etag).not.toBe(asset.identity.etag)
    expect(asset.encoded.gzip?.etag).not.toBe(asset.encoded.br?.etag)
    expect(etagFor(enc('same'))).toBe(etagFor(enc('same')))
  })
})

describe('chooseRepresentation', () => {
  test('br is preferred, then gzip, then the original', () => {
    const asset = oneAsset()
    expect(chooseRepresentation(asset, 'gzip, br').encoding).toBe('br')
    expect(chooseRepresentation(asset, 'gzip').encoding).toBe('gzip')
    expect(chooseRepresentation(asset, 'deflate').encoding).toBeNull()
    expect(chooseRepresentation(asset, null).encoding).toBeNull()
  })

  test('q=0 refuses a coding, so gzip is used instead of br', () => {
    expect(chooseRepresentation(oneAsset(), 'br;q=0, gzip').encoding).toBe('gzip')
  })
})

describe('serveAsset', () => {
  const url = 'http://localhost/assets/app.js'

  test('a brotli-capable client gets the br copy with its headers', async () => {
    const asset = oneAsset()
    const res = serveAsset(new Request(url, { headers: { 'accept-encoding': 'gzip, br' } }), asset)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(res.headers.get('content-type')).toBe('text/javascript;charset=utf-8')
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(res.headers.get('content-length')).toBe(String('brotli bytes'.length))
    expect(res.headers.get('etag')).toBe(asset.encoded.br?.etag ?? null)
    expect(await res.text()).toBe('brotli bytes')
  })

  test('without a usable coding the original bytes go out with no Content-Encoding', async () => {
    const res = serveAsset(new Request(url), oneAsset())
    expect(res.status).toBe(200)
    expect(res.headers.has('content-encoding')).toBe(false)
    expect(await res.text()).toBe('plain text')
  })

  test('If-None-Match with the ETag of the representation being sent gives 304 with no body', async () => {
    const asset = oneAsset()
    const etag = asset.encoded.br?.etag ?? ''
    const res = serveAsset(new Request(url, { headers: { 'accept-encoding': 'br', 'if-none-match': etag } }), asset)
    expect(res.status).toBe(304)
    expect(res.headers.get('etag')).toBe(etag)
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
    expect(await res.text()).toBe('')
  })

  test('the ETag of a different stored form does not give 304', () => {
    const asset = oneAsset()
    const res = serveAsset(
      new Request(url, { headers: { 'accept-encoding': 'br', 'if-none-match': asset.identity.etag } }),
      asset,
    )
    expect(res.status).toBe(200)
  })

  test('HEAD sends the same headers, including Content-Length, and no body', async () => {
    const res = serveAsset(new Request(url, { method: 'HEAD', headers: { 'accept-encoding': 'br' } }), oneAsset())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String('brotli bytes'.length))
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(await res.text()).toBe('')
  })

  test('the same table entry can be served again, and the bytes stay intact', async () => {
    const asset = oneAsset()
    const first = await serveAsset(new Request(url), asset).text()
    const second = await serveAsset(new Request(url), asset).text()
    expect(first).toBe('plain text')
    expect(second).toBe('plain text')
  })
})

describe('notFoundResponse', () => {
  test('is a plain 404 that is not cached', async () => {
    const res = notFoundResponse()
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-cache')
    expect(await res.text()).toBe('Not Found')
  })
})

describe('loadAssetTable', () => {
  let dir = ''
  const ready = (async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'powdock-assets-'))
    await mkdir(path.join(dir, 'assets'), { recursive: true })
    await writeFile(path.join(dir, 'assets', 'app.js'), 'console.log(1)')
    await writeFile(path.join(dir, 'assets', 'app.js.br'), 'br-copy')
    await writeFile(path.join(dir, 'assets', 'app.js.gz'), 'gz-copy')
    await writeFile(path.join(dir, 'favicon.ico'), 'icon')
  })()

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true })
  })

  test('reads the tree, pairs copies, and keeps content types and cache rules', async () => {
    await ready
    const table = await loadAssetTable(dir)
    expect([...table.keys()].sort()).toEqual(['assets/app.js', 'favicon.ico'])
    const app = table.get('assets/app.js')
    expect(app?.contentType).toMatch(/^text\/javascript/)
    expect(new TextDecoder().decode(app?.encoded.br?.body)).toBe('br-copy')
    expect(new TextDecoder().decode(app?.encoded.gzip?.body)).toBe('gz-copy')
    expect(app?.cacheControl).toBe('public, max-age=31536000, immutable')
    expect(table.get('favicon.ico')?.cacheControl).toBe('no-cache')
  })

  test('a missing directory gives an empty table', async () => {
    expect((await loadAssetTable(path.join(tmpdir(), 'powdock-no-such-dir-xyz'))).size).toBe(0)
  })
})
