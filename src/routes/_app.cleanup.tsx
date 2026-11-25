import { createFileRoute } from '@tanstack/react-router'
import { CleanupPage } from '@/components/cleanup/cleanup-page'

export const Route = createFileRoute('/_app/cleanup')({
  head: () => ({ meta: [{ title: 'Cleanup · pow/dock' }] }),
  component: CleanupPage,
})
