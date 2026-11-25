import { createFileRoute } from '@tanstack/react-router'
import { NetworksPage } from '@/components/networks/networks-page'

export const Route = createFileRoute('/_app/networks')({
  head: () => ({ meta: [{ title: 'Networks · pow/dock' }] }),
  component: NetworksPage,
})
