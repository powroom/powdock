import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import {
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  Trash2Icon,
  DownloadIcon,
} from 'lucide-react'
import { useState } from 'react'
import type { ReactElement } from 'react'
import { CopyButton } from '@/components/app/copy-button'
import { LogViewer } from '@/components/containers/detail/log-viewer'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { containersQuery, projectQuery, updatesQuery } from '@/lib/queries'
import type { ContainerSummary } from '@/lib/types'
import { updateImageIds } from '@/lib/updates'
import { ProjectComposeFile } from './project-compose-file'
import { ProjectContainers } from './project-containers'
import { DownDialog } from './down-dialog'
import { RunPanel } from './run-panel'
import { useProjectRun } from './use-project-run'
import { useUpdateFlow } from '@/components/updates/use-update-flow'
import type { Project } from '@/server/compose.server'

export type ProjectTab = 'containers' | 'logs' | 'compose'

/** How often the header refreshes while the tab is visible. */
const POLL_MS = 3000
const COMPOSE_MISSING = 'Needs the docker compose command on this machine.'
const SELF_PROJECT = 'pow/dock runs in this project. Run its commands from a terminal.'
const RUNNING = 'A command is running.'

/** Why the actions cannot run now, or null when they can. */
function blockedReason(composeAvailable: boolean, project: Project, running: boolean): string | null {
  if (!composeAvailable) return COMPOSE_MISSING
  if (project.containsSelf) return SELF_PROJECT
  if (running) return RUNNING
  return null
}

/**
 * One Compose project: a header with its folder and the actions, and the Containers, Logs and
 * Compose file tabs. The tab is kept in the URL. The command output shows in a panel at the bottom.
 */
export function ProjectPage({
  name,
  tab,
  onTabChange,
}: {
  name: string
  tab: ProjectTab
  onTabChange: (tab: ProjectTab) => void
}) {
  const projectState = useQuery({ ...projectQuery(name), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const containers = useQuery({ ...containersQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const run = useProjectRun()
  const updateFlow = useUpdateFlow(run)
  const [downOpen, setDownOpen] = useState(false)

  const project = projectState.data?.project ?? null
  const composeAvailable = projectState.data?.composeAvailable ?? false
  const members: ContainerSummary[] = (containers.data ?? []).filter((container) => container.project === name)
  const updates = useQuery(updatesQuery())
  const imageIds = updateImageIds(updates.data?.results ?? {})
  // the dot on "Pull & update": one of the services has a newer image
  const someUpdate = members.some((container) => imageIds.has(container.imageId))
  const reason = project ? blockedReason(composeAvailable, project, run.running) : null

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      {projectState.isPending && <HeaderSkeleton />}

      {projectState.error && !projectState.data && (
        <Alert variant="error">
          <AlertTitle>Could not load the project</AlertTitle>
          <AlertDescription>{projectState.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void projectState.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {!projectState.isPending && !project && !projectState.error && (
        <Empty className="rounded-lg border bg-card">
          <EmptyHeader>
            <EmptyTitle>No containers belong to {name} now.</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link to="/containers" />} variant="outline">
              Back to containers
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {project && (
        <>
          <header className="flex min-w-0 flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex min-w-0 items-baseline gap-2">
                <h1 className="min-w-0 truncate font-heading font-semibold text-xl tracking-tight" title={project.name}>
                  {project.name}
                </h1>
                <span className="whitespace-nowrap text-muted-foreground text-sm tabular-nums">
                  {project.total === 0 ? 'Not running' : `${project.running}/${project.total} running`}
                </span>
              </div>
              <div className="flex min-w-0 items-center gap-1">
                <FolderOpenIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
                <p className="min-w-0 truncate font-mono text-muted-foreground text-xs" title={project.workingDir}>
                  {project.workingDir || 'No folder known'}
                </p>
                {project.workingDir && (
                  <CopyButton label="Copy the folder" size="icon-xs" text={project.workingDir} variant="ghost">
                    {null}
                  </CopyButton>
                )}
              </div>
              {project.generated && (
                <p className="text-muted-foreground text-xs">Made by another tool. Changes here can be overwritten.</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <ActionButton reason={reason}>
                <Button
                  disabled={reason !== null}
                  onClick={() => run.start(name, 'up', false)}
                  size="sm"
                  variant="default"
                >
                  <PlayIcon aria-hidden="true" />
                  Up
                </Button>
              </ActionButton>
              <Menu>
                <ActionButton reason={reason}>
                  <MenuTrigger
                    render={
                      <Button
                        aria-label={`More actions for ${project.name}`}
                        disabled={reason !== null}
                        size="icon-sm"
                        variant="outline"
                      />
                    }
                  >
                    <MoreHorizontalIcon aria-hidden="true" />
                  </MenuTrigger>
                </ActionButton>
                <MenuPopup align="end">
                  <MenuItem onClick={() => run.start(name, 'restart', false)}>
                    <RotateCwIcon aria-hidden="true" />
                    Restart
                  </MenuItem>
                  <MenuItem onClick={() => run.start(name, 'pull', false)}>
                    <DownloadIcon aria-hidden="true" />
                    Pull &amp; update
                    {someUpdate && (
                      <span
                        aria-label="Updates available"
                        className="ms-auto size-1.5 rounded-full bg-foreground"
                        role="img"
                      />
                    )}
                  </MenuItem>
                  <MenuItem onClick={() => run.start(name, 'stop', false)}>
                    <SquareIcon aria-hidden="true" />
                    Stop
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem onClick={() => setDownOpen(true)} variant="destructive">
                    <Trash2Icon aria-hidden="true" />
                    Down
                  </MenuItem>
                </MenuPopup>
              </Menu>
            </div>
          </header>

          <Tabs onValueChange={(value) => onTabChange(value as ProjectTab)} value={tab}>
            <TabsList>
              <TabsTab value="containers">Containers</TabsTab>
              <TabsTab value="logs">Logs</TabsTab>
              <TabsTab value="compose">Compose file</TabsTab>
            </TabsList>
            <TabsPanel className="min-w-0 pt-4" value="containers">
              {members.length === 0 && !containers.isPending ? (
                <Empty className="rounded-lg border bg-card">
                  <EmptyHeader>
                    <EmptyTitle>Not running.</EmptyTitle>
                  </EmptyHeader>
                  <EmptyContent>
                    <ActionButton reason={reason}>
                      <Button disabled={reason !== null} onClick={() => run.start(name, 'up', false)} variant="default">
                        <PlayIcon aria-hidden="true" />
                        Up
                      </Button>
                    </ActionButton>
                  </EmptyContent>
                </Empty>
              ) : (
                <ProjectContainers
                  containers={members}
                  loading={containers.isPending}
                  onUpdate={updateFlow.ask}
                  updateDisabled={run.running}
                  updateImageIds={imageIds}
                />
              )}
            </TabsPanel>
            <TabsPanel className="min-w-0 pt-4" value="logs">
              <LogViewer name={project.name} running={project.running > 0} source={{ kind: 'project', name }} />
            </TabsPanel>
            <TabsPanel className="min-w-0 pt-4" value="compose">
              <ProjectComposeFile
                applyReason={reason}
                composeAvailable={composeAvailable}
                generated={project.generated}
                name={project.name}
                onApply={() => run.start(project.name, 'up', false)}
              />
            </TabsPanel>
          </Tabs>

          {updateFlow.dialog}

          <DownDialog
            name={project.name}
            onConfirm={(volumes) => {
              setDownOpen(false)
              run.start(name, 'down', volumes)
            }}
            onOpenChange={setDownOpen}
            open={downOpen}
          />
        </>
      )}

      {run.state.phase !== 'idle' && <RunPanel state={run.state} />}
    </div>
  )
}

/** Wraps a control that can be disabled, so its reason shows on hover. Without a reason it is the control itself. */
function ActionButton({ reason, children }: { reason: string | null; children: ReactElement }) {
  if (reason === null) return children
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>{children}</TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  )
}

/** The header's size while the project loads, so the page does not move. */
function HeaderSkeleton() {
  return (
    <div aria-busy="true" className="flex min-w-0 flex-col gap-2">
      <Skeleton className="h-5 w-56 max-w-full" />
      <Skeleton className="h-3 w-80 max-w-full" />
    </div>
  )
}
