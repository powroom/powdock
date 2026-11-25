import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join, relative } from 'node:path'

// Assembled at runtime so this file does not contain the needles itself.
const needles = [
  ['eslint', 'disable'].join('-'),
  ['oxlint', 'disable'].join('-'),
  ['@ts', 'ignore'].join('-'),
  ['@ts', 'expect', 'error'].join('-'),
  ['@ts', 'nocheck'].join('-'),
  ['biome', 'ignore'].join('-'),
]

const root = join(import.meta.dir, '..')
const glob = new Bun.Glob('**/*.{ts,tsx}')
const files = [
  ...['src', 'scripts'].flatMap((dir) => Array.from(glob.scanSync({ cwd: join(root, dir), absolute: true }))),
  join(root, 'server.ts'),
]

test('no suppression comments in app code', () => {
  const hits: string[] = []
  for (const file of files) {
    const rel = relative(root, file)
    if (rel === 'src/routeTree.gen.ts' || rel.split('/').includes('node_modules')) continue
    readFileSync(file, 'utf8')
      .split('\n')
      .forEach((line, index) => {
        for (const needle of needles) {
          if (line.includes(needle)) hits.push(`${rel}:${index + 1} contains ${needle}`)
        }
      })
  }
  expect(hits).toEqual([])
})
