import { createServerFn } from '@tanstack/react-start'
import type { DiskUsageState, PruneResult } from '@/lib/types'
import { cleanupValidators } from './validators'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The Docker calls live in src/server/cleanup.server.ts. The prune functions take no labels from the client.

/** The disk usage, from the server's cache (kept for 60 seconds, then read again in the background). */
export const diskUsageFn = createServerFn({ method: 'GET' }).handler(async (): Promise<DiskUsageState> => {
  const { diskUsageState } = await import('@/server/disk-usage.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => diskUsageState(false), 'Could not read the disk usage.')
})

/** The Refresh button: reads Docker now, even when the cached answer is fresh. */
export const refreshDiskUsageFn = createServerFn({ method: 'POST' }).handler(async (): Promise<DiskUsageState> => {
  const { diskUsageState } = await import('@/server/disk-usage.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => diskUsageState(true), 'Could not read the disk usage.')
})

export const pruneContainersFn = createServerFn({ method: 'POST' })
  .validator(cleanupValidators().emptyInput)
  .handler(async (): Promise<PruneResult> => {
    const { pruneContainers } = await import('@/server/cleanup.server')
    const { withClientErrors } = await import('@/lib/redact')
    const result = await withClientErrors(() => pruneContainers(), 'Could not remove the stopped containers.')
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return result
  })

export const pruneImagesFn = createServerFn({ method: 'POST' })
  .validator(cleanupValidators().imagesInput)
  .handler(async ({ data }): Promise<PruneResult> => {
    const { pruneImages } = await import('@/server/cleanup.server')
    const { withClientErrors } = await import('@/lib/redact')
    const result = await withClientErrors(() => pruneImages({ all: data.all }), 'Could not remove the images.')
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return result
  })

export const pruneVolumesFn = createServerFn({ method: 'POST' })
  .validator(cleanupValidators().volumesInput)
  .handler(async ({ data }): Promise<PruneResult> => {
    const { pruneVolumes } = await import('@/server/cleanup.server')
    const { withClientErrors } = await import('@/lib/redact')
    const result = await withClientErrors(() => pruneVolumes({ named: data.named }), 'Could not remove the volumes.')
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return result
  })

export const pruneNetworksFn = createServerFn({ method: 'POST' })
  .validator(cleanupValidators().emptyInput)
  .handler(async (): Promise<PruneResult> => {
    const { pruneNetworks } = await import('@/server/cleanup.server')
    const { withClientErrors } = await import('@/lib/redact')
    const result = await withClientErrors(() => pruneNetworks(), 'Could not remove the networks.')
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return result
  })

export const pruneBuildCacheFn = createServerFn({ method: 'POST' })
  .validator(cleanupValidators().buildInput)
  .handler(async ({ data }): Promise<PruneResult> => {
    const { pruneBuildCache } = await import('@/server/cleanup.server')
    const { withClientErrors } = await import('@/lib/redact')
    const result = await withClientErrors(
      () => pruneBuildCache({ olderThanWeek: data.olderThanWeek }),
      'Could not clear the build cache.',
    )
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return result
  })
