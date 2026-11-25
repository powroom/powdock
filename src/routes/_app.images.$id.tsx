import { createFileRoute } from '@tanstack/react-router'
import { ImageDetailPage } from '@/components/images/image-detail-page'

export const Route = createFileRoute('/_app/images/$id')({
  head: () => ({ meta: [{ title: 'Image · pow/dock' }] }),
  component: ImageDetailRoute,
})

function ImageDetailRoute() {
  const { id } = Route.useParams()
  return <ImageDetailPage id={id} />
}
