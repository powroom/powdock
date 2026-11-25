import { createFileRoute } from '@tanstack/react-router'
import { ImagesPage } from '@/components/images/images-page'
import { IMAGE_FILTERS, type ImageFilter } from '@/lib/image-view'

// ?filter=updates opens the Images page on the Updates tab (the dashboard links there).
export const Route = createFileRoute('/_app/images/')({
  validateSearch: (search: Record<string, unknown>): { filter?: ImageFilter } => {
    const value = search.filter
    return typeof value === 'string' && (IMAGE_FILTERS as readonly string[]).includes(value)
      ? { filter: value as ImageFilter }
      : {}
  },
  head: () => ({ meta: [{ title: 'Images · pow/dock' }] }),
  component: ImagesRoute,
})

function ImagesRoute() {
  const { filter } = Route.useSearch()
  return <ImagesPage initialFilter={filter} />
}
