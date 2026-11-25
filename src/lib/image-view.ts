import type { ImageSummary } from '@/lib/types'

// Pure helpers for the Images page: which images match the filter and the search, how they sort,
// and the counts on the filter tabs. No React here, so they are unit tested with plain fixtures.

export type ImageFilter = 'all' | 'in-use' | 'unused' | 'dangling' | 'updates'

const NO_UPDATES: ReadonlySet<string> = new Set()

/** The filter tabs of the Images page, in order. */
export const IMAGE_FILTERS: readonly ImageFilter[] = ['all', 'in-use', 'unused', 'dangling', 'updates']

/** True when the image is one that a container runs and that is behind (updateIds: the image IDs that are behind). */
export function imageHasUpdate(image: Pick<ImageSummary, 'id'>, updateIds: ReadonlySet<string>): boolean {
  return updateIds.has(image.id)
}

export function matchesImageFilter(
  image: Pick<ImageSummary, 'id' | 'containers' | 'dangling'>,
  filter: ImageFilter,
  updateIds: ReadonlySet<string> = NO_UPDATES,
): boolean {
  if (filter === 'in-use') return image.containers > 0
  if (filter === 'unused') return image.containers === 0
  if (filter === 'dangling') return image.dangling
  if (filter === 'updates') return imageHasUpdate(image, updateIds)
  return true
}

/** Case-insensitive match on the repository, the tags and the id (with or without "sha256:"). An empty query matches all. */
export function matchesImageSearch(image: ImageSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [image.repository, image.id, image.shortId, ...image.tags].some((value) =>
    value.toLowerCase().includes(needle),
  )
}

export function countImages(
  images: readonly ImageSummary[],
  updateIds: ReadonlySet<string> = NO_UPDATES,
): Record<ImageFilter, number> {
  return {
    all: images.length,
    'in-use': images.filter((image) => matchesImageFilter(image, 'in-use')).length,
    unused: images.filter((image) => matchesImageFilter(image, 'unused')).length,
    dangling: images.filter((image) => image.dangling).length,
    updates: images.filter((image) => matchesImageFilter(image, 'updates', updateIds)).length,
  }
}

/** Repository, then tag. Dangling images (no tag) go last, by id. */
export function sortImages(images: readonly ImageSummary[]): ImageSummary[] {
  return [...images].sort((a, b) => {
    if (a.dangling !== b.dangling) return a.dangling ? 1 : -1
    if (a.dangling) return a.id.localeCompare(b.id)
    return a.repository.localeCompare(b.repository) || a.tag.localeCompare(b.tag)
  })
}

export function totalSize(images: readonly Pick<ImageSummary, 'size'>[]): number {
  return images.reduce((sum, image) => sum + image.size, 0)
}

/** The name copied to the clipboard: "repo:tag", or null for a dangling image. */
export function imageName(image: Pick<ImageSummary, 'repository' | 'tag' | 'dangling'>): string | null {
  return image.dangling ? null : `${image.repository}:${image.tag}`
}
