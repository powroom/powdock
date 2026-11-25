import { CopyIcon, InfoIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react'
import { ContainerLinks } from '@/components/app/container-links'
import { RelativeTime } from '@/components/app/relative-time'
import { copyWithToast } from '@/components/app/copy-feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { formatBytes } from '@/lib/format'
import { shortVolumeName, volumeRemoveBlock } from '@/lib/volume-view'
import type { VolumeSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * One volume row. Below the container width @3xl (48rem) the row stacks: the name and the actions on
 * the first line, then the driver, size, age and users. From @3xl up, the cells are the columns of one
 * grid, so every row lines up.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-accent/40 @3xl:grid-cols-[minmax(0,2.5fr)_5rem_6rem_6.5rem_minmax(0,2fr)_auto]'
const WIDE_RESET = '@3xl:col-auto @3xl:row-auto'
const POS = {
  name: `col-start-1 row-start-1 min-w-0 ${WIDE_RESET}`,
  actions: `col-start-2 row-start-1 ${WIDE_RESET}`,
  details: 'col-span-2 col-start-1 row-start-2 min-w-0',
}

const NAME =
  'rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring truncate'

export interface VolumeRowHandlers {
  onDetails: (volume: VolumeSummary) => void
  onRemove: (volume: VolumeSummary) => void
}

/** `size` is undefined while the sizes are still loading, and null when Docker cannot tell. */
export function VolumeRow({
  volume,
  size,
  handlers,
}: {
  volume: VolumeSummary
  size: number | null | undefined
  handlers: VolumeRowHandlers
}) {
  const blocked = volumeRemoveBlock(volume)
  const short = shortVolumeName(volume)
  const openDetails = () => handlers.onDetails(volume)

  return (
    <div className={ROW} data-anonymous={volume.anonymous || undefined}>
      <span className={cn('flex min-w-0 items-center gap-1.5', POS.name)}>
        {volume.anonymous ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <button className={cn(NAME, 'font-mono text-sm font-normal')} onClick={openDetails} type="button" />
              }
            >
              {short}
            </TooltipTrigger>
            <TooltipPopup>{volume.name}</TooltipPopup>
          </Tooltip>
        ) : (
          <button className={NAME} onClick={openDetails} type="button">
            {volume.name}
          </button>
        )}
        {volume.anonymous && (
          <Badge size="sm" variant="outline">
            Anonymous
          </Badge>
        )}
        {volume.project && (
          <Badge className="max-w-32 truncate max-sm:hidden" size="sm" variant="secondary">
            {volume.project}
          </Badge>
        )}
      </span>

      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs @3xl:contents', POS.details)}>
        <span className="text-muted-foreground">{volume.driver}</span>
        <span className="flex h-4 items-center tabular-nums">
          {size === undefined ? <Skeleton className="h-3 w-14" /> : formatBytes(size)}
        </span>
        <span className="text-muted-foreground">
          <RelativeTime value={volume.createdAt} />
        </span>
        {volume.usedBy.length === 0 ? (
          <span className="text-muted-foreground">Unused</span>
        ) : (
          <ContainerLinks containers={volume.usedBy} shown={1} />
        )}
      </div>

      <div className={cn('flex items-center justify-end gap-1', POS.actions)}>
        <Menu>
          <MenuTrigger render={<Button aria-label={`More actions for ${short}`} size="icon-sm" variant="ghost" />}>
            <MoreHorizontalIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={openDetails}>
              <InfoIcon aria-hidden="true" />
              Details
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => void copyWithToast(volume.name, 'Volume name copied', volume.name)}>
              <CopyIcon aria-hidden="true" />
              Copy name
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              disabled={blocked !== null}
              onClick={() => handlers.onRemove(volume)}
              title={blocked ?? undefined}
              variant="destructive"
            >
              <Trash2Icon aria-hidden="true" />
              Remove
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  )
}

/** A row of the same shape while the list loads. Its heights match the real rows. */
export function VolumeRowSkeleton() {
  return (
    <div aria-hidden="true" className={ROW}>
      <span className={cn('flex h-5 items-center gap-2', POS.name)}>
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-14 rounded-sm" />
      </span>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @3xl:contents', POS.details)}>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-12" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-14" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-16" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-20" />
        </span>
      </div>
      <Skeleton className={cn('size-8 rounded-lg sm:size-7', POS.actions)} />
    </div>
  )
}
