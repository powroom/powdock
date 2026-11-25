import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { BrushCleaningIcon, RefreshCwIcon } from 'lucide-react'
import { useState } from 'react'
import { refreshDiskUsageFn } from '@/api/cleanup.functions'
import { EmptyState } from '@/components/app/empty-state'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { nothingToClean } from '@/lib/cleanup-view'
import { diskUsageQuery } from '@/lib/queries'
import { BuildCacheCard, ContainersCard, ImagesCard, NetworksCard, VolumesCard } from './cleanup-cards'
import { UsageSummary } from './usage-summary'

/** Asks the server to read Docker now and stores the answer. When that fails, the query is read again, which shows the error. */
async function forceDiskUsage(queryClient: QueryClient, refetch: () => Promise<unknown>): Promise<void> {
  try {
    queryClient.setQueryData(diskUsageQuery().queryKey, await refreshDiskUsageFn())
  } catch {
    await refetch()
  }
}

export function CleanupPage() {
  // Docker can take seconds to read the usage. The data stays on screen while it refreshes. Until the first
  // answer arrives, the page shows the same cards with skeleton numbers, so nothing moves when the data comes.
  const usage = useQuery(diskUsageQuery())
  const data = usage.data
  const queryClient = useQueryClient()
  const [forcing, setForcing] = useState(false)

  // The Refresh button asks the server to read Docker now, even when its answer is still fresh.
  const refresh = () => {
    setForcing(true)
    void forceDiskUsage(queryClient, () => usage.refetch()).finally(() => setForcing(false))
  }

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-heading font-semibold text-xl tracking-tight">Cleanup</h1>
          <p className="text-muted-foreground text-sm">Free disk space Docker no longer needs.</p>
        </div>
        <Button
          aria-label="Refresh disk usage"
          loading={forcing || data?.refreshing === true}
          onClick={refresh}
          size="icon"
          variant="outline"
        >
          <RefreshCwIcon />
        </Button>
      </div>

      {usage.error && (
        <Alert variant="error">
          <AlertTitle>Could not read the disk usage</AlertTitle>
          <AlertDescription>{usage.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void usage.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      <UsageSummary usage={data} />

      {data && nothingToClean(data) ? (
        <EmptyState
          description="Docker has no unused images, stopped containers, volumes, build cache or networks."
          icon={BrushCleaningIcon}
          title="Nothing to clean"
        />
      ) : (
        <div className="grid items-stretch gap-4 md:grid-cols-2">
          <BuildCacheCard usage={data?.buildCache} />
          <ImagesCard usage={data?.images} />
          <ContainersCard usage={data?.containers} />
          <VolumesCard usage={data?.volumes} />
          <NetworksCard unusedNetworks={data?.unusedNetworks} />
        </div>
      )}
    </div>
  )
}
