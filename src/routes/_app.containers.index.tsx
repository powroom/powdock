import { createFileRoute } from '@tanstack/react-router'
import { ContainersPage } from '@/components/containers/containers-page'

export const Route = createFileRoute('/_app/containers/')({
  head: () => ({ meta: [{ title: 'Containers · pow/dock' }] }),
  component: ContainersPage,
})
