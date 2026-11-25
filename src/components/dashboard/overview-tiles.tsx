import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { UseQueryResult } from '@tanstack/react-query'
import { Frame, FramePanel } from '@/components/ui/frame'
import { Meter, MeterIndicator, MeterTrack } from '@/components/ui/meter'
import { Skeleton } from '@/components/ui/skeleton'
import { shareOf, totalReclaimable, totalUse } from '@/lib/cleanup-view'
import { volumeSizeTotal } from '@/lib/dashboard-view'
import { formatBytes } from '@/lib/format'
import { totalSize } from '@/lib/image-view'
import { isRunning } from '@/lib/container-view'
import { countLabel } from '@/lib/format'
import type { ContainerSummary, DiskUsage, ImageSummary, VolumeSummary } from '@/lib/types'

/** The four counts at the top of the dashboard, in one frame. Each tile links to its page. */
export function OverviewTiles({
  containers,
  images,
  volumes,
  sizes,
  disk,
  updates,
}: {
  containers: UseQueryResult<ContainerSummary[], Error>
  images: UseQueryResult<ImageSummary[], Error>
  volumes: UseQueryResult<VolumeSummary[], Error>
  sizes: UseQueryResult<Record<string, number | null>, Error>
  disk: UseQueryResult<DiskUsage, Error>
  /** the images with a newer version (see the Images page's Updates tab) */
  updates: number
}) {
  const containerList = containers.data
  const imageList = images.data
  const volumeList = volumes.data
  const running = containerList?.filter(isRunning).length ?? 0

  return (
    <Frame>
      <div className="grid grid-cols-2 gap-1 md:grid-cols-4">
        <Tile
          detail={shown(containers, containerList && `${containerList.length} total`, 'detail')}
          extra={
            updates > 0 && (
              <Link
                className="relative z-10 w-fit rounded-sm text-muted-foreground text-xs tabular-nums outline-none hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring sm:text-sm"
                search={{ filter: 'updates' }}
                to="/images"
              >
                {countLabel(updates, 'update')}
              </Link>
            )
          }
          meter={
            <TileMeter
              label="Running containers"
              percent={containerList ? shareOf(running, containerList.length) : 0}
            />
          }
          title="Containers"
          to="/containers"
          value={shown(containers, containerList && `${running} running`)}
        />
        <Tile
          detail={shown(images, imageList && formatBytes(totalSize(imageList)), 'detail')}
          meter={
            <TileMeter
              label="Images in use"
              percent={
                imageList ? shareOf(imageList.filter((image) => image.containers > 0).length, imageList.length) : 0
              }
            />
          }
          title="Images"
          to="/images"
          value={shown(images, imageList && String(imageList.length))}
        />
        <Tile
          detail={shownMerged(volumes, sizes, volumeList && formatBytes(volumeSizeTotal(sizes.data ?? {})), 'detail')}
          meter={
            <TileMeter
              label="Volumes in use"
              percent={
                volumeList
                  ? shareOf(volumeList.filter((volume) => volume.usedBy.length > 0).length, volumeList.length)
                  : 0
              }
            />
          }
          title="Volumes"
          to="/volumes"
          value={shown(volumes, volumeList && String(volumeList.length))}
        />
        <Tile
          detail={shown(disk, disk.data && `${formatBytes(totalReclaimable(disk.data))} can be freed`, 'detail')}
          meter={
            <TileMeter
              label="Disk space that can be freed"
              percent={disk.data ? shareOf(totalReclaimable(disk.data), totalUse(disk.data)) : 0}
            />
          }
          title="Disk"
          to="/cleanup"
          value={shown(disk, disk.data && formatBytes(totalUse(disk.data)))}
        />
      </div>
    </Frame>
  )
}

/**
 * A value of one query: a skeleton while it loads, "-" when it failed, otherwise the text. The text is
 * `text` (undefined until the data is in). The skeleton and the text share the same line height.
 */
function shown(
  query: UseQueryResult<unknown, Error>,
  text: string | false | undefined,
  line: 'value' | 'detail' = 'value',
): ReactNode {
  if (query.isError) return '-'
  if (text === undefined || text === false || query.isPending) return <LineSkeleton line={line} />
  return text
}

function LineSkeleton({ line }: { line: 'value' | 'detail' }) {
  return line === 'value' ? <Skeleton className="h-7 w-20" /> : <Skeleton className="h-4 w-24" />
}

/** Like `shown`, but the value also waits for a second query (the volume sizes). */
function shownMerged(
  query: UseQueryResult<unknown, Error>,
  second: UseQueryResult<unknown, Error>,
  text: string | false | undefined,
  line: 'value' | 'detail',
): ReactNode {
  if (query.isError || second.isError) return '-'
  if (!second.isSuccess) return <LineSkeleton line={line} />
  return shown(query, text, line)
}

/** A thin neutral bar at the bottom of a tile. It sits at the bottom even when the tile is taller. */
function TileMeter({ label, percent }: { label: string; percent: number }) {
  return (
    <Meter aria-label={label} className="mt-auto" value={percent}>
      <MeterTrack className="h-1">
        <MeterIndicator className="bg-foreground/80" />
      </MeterTrack>
    </Meter>
  )
}

/**
 * One count. The whole tile is a link (a stretched one, so a second link can sit inside the tile).
 * `extra` is a line under the detail for a link of its own. Its line is always there, so the tiles keep one height.
 */
function Tile({
  to,
  title,
  value,
  detail,
  extra,
  meter,
}: {
  to: '/containers' | '/images' | '/volumes' | '/cleanup'
  title: string
  value: ReactNode
  detail: ReactNode
  extra?: ReactNode
  meter: ReactNode
}) {
  return (
    <FramePanel className="mt-0! flex min-w-0 flex-col gap-1 p-4 transition-colors hover:bg-accent/40 focus-within:bg-accent/40">
      <span className="text-muted-foreground text-sm">{title}</span>
      <div className="flex h-8 min-w-0 items-center truncate font-heading font-semibold text-2xl tabular-nums">
        {value}
      </div>
      <div className="flex h-5 min-w-0 items-center truncate text-muted-foreground text-xs tabular-nums sm:text-sm">
        {detail}
      </div>
      <div className="flex h-5 min-w-0 items-center">{extra}</div>
      {meter}
      <Link
        aria-label={title}
        className="absolute inset-0 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring"
        to={to}
      />
    </FramePanel>
  )
}
