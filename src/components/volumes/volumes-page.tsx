import { useQuery } from '@tanstack/react-query'
import { HardDriveIcon, PlusIcon, SearchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/app/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { useHotkey } from '@/hooks/use-hotkey'
import { countLabel, formatBytes } from '@/lib/format'
import { volumeSizesQuery, volumesQuery } from '@/lib/queries'
import {
  countVolumes,
  matchesVolumeFilter,
  matchesVolumeSearch,
  sortVolumes,
  totalVolumeSize,
  type VolumeFilter,
} from '@/lib/volume-view'
import type { VolumeSummary } from '@/lib/types'
import { CreateVolumeDialog } from './create-volume-dialog'
import { RemoveVolumeDialog } from './remove-volume-dialog'
import { VolumeDetailsSheet } from './volume-details-sheet'
import { VolumeRow, VolumeRowSkeleton } from './volume-row'

/** How often the list refreshes while the tab is visible. */
const POLL_MS = 10_000
/** Sizes are slow to read on big hosts, so they refresh at most once a minute. */
const SIZES_MS = 60_000
const SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth']
const FILTERS: { value: VolumeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in-use', label: 'In use' },
  { value: 'unused', label: 'Unused' },
  { value: 'anonymous', label: 'Anonymous' },
]

export function VolumesPage() {
  const list = useQuery({ ...volumesQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  // The sizes start after the list has loaded. Until then, and while they load, the Size column shows a skeleton.
  const sizes = useQuery({
    ...volumeSizesQuery(),
    enabled: list.isSuccess,
    refetchInterval: SIZES_MS,
    refetchIntervalInBackground: false,
  })
  const volumes = list.data ?? []

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<VolumeFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailsTarget, setDetailsTarget] = useState<VolumeSummary | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<VolumeSummary | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())

  // undefined while the sizes are loading, null when they are unknown
  const sizeOf = (name: string): number | null | undefined => {
    if (sizes.isError) return null
    if (!sizes.data) return undefined
    return sizes.data[name] ?? null
  }
  const sizesReady = sizes.isSuccess || sizes.isError

  const counts = countVolumes(volumes)
  const shown = sortVolumes(
    volumes.filter((volume) => matchesVolumeFilter(volume, filter) && matchesVolumeSearch(volume, query)),
  )

  let body: ReactNode
  if (list.isPending) {
    body = (
      <Frame aria-busy="true" aria-label="Loading volumes" role="region">
        <FramePanel className="overflow-hidden p-0">
          {SKELETON_KEYS.map((key) => (
            <VolumeRowSkeleton key={key} />
          ))}
        </FramePanel>
      </Frame>
    )
  } else if (volumes.length === 0) {
    body = list.error ? null : (
      <EmptyState
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Create volume
          </Button>
        }
        description="A volume keeps data for containers."
        icon={HardDriveIcon}
        title="No volumes yet"
      />
    )
  } else if (shown.length === 0) {
    body = <EmptyState description="Try another search or filter." icon={SearchIcon} title="Nothing matches" />
  } else {
    body = (
      <Frame>
        <FramePanel className="divide-y overflow-hidden p-0">
          {shown.map((volume) => (
            <VolumeRow
              handlers={{
                onDetails: (target) => {
                  setDetailsTarget(target)
                  setDetailsOpen(true)
                },
                onRemove: (target) => {
                  setRemoveTarget(target)
                  setRemoveOpen(true)
                },
              }}
              key={volume.name}
              size={sizeOf(volume.name)}
              volume={volume}
            />
          ))}
        </FramePanel>
      </Frame>
    )
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <h1 className="font-heading font-semibold text-xl tracking-tight">Volumes</h1>

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search volumes"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder="Search name, project"
            ref={searchRef}
            spellCheck={false}
            type="search"
            value={query}
          />
        </InputGroup>
        <div className="no-scrollbar max-w-full overflow-x-auto">
          <Tabs onValueChange={(value) => setFilter(value as VolumeFilter)} value={filter}>
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
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm tabular-nums">
            {countLabel(volumes.length, 'volume')} ·{' '}
            {sizesReady ? (
              sizes.isError ? (
                'size unknown'
              ) : (
                formatBytes(totalVolumeSize(volumes, sizes.data ?? {}))
              )
            ) : (
              <Skeleton className="inline-block h-3 w-14 align-middle" />
            )}
          </p>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Create volume
          </Button>
        </div>
      </div>

      {list.error && (
        <Alert variant="error">
          <AlertTitle>Could not load volumes</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void list.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {body}

      <CreateVolumeDialog onOpenChange={setCreateOpen} open={createOpen} />
      <VolumeDetailsSheet onOpenChange={setDetailsOpen} open={detailsOpen} volume={detailsTarget} />
      <RemoveVolumeDialog onOpenChange={setRemoveOpen} open={removeOpen} volume={removeTarget} />
    </div>
  )
}
