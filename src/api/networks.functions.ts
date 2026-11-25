import { createServerFn } from '@tanstack/react-start'
import type { NetworkDetails, NetworkSummary } from '@/lib/types'
import { networkValidators } from './validators'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The Docker calls live in src/server/networks.server.ts.

export const listNetworksFn = createServerFn({ method: 'GET' }).handler(async (): Promise<NetworkSummary[]> => {
  const { listNetworks } = await import('@/server/networks.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => listNetworks(), 'Could not list networks.')
})

export const inspectNetworkFn = createServerFn({ method: 'POST' })
  .validator(networkValidators().inspectInput)
  .handler(async ({ data }): Promise<NetworkDetails> => {
    const { inspectNetwork } = await import('@/server/networks.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => inspectNetwork(data.id), 'Could not read the network details.')
  })

export const createNetworkFn = createServerFn({ method: 'POST' })
  .validator(networkValidators().createInput)
  .handler(async ({ data }): Promise<{ id: string }> => {
    const { createNetwork } = await import('@/server/networks.server')
    const { withClientErrors } = await import('@/lib/redact')
    const created = await withClientErrors(
      () =>
        createNetwork({
          name: data.name,
          driver: 'bridge',
          internal: data.internal,
          subnet: data.subnet,
          gateway: data.gateway,
        }),
      'Could not create the network.',
    )
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return created
  })

export const removeNetworkFn = createServerFn({ method: 'POST' })
  .validator(networkValidators().removeInput)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { removeNetwork } = await import('@/server/networks.server')
    const { withClientErrors } = await import('@/lib/redact')
    await withClientErrors(() => removeNetwork(data.id), 'Could not remove the network.')
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return { ok: true }
  })
