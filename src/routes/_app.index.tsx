import { createFileRoute } from '@tanstack/react-router'
import { DashboardPage } from '@/components/dashboard/dashboard-page'

// Signed-out visitors never get here: the root route sends them to /setup or /login on the client.
export const Route = createFileRoute('/_app/')({
  head: () => ({ meta: [{ title: 'Dashboard · pow/dock' }] }),
  component: DashboardPage,
})
