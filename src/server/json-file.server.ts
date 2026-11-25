import { mkdir, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Schema } from '@/lib/schema'

/**
 * Parses and validates a JSON file from the data directory. Errors name the file and the field
 * that is wrong. They never quote the file: a JSON syntax error message can echo a password,
 * so only a fixed text is used for those.
 */
export function parseDataFile<T>(raw: string, file: string, schema: Schema<T, unknown>): T {
  const label = path.basename(file)
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    throw new Error(`${label} is not valid: ${file}: the file is not valid JSON`)
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw new Error(`${label} is not valid: ${file}: ${parsed.error.message}`)
  return parsed.data
}

let writeChain: Promise<void> = Promise.resolve()

/**
 * Writes a JSON file in the data folder: a temp file, then a rename, so a crash never leaves a
 * half-written file. Mode 0600. Writes run one after another, and a failed write does not block
 * the ones after it.
 */
export function writeJsonFile(file: string, data: unknown): Promise<void> {
  const next = writeChain.then(async () => {
    await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
    const tmp = `${file}.${process.pid}.tmp`
    await writeFile(tmp, JSON.stringify(data, null, 2), { mode: 0o600 })
    await rename(tmp, file)
  })
  writeChain = next.catch(() => {})
  return next
}
