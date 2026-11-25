import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { attentionItems } from '@/lib/attention'
import { isRunning } from '@/lib/container-view'
import { busiestRows, engineLine } from '@/lib/dashboard-view'
import {
  containersQuery,
  containerStatsQuery,
  diskUsageQuery,
  engineInfoQuery,
  imagesQuery,
  recentFailuresQuery,
  totalsHistoryQuery,
  volumeSizesQuery,
  updatesQuery,
  volumesQuery,
} from '@/lib/queries'
import type { ContainerSummary } from '@/lib/types'
import { countImages } from '@/lib/image-view'
import { updateImageIds } from '@/lib/updates'
import { useContainerActions } from '@/components/containers/use-container-actions'
import { AttentionList } from './attention-list'
import { useImageStacks } from '@/components/app/use-image-stacks'
import { BusiestCard } from './busiest-card'
import { OverviewTiles } from './overview-tiles'
import { UsageCard } from './usage-card'

/** The container list refreshes every 3 seconds while the page is visible, like the containers page. */
const LIST_POLL_MS = 3000
/** The stats and the usage chart refresh every 2 seconds, the rate of the sampler. */
const STATS_POLL_MS = 2000
/** The counts of images, volumes and networks refresh every 30 seconds. */
const COUNTS_POLL_MS = 30_000

export function DashboardPage() {
  const containers = useQuery({
    ...containersQuery(),
    refetchInterval: LIST_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const images = useQuery({ ...imagesQuery(), refetchInterval: COUNTS_POLL_MS, refetchIntervalInBackground: false })
  const volumes = useQuery({ ...volumesQuery(), refetchInterval: COUNTS_POLL_MS, refetchIntervalInBackground: false })
  const sizes = useQuery({ ...volumeSizesQuery(), enabled: volumes.isSuccess })
  const disk = useQuery(diskUsageQuery())
  const engine = useQuery(engineInfoQuery())
  const updates = useQuery(updatesQuery())
  // The stops are read after the list, and kept by the server for 30 seconds.
  const failures = useQuery({ ...recentFailuresQuery(), enabled: containers.isSuccess })
  const totals = useQuery({
    ...totalsHistoryQuery(),
    refetchInterval: STATS_POLL_MS,
    refetchIntervalInBackground: false,
  })

  const list = containers.data ?? []
  // One query for every container's image: the busiest list only changes its order, so the query key stays the same.
  const stacks = useImageStacks(list.map((container) => container.imageId))
  const runningIds = list
    .filter(isRunning)
    .map((container) => container.id)
    .sort()
  const stats = useQuery({
    ...containerStatsQuery(runningIds),
    enabled: runningIds.length > 0,
    placeholderData: keepPreviousData,
    refetchInterval: STATS_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const statsList = stats.data ?? []
  const { busy, act } = useContainerActions()

  const hostMemory = engine.data && engine.data.memTotal > 0 ? engine.data.memTotal : null
  const attention = containers.isSuccess ? attentionItems(list, statsList, hostMemory, failures.data ?? []) : []
  const byId = new Map<string, ContainerSummary>(list.map((container) => [container.id, container]))
  const busyStart = new Set([...busy].filter(([, kind]) => kind === 'start').map(([id]) => id))

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4 sm:p-6">
      <h1 className="font-heading font-semibold text-xl tracking-tight">Dashboard</h1>

      {containers.error && (
        <Alert variant="error">
          <AlertTitle>Could not load containers</AlertTitle>
          <AlertDescription>{containers.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void containers.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      <div className="flex flex-col gap-2">
        <AttentionList
          byId={byId}
          busyStart={busyStart}
          failed={containers.isError}
          items={attention}
          loading={containers.isPending || (containers.isSuccess && failures.isPending)}
          onStart={(container) => act(container, 'start')}
        />
        {failures.isError && (
          <p className="text-muted-foreground text-sm">Recent stops could not be checked: {failures.error.message}</p>
        )}
      </div>

      <OverviewTiles
        containers={containers}
        disk={disk}
        images={images}
        sizes={sizes}
        updates={countImages(images.data ?? [], updateImageIds(updates.data?.results ?? {})).updates}
        volumes={volumes}
      />

      <UsageCard
        engine={engine.data}
        loading={totals.isPending || engine.isPending}
        totals={totals.isError ? undefined : totals.data}
      />

      <BusiestCard
        cpus={engine.data?.cpus ?? 0}
        loading={containers.isPending || engine.isPending}
        rows={busiestRows(list, statsList)}
        stacks={stacks}
      />

      {engine.isPending ? (
        <Skeleton className="h-4 w-72 max-w-full" />
      ) : engine.data ? (
        <p className="truncate text-muted-foreground text-xs">{engineLine(engine.data)}</p>
      ) : null}
    </div>
  )
}
