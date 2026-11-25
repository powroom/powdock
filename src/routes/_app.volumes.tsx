import { createFileRoute } from '@tanstack/react-router'
import { VolumesPage } from '@/components/volumes/volumes-page'

export const Route = createFileRoute('/_app/volumes')({
  head: () => ({ meta: [{ title: 'Volumes · pow/dock' }] }),
  component: VolumesPage,
})
