import { expect, test } from 'bun:test'

// The Docker image and the npm package bundle server.ts on its own with `bun build`, outside Vite.
// Anything it imports must not reach TanStack Start's virtual modules, or that build breaks.
test('server.ts bundles on its own', async () => {
  const result = await Bun.build({ entrypoints: ['server.ts'], target: 'bun' })
  const messages = result.logs.map((log) => log.message)
  expect(messages).toEqual([])
  expect(result.success).toBe(true)
}, 30_000)
