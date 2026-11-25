import { Link } from '@tanstack/react-router'
import { CircleCheckIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/ui/frame'
import { Skeleton } from '@/components/ui/skeleton'
import { ATTENTION_ROWS, type AttentionItem } from '@/lib/attention'
import { cn } from '@/lib/utils'
import type { ContainerSummary } from '@/lib/types'

/**
 * A row keeps the same height in every state: 84px on a phone (the reason wraps to a second line) and 52px
 * from the sm breakpoint. The loading, failed and empty states use the same row, so the frame never changes height.
 */
const ROW = 'flex min-h-[5.25rem] flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:min-h-[3.25rem]'

/** The "Needs attention" list: one row per container, with at most one action. Empty, it is one calm row. */
export function AttentionList({
  items,
  loading,
  failed,
  byId,
  busyStart,
  onStart,
}: {
  items: readonly AttentionItem[]
  /** the containers are still loading */
  loading: boolean
  /** the containers could not be loaded */
  failed: boolean
  /** the containers by id, for the start action */
  byId: ReadonlyMap<string, ContainerSummary>
  /** the containers that are starting now */
  busyStart: ReadonlySet<string>
  onStart: (container: ContainerSummary) => void
}) {
  const shown = items.slice(0, ATTENTION_ROWS)
  const more = items.length - shown.length

  let body
  if (loading) {
    body = (
      <div aria-busy="true" className={ROW}>
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-5 flex-1" />
        <Skeleton className="h-8 w-14 sm:h-7" />
      </div>
    )
  } else if (failed) {
    body = <div className={cn(ROW, 'text-muted-foreground text-sm')}>Could not check containers.</div>
  } else if (items.length === 0) {
    body = (
      <div className={cn(ROW, 'text-muted-foreground text-sm')}>
        <span className="flex items-center gap-2">
          <CircleCheckIcon aria-hidden="true" className="size-4 text-success" />
          Everything is running fine.
        </span>
      </div>
    )
  } else {
    body = (
      <>
        <ul className="divide-y">
          {shown.map((item) => (
            <li className={ROW} key={item.id}>
              <Link
                className="min-w-0 flex-1 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:flex-none"
                params={{ id: item.id }}
                search={{}}
                to="/containers/$id"
              >
                {item.name}
              </Link>
              <span className="order-last min-w-0 basis-full truncate text-muted-foreground text-sm sm:order-none sm:flex-1 sm:basis-auto">
                {item.reason}
              </span>
              <AttentionAction byId={byId} busyStart={busyStart} item={item} onStart={onStart} />
            </li>
          ))}
        </ul>
        {more > 0 && (
          <Link
            className="block border-t px-4 py-2.5 text-muted-foreground text-sm outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            to="/containers"
          >
            +{more} more
          </Link>
        )}
      </>
    )
  }

  return (
    <Frame aria-label="Needs attention" role="region">
      <FrameHeader className="h-12 flex-row items-center justify-between px-4">
        <FrameTitle>Needs attention</FrameTitle>
        {items.length > 0 && (
          <Badge size="sm" variant="outline">
            {items.length}
          </Badge>
        )}
      </FrameHeader>
      <FramePanel className="p-0">{body}</FramePanel>
    </Frame>
  )
}

/** The one action of a row: Logs or Stats open the container page, Start starts a stopped container. */
function AttentionAction({
  item,
  byId,
  busyStart,
  onStart,
}: {
  item: AttentionItem
  byId: ReadonlyMap<string, ContainerSummary>
  busyStart: ReadonlySet<string>
  onStart: (container: ContainerSummary) => void
}) {
  if (item.kind === 'exited') {
    const container = byId.get(item.id)
    return (
      <Button
        disabled={!container}
        loading={busyStart.has(item.id)}
        onClick={() => {
          if (container) onStart(container)
        }}
        size="sm"
        variant="outline"
      >
        Start
      </Button>
    )
  }
  if (item.kind === 'memory') {
    return (
      <Button
        render={<Link params={{ id: item.id }} search={{ tab: 'stats' }} to="/containers/$id" />}
        size="sm"
        variant="outline"
      >
        Stats
      </Button>
    )
  }
  return (
    <Button render={<Link params={{ id: item.id }} search={{}} to="/containers/$id" />} size="sm" variant="outline">
      Logs
    </Button>
  )
}
