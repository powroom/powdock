import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ProjectPage, type ProjectTab } from '@/components/projects/project-page'

/** The Containers tab is the default. ?tab=logs and ?tab=compose open the other tabs. */
export const Route = createFileRoute('/_app/projects/$name')({
  validateSearch: (search: Record<string, unknown>): { tab?: ProjectTab } => ({
    tab: search.tab === 'logs' || search.tab === 'compose' ? search.tab : undefined,
  }),
  head: () => ({ meta: [{ title: 'Project · pow/dock' }] }),
  component: ProjectRoute,
})

function ProjectRoute() {
  const { name } = Route.useParams()
  const { tab } = Route.useSearch()
  const navigate = useNavigate()
  return (
    <ProjectPage
      name={name}
      onTabChange={(next) =>
        void navigate({ to: '/projects/$name', params: { name }, search: { tab: next }, replace: true })
      }
      tab={tab ?? 'containers'}
    />
  )
}
