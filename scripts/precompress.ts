/**
 * Writes .br and .gz copies next to the compressible files in dist/client, so server.ts can
 * serve them without compressing on every request. A copy is kept only when it is smaller than
 * the original. Run by `bun run build` right after vite build.
 */
import { readdir, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { constants, brotliCompressSync } from 'node:zlib'
import { shouldPrecompress } from '../src/lib/compression'

const clientDir = fileURLToPath(new URL('../dist/client', import.meta.url))

async function* walk(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) yield* walk(full)
    else if (entry.isFile()) yield full
  }
}

/** Writes the copy only when smaller than the original. Otherwise removes any stale copy. */
async function writeCopy(target: string, body: Uint8Array, originalSize: number): Promise<boolean> {
  if (body.length < originalSize) {
    await Bun.write(target, body)
    return true
  }
  await rm(target, { force: true })
  return false
}

try {
  await stat(clientDir)
} catch {
  throw new Error(`precompress: ${clientDir} not found. Run vite build first.`)
}

let candidates = 0
let copies = 0
for await (const file of walk(clientDir)) {
  const { size } = await stat(file)
  if (!shouldPrecompress(path.basename(file), size)) continue
  candidates++
  const body = await Bun.file(file).bytes()
  const br = brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } })
  const gz = Bun.gzipSync(body, { level: 9 })
  if (await writeCopy(`${file}.br`, br, size)) copies++
  if (await writeCopy(`${file}.gz`, gz, size)) copies++
}
console.log(`precompress: ${candidates} files, ${copies} compressed copies written`)
