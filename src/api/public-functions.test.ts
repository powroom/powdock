import { describe, expect, test } from 'bun:test'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { PUBLIC_FUNCTIONS_FILE, PUBLIC_SERVER_FUNCTIONS, isPublicServerFn } from './public-functions'

const PROJECT_ROOT = path.resolve(import.meta.dir, '../..')

/** The names of the server functions exported from a file, as the source declares them. */
function exportedServerFns(relativePath: string): string[] {
  const source = readFileSync(path.join(PROJECT_ROOT, relativePath), 'utf8')
  return [...source.matchAll(/^export const (\w+) = createServerFn\b/gm)].map((m) => m[1]!).sort()
}

describe('public server functions', () => {
  test('the public file exports exactly the listed functions (a new one must be listed here)', () => {
    const listed = PUBLIC_SERVER_FUNCTIONS.map((fn) => fn.name).sort()
    expect(exportedServerFns(PUBLIC_FUNCTIONS_FILE)).toEqual(listed)
  })

  test('every listed function is in the public file', () => {
    for (const fn of PUBLIC_SERVER_FUNCTIONS) expect(fn.filename).toBe(PUBLIC_FUNCTIONS_FILE)
  })

  test('the public set is the sign-in state, sign-in and first-time setup, and nothing else', () => {
    expect(PUBLIC_SERVER_FUNCTIONS.map((fn) => fn.name).sort()).toEqual(['authStateFn', 'completeSetupFn', 'signInFn'])
  })

  test('no other server function file exports a function with a public name', () => {
    const publicNames = new Set(PUBLIC_SERVER_FUNCTIONS.map((fn) => fn.name))
    const files = readdirSync(path.join(PROJECT_ROOT, 'src/api'))
      .filter((file) => file.endsWith('.functions.ts'))
      .map((file) => `src/api/${file}`)
      .filter((file) => file !== PUBLIC_FUNCTIONS_FILE)
    // a scan that found no files would pass every check below, so the known ones must be there
    expect(files).toContain('src/api/account.functions.ts')
    for (const file of files) {
      const names = exportedServerFns(file)
      expect(names.filter((name) => publicNames.has(name))).toEqual([])
    }
  })

  test('isPublicServerFn matches only the listed name in the listed file', () => {
    expect(isPublicServerFn({ name: 'signInFn', filename: PUBLIC_FUNCTIONS_FILE })).toBe(true)
    expect(isPublicServerFn({ name: 'signInFn', filename: 'src/api/account.functions.ts' })).toBe(false)
    expect(isPublicServerFn({ name: 'signOutFn', filename: PUBLIC_FUNCTIONS_FILE })).toBe(false)
  })

  test('a missing identity is private', () => {
    expect(isPublicServerFn(undefined)).toBe(false)
    expect(isPublicServerFn({})).toBe(false)
    expect(isPublicServerFn({ name: 'authStateFn' })).toBe(false)
  })
})
