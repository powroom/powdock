import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { BoxIcon } from 'lucide-react'
import { useState } from 'react'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import { EmptyState } from '@/components/app/empty-state'
import { useImageStacks } from '@/components/app/use-image-stacks'
import { ContainerRow, ContainerRowSkeleton } from '@/components/containers/container-row'
import type { RowHandlers } from '@/components/containers/container-row'
import { RemoveContainerDialog } from '@/components/containers/remove-container-dialog'
import type { RemoveOptions } from '@/components/containers/remove-container-dialog'
import { useContainerActions } from '@/components/containers/use-container-actions'
import { Frame, FramePanel } from '@/components/ui/frame'
import { isRunning } from '@/lib/container-view'
import { containerStatsQuery } from '@/lib/queries'
import type { ContainerStats, ContainerSummary } from '@/lib/types'

/** How often the stats refresh. The sampler takes a sample every 2 seconds. */
const STATS_POLL_MS = 2000

/**
 * The containers of one project, with the same rows and actions as the Containers page. The list
 * itself is passed in (the page filters it), so it follows the same refresh.
 */
export function ProjectContainers({
  containers,
  loading,
  updateImageIds,
  updateDisabled,
  onUpdate,
}: {
  containers: ContainerSummary[]
  loading: boolean
  /** the IDs of the local images that are behind */
  updateImageIds: ReadonlySet<string>
  updateDisabled: boolean
  onUpdate: (container: ContainerSummary) => void
}) {
  const list = [...containers].sort((a, b) => a.name.localeCompare(b.name))
  const stacks = useImageStacks(list.map((container) => container.imageId))
  // Sorted, so the same set of running containers always uses the same stats query.
  const runningIds = list
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

  const { busy, act, remove } = useContainerActions()
  const [killTarget, setKillTarget] = useState<ContainerSummary | null>(null)
  const [killOpen, setKillOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ContainerSummary | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)

  const rows: RowHandlers = {
    busy,
    stacks,
    stats: statsById,
    statsPending: statsQuery.isPending && runningIds.length > 0,
    updateImageIds,
    updateDisabled,
    onUpdate,
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

  let body
  if (loading) {
    body = (
      <Frame aria-busy="true" aria-label="Loading containers" role="region">
        <FramePanel className="overflow-hidden p-0">
          {[0, 1, 2].map((index) => (
            <ContainerRowSkeleton key={index} />
          ))}
        </FramePanel>
      </Frame>
    )
  } else if (list.length === 0) {
    body = <EmptyState description="Containers of this project appear here." icon={BoxIcon} title="No containers" />
  } else {
    body = (
      <Frame>
        <FramePanel className="overflow-hidden p-0">
          {list.map((container) => (
            <ContainerRow container={container} handlers={rows} key={container.id} />
          ))}
        </FramePanel>
      </Frame>
    )
  }

  // The rows switch to their wide layout by the width of this wrapper (see ContainerRow).
  return (
    <>
      <div className="@container">{body}</div>
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
    </>
  )
}
