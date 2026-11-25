import { createServerFn } from '@tanstack/react-start'
import type { IconKey } from '@/lib/image-icon'
import type { ImageDetails, ImageRemoval, ImageSummary } from '@/lib/types'
import { imageValidators } from './validators'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The Docker calls live in src/server/images.server.ts. Pulling is a server route (api.images.pull.ts).

export const listImagesFn = createServerFn({ method: 'GET' }).handler(async (): Promise<ImageSummary[]> => {
  const { listImages } = await import('@/server/images.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => listImages(), 'Could not list images.')
})

export const inspectImageFn = createServerFn({ method: 'POST' })
  .validator(imageValidators().inspectInput)
  .handler(async ({ data }): Promise<ImageDetails> => {
    const { inspectImage } = await import('@/server/images.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => inspectImage(data.id), 'Could not read the image details.')
  })

export const removeImageFn = createServerFn({ method: 'POST' })
  .validator(imageValidators().removeInput)
  .handler(async ({ data }): Promise<ImageRemoval> => {
    const { removeImage } = await import('@/server/images.server')
    const { withClientErrors } = await import('@/lib/redact')
    const removal = await withClientErrors(
      () => removeImage(data.ref, { force: data.force }),
      'Could not remove the image.',
    )
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return removal
  })

/** The icon of each given image, by image id (null when its config does not name a stack). Cached on the server. */
export const imageStacksFn = createServerFn({ method: 'POST' })
  .validator(imageValidators().stacksInput)
  .handler(async ({ data }): Promise<Record<string, IconKey | null>> => {
    const { imageStacks } = await import('@/server/images.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => imageStacks(data.ids), 'Could not read the image icons.')
  })
