import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BoxIcon, PlusIcon, SearchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { EmptyState } from '@/components/app/empty-state'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { useHotkey } from '@/hooks/use-hotkey'
import { countByFilter, groupByProject, isRunning, matchesFilter, matchesSearch } from '@/lib/container-view'
import type { StateFilter } from '@/lib/container-view'
import { containersQuery, containerStatsQuery, idleProjectsQuery, updatesQuery } from '@/lib/queries'
import type { ContainerStats, ContainerSummary } from '@/lib/types'
import { updateImageIds } from '@/lib/updates'
import { NewProjectDialog } from '@/components/projects/new-project-dialog'
import { RunPanel } from '@/components/projects/run-panel'
import { useProjectRun } from '@/components/projects/use-project-run'
import { useUpdateFlow } from '@/components/updates/use-update-flow'
import { readCollapsed, writeCollapsed } from './collapsed-state'
import { ContainerProject } from './container-project'
import { ContainerRowSkeleton } from './container-row'
import type { RowHandlers } from './container-row'
import { RemoveContainerDialog } from './remove-container-dialog'
import type { RemoveOptions } from './remove-container-dialog'
import { RememberedProjects } from './remembered-projects'
import { useContainerActions } from './use-container-actions'
import { useImageStacks } from '@/components/app/use-image-stacks'

/** How often the list refreshes while the tab is visible. */
const POLL_MS = 3000
/** How often the stats refresh. The sampler takes a sample every 2 seconds. */
const STATS_POLL_MS = 2000
const SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth']
const FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'stopped', label: 'Stopped' },
]

export function ContainersPage() {
  const list = useQuery({ ...containersQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const containers = list.data ?? []
  const stacks = useImageStacks(containers.map((container) => container.imageId))
  // Sorted, so the same set of running containers always uses the same stats query.
  const runningIds = containers
    .filter(isRunning)
    .map((container) => container.id)
    .sort()
  const statsQuery = useQuery({
    ...containerStatsQuery(runningIds),
    enabled: runningIds.length > 0,
    placeholderData: keepPreviousData,
    refetchInterval: STATS_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const statsById = new Map<string, ContainerStats>(
    (statsQuery.data ?? []).map((stat): [string, ContainerStats] => [stat.id, stat]),
  )

  const { busy, act, actAll, remove } = useContainerActions()
  // The remembered projects with no containers. They are listed under the containers, at the end.
  const idle = useQuery({ ...idleProjectsQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const projectRun = useProjectRun()
  const updateFlow = useUpdateFlow(projectRun)
  const updates = useQuery(updatesQuery())
  const imageIds = updateImageIds(updates.data?.results ?? {})
  const [newOpen, setNewOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StateFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => readCollapsed())
  const [killTarget, setKillTarget] = useState<ContainerSummary | null>(null)
  const [killOpen, setKillOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ContainerSummary | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())

  const counts = countByFilter(containers)
  // Each project keeps all its containers for the bulk menu and the running count. Only the rows that
  // match the search and the filter are shown, and a project with no matching rows is left out.
  const sections = groupByProject(containers)
    .map((group) => ({
      group,
      shown: group.containers.filter(
        (container) => matchesFilter(container, filter) && matchesSearch(container, query),
      ),
    }))
    .filter(({ shown }) => shown.length > 0)

  const needle = query.trim().toLowerCase()
  const idleShown = (idle.data?.projects ?? []).filter(
    (project) => filter !== 'running' && project.name.toLowerCase().includes(needle),
  )

  const rows: RowHandlers = {
    busy,
    stacks,
    stats: statsById,
    statsPending: statsQuery.isPending && runningIds.length > 0,
    updateImageIds: imageIds,
    updateDisabled: projectRun.running,
    onUpdate: updateFlow.ask,
    onAction: act,
    onKill: (container) => {
      setKillTarget(container)
      setKillOpen(true)
    },
    onRemove: (container) => {
      setRemoveTarget(container)
      setRemoveOpen(true)
    },
  }

  const toggleProject = (key: string) => {
    const next = new Set(collapsed)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setCollapsed(next)
    writeCollapsed(next)
  }

  let body: ReactNode
  if (list.isPending || (containers.length === 0 && idle.isPending)) {
    body = (
      <Frame aria-busy="true" aria-label="Loading containers" role="region">
        <FramePanel className="overflow-hidden p-0">
          {SKELETON_KEYS.map((key) => (
            <ContainerRowSkeleton key={key} />
          ))}
        </FramePanel>
      </Frame>
    )
  } else if (containers.length === 0 && idleShown.length === 0 && (idle.data?.projects.length ?? 0) === 0) {
    body = list.error ? null : (
      <EmptyState description="Containers on this machine appear here." icon={BoxIcon} title="No containers yet" />
    )
  } else if (sections.length === 0 && idleShown.length === 0) {
    body = <EmptyState description="Try another search or filter." icon={SearchIcon} title="Nothing matches" />
  } else {
    body = (
      <>
        {sections.map(({ group, shown }) => (
          <ContainerProject
            collapsed={collapsed.has(group.key)}
            group={group}
            key={group.key}
            onBulk={actAll}
            onToggle={toggleProject}
            rows={rows}
            shown={shown}
          />
        ))}
        {idleShown.length > 0 && (
          <RememberedProjects
            busy={projectRun.running}
            composeAvailable={idle.data?.composeAvailable ?? false}
            onUp={(name) => projectRun.start(name, 'up', false)}
            projects={idleShown}
          />
        )}
      </>
    )
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <h1 className="font-heading font-semibold text-xl tracking-tight">Containers</h1>

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search containers"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder="Search name, image, project"
            ref={searchRef}
            spellCheck={false}
            type="search"
            value={query}
          />
        </InputGroup>
        <Tabs onValueChange={(value) => setFilter(value as StateFilter)} value={filter}>
          <TabsList size="sm">
            {FILTERS.map((option) => (
              <TabsTab className="grow-0 gap-1.5" key={option.value} value={option.value}>
                {option.label}
                <Badge size="sm" variant="secondary">
                  {counts[option.value]}
                </Badge>
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm tabular-nums">
            {counts.running} running · {counts.all} total
          </p>
          <Button onClick={() => setNewOpen(true)}>
            <PlusIcon aria-hidden="true" />
            New project
          </Button>
        </div>
      </div>

      {list.error && (
        <Alert variant="error">
          <AlertTitle>Could not load containers</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void list.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {body}

      {projectRun.state.phase !== 'idle' && <RunPanel state={projectRun.state} />}

      <NewProjectDialog onOpenChange={setNewOpen} open={newOpen} />
      {updateFlow.dialog}

      <ConfirmDialog
        confirmLabel="Kill"
        description="Docker sends SIGKILL, so the container stops at once and gets no chance to shut down cleanly."
        destructive
        onConfirm={() => {
          if (killTarget) act(killTarget, 'kill')
          setKillOpen(false)
        }}
        onOpenChange={setKillOpen}
        open={killOpen}
        title={`Kill container ${killTarget?.name ?? ''}?`}
      />
      <RemoveContainerDialog
        container={removeTarget}
        onConfirm={(options: RemoveOptions) => {
          if (removeTarget) remove(removeTarget, options)
          setRemoveOpen(false)
        }}
        onOpenChange={setRemoveOpen}
        open={removeOpen}
      />
    </div>
  )
}
