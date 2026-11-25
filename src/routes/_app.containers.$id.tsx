import { createFileRoute, redirect } from '@tanstack/react-router'
import { ContainerDetailPage, type DetailTab } from '@/components/containers/detail/container-detail-page'
import { containersQuery } from '@/lib/queries'

/** The Logs tab is the default. ?tab=details, ?tab=stats and ?tab=terminal open the other tabs. */
export const Route = createFileRoute('/_app/containers/$id')({
  validateSearch: (search: Record<string, unknown>): { tab?: DetailTab } => ({
    tab: search.tab === 'details' || search.tab === 'stats' || search.tab === 'terminal' ? search.tab : undefined,
  }),
  // A short id or a container name (typed or pasted into the address bar) goes to the full id.
  beforeLoad: async ({ params, search, context }) => {
    if (/^[a-f0-9]{64}$/.test(params.id)) return
    const list = await context.queryClient.ensureQueryData(containersQuery())
    const match = list.find((c) => c.name === params.id || (params.id.length >= 4 && c.id.startsWith(params.id)))
    if (match) throw redirect({ to: '/containers/$id', params: { id: match.id }, search, replace: true })
  },
  head: () => ({ meta: [{ title: 'Container · pow/dock' }] }),
  component: ContainerDetailRoute,
})

function ContainerDetailRoute() {
  const { id } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = Route.useNavigate()
  return (
    <ContainerDetailPage
      id={id}
      onTabChange={(next) => void navigate({ search: { tab: next }, replace: true })}
      tab={tab ?? 'logs'}
    />
  )
}
