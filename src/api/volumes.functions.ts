import { createServerFn } from '@tanstack/react-start'
import type { VolumeDetails, VolumeSummary } from '@/lib/types'
import { volumeValidators } from './validators'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The Docker calls live in src/server/volumes.server.ts.

export const listVolumesFn = createServerFn({ method: 'GET' }).handler(async (): Promise<VolumeSummary[]> => {
  const { listVolumes } = await import('@/server/volumes.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => listVolumes(), 'Could not list volumes.')
})

/** Sizes are slow on big hosts, so the page asks for them in their own query. */
export const volumeSizesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Record<string, number | null>> => {
    const { volumeSizes } = await import('@/server/volumes.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => volumeSizes(), 'Could not read the volume sizes.')
  },
)

export const inspectVolumeFn = createServerFn({ method: 'POST' })
  .validator(volumeValidators().nameInput)
  .handler(async ({ data }): Promise<VolumeDetails> => {
    const { inspectVolume } = await import('@/server/volumes.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => inspectVolume(data.name), 'Could not read the volume details.')
  })

export const createVolumeFn = createServerFn({ method: 'POST' })
  .validator(volumeValidators().createInput)
  .handler(async ({ data }): Promise<VolumeSummary> => {
    const { createVolume } = await import('@/server/volumes.server')
    const { withClientErrors } = await import('@/lib/redact')
    const volume = await withClientErrors(
      () => createVolume({ name: data.name, driver: 'local' }),
      'Could not create the volume.',
    )
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return volume
  })

export const removeVolumeFn = createServerFn({ method: 'POST' })
  .validator(volumeValidators().removeInput)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { removeVolume } = await import('@/server/volumes.server')
    const { withClientErrors } = await import('@/lib/redact')
    await withClientErrors(() => removeVolume(data.name, { force: data.force }), 'Could not remove the volume.')
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return { ok: true }
  })
