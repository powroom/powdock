import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DownloadIcon, LayersIcon, RefreshCwIcon, SearchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/app/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { toastManager } from '@/components/ui/toast'
import { useHotkey } from '@/hooks/use-hotkey'
import { checkUpdatesFn } from '@/api/updates.functions'
import { countLabel, formatBytes, timeAgo } from '@/lib/format'
import {
  countImages,
  matchesImageFilter,
  matchesImageSearch,
  sortImages,
  totalSize,
  type ImageFilter,
} from '@/lib/image-view'
import { imagesQuery, keys, scanStatusQuery, scanSummariesQuery, updatesQuery } from '@/lib/queries'
import { updateImageIds } from '@/lib/updates'
import type { ImageSummary, ScanSummary } from '@/lib/types'
import { useScanImage } from './use-scan-image'
import { useImageStacks } from '@/components/app/use-image-stacks'
import { ImageRow, ImageRowSkeleton } from './image-row'
import { PullImageDialog } from './pull-image-dialog'
import { RemoveImageDialog } from './remove-image-dialog'

/** How often the list refreshes while the tab is visible. Container counts change when containers start or stop. */
const POLL_MS = 10_000
const SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth']
const NO_SCANS: Readonly<Record<string, ScanSummary>> = {}
const FILTERS: { value: ImageFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in-use', label: 'In use' },
  { value: 'unused', label: 'Unused' },
  { value: 'dangling', label: 'Dangling' },
  { value: 'updates', label: 'Updates' },
]

export function ImagesPage({ initialFilter = 'all' }: { initialFilter?: ImageFilter }) {
  const queryClient = useQueryClient()
  const list = useQuery({ ...imagesQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const images = list.data ?? []
  const stacks = useImageStacks(images.map((image) => image.id))
  const scanStatus = useQuery(scanStatusQuery())
  const scanSummaries = useQuery(scanSummariesQuery())
  const scans = scanSummaries.data ?? NO_SCANS
  const scanImage = useScanImage()
  const canScan = scanStatus.data?.available ?? true
  const updates = useQuery(updatesQuery())
  const updateIds = updateImageIds(updates.data?.results ?? {})
  const check = useMutation({
    mutationFn: () => checkUpdatesFn(),
    onSuccess: (next) => queryClient.setQueryData(keys.updates, next),
    onError: (err: unknown) => {
      toastManager.add({
        type: 'error',
        title: 'Could not check for updates',
        description: err instanceof Error ? err.message : 'Unknown error.',
      })
    },
  })

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ImageFilter>(initialFilter)
  const [pullOpen, setPullOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<ImageSummary | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())

  const counts = countImages(images, updateIds)
  const shown = sortImages(
    images.filter((image) => matchesImageFilter(image, filter, updateIds) && matchesImageSearch(image, query)),
  )
  const lastChecked = updates.data?.lastCheckedAt ?? null
  const checkTip = lastChecked ? `Last checked ${timeAgo(lastChecked)}` : 'Not checked yet'

  const refresh = () => queryClient.invalidateQueries({ queryKey: keys.images })

  let body: ReactNode
  if (list.isPending) {
    body = (
      <Frame aria-busy="true" aria-label="Loading images" role="region">
        <FramePanel className="overflow-hidden p-0">
          {SKELETON_KEYS.map((key) => (
            <ImageRowSkeleton key={key} />
          ))}
        </FramePanel>
      </Frame>
    )
  } else if (images.length === 0) {
    body = list.error ? null : (
      <EmptyState
        action={
          <Button onClick={() => setPullOpen(true)}>
            <DownloadIcon aria-hidden="true" />
            Pull image
          </Button>
        }
        description="Pull an image to start."
        icon={LayersIcon}
        title="No images yet"
      />
    )
  } else if (shown.length === 0) {
    body = <EmptyState description="Try another search or filter." icon={SearchIcon} title="Nothing matches" />
  } else {
    body = (
      <Frame>
        <FramePanel className="divide-y overflow-hidden p-0">
          {shown.map((image) => (
            <ImageRow
              handlers={{
                onRemove: (target) => {
                  setRemoveTarget(target)
                  setRemoveOpen(true)
                },
                onScan: (target) => scanImage.mutate(target.id),
              }}
              canScan={canScan}
              hasUpdate={updateIds.has(image.id)}
              image={image}
              key={image.id}
              scan={scans[image.id] ?? null}
              stack={stacks[image.id] ?? null}
            />
          ))}
        </FramePanel>
      </Frame>
    )
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <h1 className="font-heading font-semibold text-xl tracking-tight">Images</h1>

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search images"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder="Search repository, tag, ID"
            ref={searchRef}
            spellCheck={false}
            type="search"
            value={query}
          />
        </InputGroup>
        <div className="no-scrollbar max-w-full overflow-x-auto">
          <Tabs onValueChange={(value) => setFilter(value as ImageFilter)} value={filter}>
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
            {countLabel(images.length, 'image')} · {formatBytes(totalSize(images))}
          </p>
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>
              <Button
                aria-label="Check for updates"
                loading={check.isPending}
                onClick={() => check.mutate()}
                size="icon"
                variant="outline"
              >
                <RefreshCwIcon aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipPopup>{checkTip}</TooltipPopup>
          </Tooltip>
          <Button onClick={() => setPullOpen(true)}>
            <DownloadIcon aria-hidden="true" />
            Pull image
          </Button>
        </div>
      </div>

      {list.error && (
        <Alert variant="error">
          <AlertTitle>Could not load images</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void list.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {body}

      <PullImageDialog onOpenChange={setPullOpen} onPulled={() => void refresh()} open={pullOpen} />
      <RemoveImageDialog image={removeTarget} onOpenChange={setRemoveOpen} open={removeOpen} />
    </div>
  )
}
