import { createServerFn } from '@tanstack/react-start'
import type { UpdateState } from '@/lib/updates'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The checks live in src/server/updates.server.ts. The container update is a server route (api.containers.$id.update.ts).

/** The last check's results (kept on the server and in the data folder). Reads no registry. */
export const updateStatusFn = createServerFn({ method: 'GET' }).handler(async (): Promise<UpdateState> => {
  const { updateStatus } = await import('@/server/updates.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => updateStatus(), 'Could not read the update checks.')
})

/** Checks every image of the containers now. A check that is running is joined, not started again. */
export const checkUpdatesFn = createServerFn({ method: 'POST' }).handler(async (): Promise<UpdateState> => {
  const { checkUpdates } = await import('@/server/updates.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => checkUpdates(), 'Could not check for updates.')
})
