import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { IconKey } from '@/lib/image-icon'
import { uniqueSortedIds } from '@/lib/image-stack'
import { imageStacksQuery } from '@/lib/queries'

const NO_STACKS: Readonly<Record<string, IconKey | null>> = {}

/**
 * The icon of each of the given images, by image id, from one query for all of them. While the query
 * loads, the stacks already known are kept (keepPreviousData), so a new container does not turn the logos
 * back into letter tiles. `enabled` is false when the list is not on screen (the command palette when closed).
 */
export function useImageStacks(imageIds: readonly string[], enabled = true): Readonly<Record<string, IconKey | null>> {
  const ids = uniqueSortedIds(imageIds)
  const query = useQuery({
    ...imageStacksQuery(ids),
    enabled: enabled && ids.length > 0,
    placeholderData: keepPreviousData,
  })
  return query.data ?? NO_STACKS
}
