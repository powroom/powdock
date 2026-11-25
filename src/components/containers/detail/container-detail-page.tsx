import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import {
  CopyIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { ImageIcon } from '@/components/app/image-icon'
import { copyWithToast } from '@/components/app/copy-feedback'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Frame, FramePanel } from '@/components/ui/frame'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { formatContainerStatus } from '@/lib/container-status'
import { isActiveState, isRunning } from '@/lib/container-view'
import { formatBytes } from '@/lib/format'
import { containerStatsQuery, containersQuery, updatesQuery } from '@/lib/queries'
import { useImageStacks } from '@/components/app/use-image-stacks'
import { RunPanel } from '@/components/projects/run-panel'
import { useProjectRun } from '@/components/projects/use-project-run'
import { UpdateBadge } from '@/components/updates/update-badge'
import { useUpdateFlow } from '@/components/updates/use-update-flow'
import type { IconKey } from '@/lib/image-icon'
import { updateImageIds } from '@/lib/updates'
import type { ContainerAction, ContainerStats, ContainerSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import { DOT_CLASS, SELF_REASON, STATE_LABEL } from '../container-row'
import { RemoveContainerDialog, type RemoveOptions } from '../remove-container-dialog'
import { useContainerActions } from '../use-container-actions'
import { DetailsTab } from './details-tab'
import { LogViewer } from './log-viewer'
import { StatsTab } from './stats-tab'

// xterm.js is large, so the terminal loads only when its tab is first opened.
const TerminalTab = lazy(() => import('./terminal-tab').then((module) => ({ default: module.TerminalTab })))

export type DetailTab = 'logs' | 'details' | 'stats' | 'terminal'

/** How often the header refreshes while the tab is visible. The stats are sampled every 2 seconds. */
const POLL_MS = 3000
const STATS_POLL_MS = 2000

/**
 * One container: a header (name, state, live CPU and memory, the actions) and the Logs, Details, Stats
 * and Terminal tabs. The tab is kept in the URL, so a reload or a shared link opens the same tab.
 */
export function ContainerDetailPage({
  id,
  tab,
  onTabChange,
}: {
  id: string
  tab: DetailTab
  onTabChange: (tab: DetailTab) => void
}) {
  const list = useQuery({ ...containersQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const container = list.data?.find((item) => item.id === id)
  const running = container ? isRunning(container) : false
  const stacks = useImageStacks(container ? [container.imageId] : [])
  const stats = useQuery({
    ...containerStatsQuery(running ? [id] : []),
    enabled: running,
    placeholderData: keepPreviousData,
    refetchInterval: STATS_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const stat = stats.data?.find((item) => item.id === id)

  const { busy, act, remove } = useContainerActions()
  const navigate = useNavigate()
  const run = useProjectRun()
  const updateFlow = useUpdateFlow(run)
  const updates = useQuery(updatesQuery())
  const hasUpdate =
    container !== undefined && !container.isSelf && updateImageIds(updates.data?.results ?? {}).has(container.imageId)
  const [killOpen, setKillOpen] = useState(false)
  const [removeOpen, setRemoveOpen] = useState(false)

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      {list.isPending && <HeaderSkeleton />}

      {list.error && !list.data && (
        <Alert variant="error">
          <AlertTitle>Could not load the container</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void list.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {!list.isPending && !container && !list.error && (
        <Empty className="rounded-lg border bg-card">
          <EmptyHeader>
            <EmptyTitle>This container no longer exists.</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link to="/containers" />} variant="outline">
              Back to containers
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {container && (
        <>
          <Header
            busy={busy.get(container.id)}
            container={container}
            stack={stacks[container.imageId] ?? null}
            onAction={(action) => act(container, action)}
            onCopyId={() => void copyWithToast(container.id, 'Container ID copied', container.shortId)}
            onKill={() => setKillOpen(true)}
            onRemove={() => setRemoveOpen(true)}
            stat={stat}
            statsPending={stats.isPending && running}
            hasUpdate={hasUpdate}
            onUpdate={() => {
              if (container) updateFlow.ask(container)
            }}
            updateDisabled={run.running}
          />
          <Tabs onValueChange={(value) => onTabChange(value as DetailTab)} value={tab}>
            <TabsList>
              <TabsTab value="logs">Logs</TabsTab>
              <TabsTab value="details">Details</TabsTab>
              <TabsTab value="stats">Stats</TabsTab>
              <TabsTab value="terminal">Terminal</TabsTab>
            </TabsList>
            <TabsPanel className="pt-4 min-w-0" value="logs">
              <LogViewer name={container.name} running={running} source={{ kind: 'container', id: container.id }} />
            </TabsPanel>
            <TabsPanel className="pt-4 min-w-0" value="details">
              <DetailsTab id={container.id} />
            </TabsPanel>
            <TabsPanel className="pt-4 min-w-0" value="stats">
              <StatsTab id={container.id} running={running} />
            </TabsPanel>
            <TabsPanel className="pt-4 min-w-0" value="terminal">
              {/* the fallback has the same outer size as the terminal frame (toolbar row and box), so the page does not jump */}
              <Suspense
                fallback={
                  <Frame>
                    <div className="h-11 sm:h-10" />
                    <FramePanel className="overflow-hidden p-0">
                      <div className="h-[min(60svh,40rem)] min-h-64" />
                    </FramePanel>
                  </Frame>
                }
              >
                <TerminalTab
                  id={container.id}
                  onStart={() => act(container, 'start')}
                  running={running}
                  starting={busy.get(container.id) === 'start'}
                />
              </Suspense>
            </TabsPanel>
          </Tabs>

          {updateFlow.dialog}

          <ConfirmDialog
            confirmLabel="Kill"
            description="Docker sends SIGKILL, so the container stops at once and gets no chance to shut down cleanly."
            destructive
            onConfirm={() => {
              act(container, 'kill')
              setKillOpen(false)
            }}
            onOpenChange={setKillOpen}
            open={killOpen}
            title={`Kill container ${container.name}?`}
          />
          <RemoveContainerDialog
            container={container}
            onConfirm={(options: RemoveOptions) => {
              setRemoveOpen(false)
              remove(container, options, () => void navigate({ to: '/containers' }))
            }}
            onOpenChange={setRemoveOpen}
            open={removeOpen}
          />
        </>
      )}

      {run.state.phase !== 'idle' && <RunPanel state={run.state} />}
    </div>
  )
}

function Header({
  container: c,
  stack,
  busy,
  stat,
  statsPending,
  hasUpdate,
  updateDisabled,
  onUpdate,
  onAction,
  onKill,
  onRemove,
  onCopyId,
}: {
  container: ContainerSummary
  /** the icon the image's config names (see useImageStacks) */
  stack: IconKey | null
  busy: string | undefined
  stat: ContainerStats | undefined
  statsPending: boolean
  /** the image has a newer version: the Update badge shows */
  hasUpdate: boolean
  updateDisabled: boolean
  onUpdate: () => void
  onAction: (action: ContainerAction) => void
  onKill: () => void
  onRemove: () => void
  onCopyId: () => void
}) {
  const active = isActiveState(c.state)
  const paused = c.state === 'paused'
  const running = isRunning(c)
  const self = c.isSelf
  const isBusy = busy !== undefined

  return (
    <header className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        {/* the name takes the full width on a phone, so the actions wrap below it */}
        <div className="flex min-w-0 flex-1 items-start gap-3 max-sm:basis-full">
          <span className="relative size-9 shrink-0">
            <ImageIcon image={c.image} name={c.name} size={36} stack={stack} />
            <span
              aria-label={STATE_LABEL[c.state]}
              className={cn(
                'absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-background',
                DOT_CLASS[c.state],
              )}
              role="img"
            />
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex min-w-0 items-baseline gap-2">
              <h1 className="min-w-0 truncate font-heading font-semibold text-xl tracking-tight" title={c.name}>
                {c.name}
              </h1>
              {c.service && c.service !== c.name && (
                <span className="min-w-0 truncate text-muted-foreground text-sm">{c.service}</span>
              )}
            </div>
            <div className="flex min-w-0 items-center gap-2">
              <p className="min-w-0 truncate font-mono text-muted-foreground text-xs" title={c.image}>
                {c.image}
              </p>
              {hasUpdate && (
                <UpdateBadge
                  disabled={updateDisabled}
                  label={`Update ${c.name}`}
                  onClick={onUpdate}
                  tip="A newer image is available. Click to update."
                />
              )}
            </div>
            <p className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="min-w-0 truncate text-muted-foreground" title={c.status}>
                {formatContainerStatus(c.status)}
              </span>
              <span className="tabular-nums">
                <span className="text-muted-foreground">CPU </span>
                {statText(running, statsPending, stat, 'cpu')}
              </span>
              <span className="whitespace-nowrap tabular-nums">
                <span className="text-muted-foreground">Memory </span>
                {statText(running, statsPending, stat, 'memory')}
              </span>
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            disabled={isBusy || (active && self)}
            loading={busy === 'start' || busy === 'stop'}
            onClick={() => onAction(active ? 'stop' : 'start')}
            size="sm"
            variant="outline"
          >
            {active ? <SquareIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
            {active ? 'Stop' : 'Start'}
          </Button>
          <Button
            disabled={isBusy || self || !active}
            loading={busy === 'restart'}
            onClick={() => onAction('restart')}
            size="sm"
            variant="outline"
          >
            <RotateCwIcon aria-hidden="true" />
            Restart
          </Button>
          <Menu>
            <MenuTrigger
              render={
                <Button
                  aria-label={`More actions for ${c.name}`}
                  disabled={isBusy}
                  loading={busy === 'pause' || busy === 'unpause' || busy === 'kill' || busy === 'remove'}
                  size="icon-sm"
                  variant="outline"
                />
              }
            >
              <MoreHorizontalIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="end">
              {self && <p className="px-2 py-1.5 text-muted-foreground text-xs">{SELF_REASON}.</p>}
              <MenuItem
                disabled={isBusy || self || !(running || paused)}
                onClick={() => onAction(paused ? 'unpause' : 'pause')}
              >
                {paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
                {paused ? 'Resume' : 'Pause'}
              </MenuItem>
              <MenuItem disabled={isBusy || self || !active} onClick={onKill}>
                <ZapIcon aria-hidden="true" />
                Kill
              </MenuItem>
              <MenuItem onClick={onCopyId}>
                <CopyIcon aria-hidden="true" />
                Copy ID
              </MenuItem>
              <MenuSeparator />
              <MenuItem disabled={isBusy || self} onClick={onRemove} variant="destructive">
                <Trash2Icon aria-hidden="true" />
                Remove
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
    </header>
  )
}

/** One live figure in the header. A running container shows a skeleton until its first sample. */
function statText(running: boolean, pending: boolean, stat: ContainerStats | undefined, which: 'cpu' | 'memory') {
  if (!running) return <span className="text-muted-foreground">not running</span>
  if (!stat) {
    if (pending) return <Skeleton className="inline-block h-3 w-14 align-middle" />
    return '-'
  }
  if (which === 'cpu') return stat.cpuPercent === null ? '-' : `${stat.cpuPercent.toFixed(1)}%`
  return `${formatBytes(stat.memUsage)} / ${formatBytes(stat.memLimit)}`
}

/** The header's size while the container list loads: the same rows, so the page does not move. */
function HeaderSkeleton() {
  return (
    <div aria-busy="true" className="flex min-w-0 items-start gap-3">
      <Skeleton className="size-9 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-5 w-56 max-w-full" />
        <Skeleton className="h-3 w-72 max-w-full" />
        <Skeleton className="h-3 w-80 max-w-full" />
      </div>
    </div>
  )
}
