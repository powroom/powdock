import { CopyIcon, InfoIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react'
import { ContainerLinks } from '@/components/app/container-links'
import { RelativeTime } from '@/components/app/relative-time'
import { copyWithToast } from '@/components/app/copy-feedback'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { networkRemoveBlock } from '@/lib/network-view'
import type { NetworkSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * One network row. Below the container width @3xl (48rem) the row stacks: the name and the actions on
 * the first line, then the driver, subnet, containers and age. From @3xl up, the cells are the columns
 * of one grid, so every row lines up.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-accent/40 @3xl:grid-cols-[minmax(0,2.5fr)_5rem_9rem_minmax(0,2fr)_6.5rem_auto]'
const WIDE_RESET = '@3xl:col-auto @3xl:row-auto'
const POS = {
  name: `col-start-1 row-start-1 min-w-0 ${WIDE_RESET}`,
  actions: `col-start-2 row-start-1 ${WIDE_RESET}`,
  details: 'col-span-2 col-start-1 row-start-2 min-w-0',
}

const NAME =
  'rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring truncate'

export interface NetworkRowHandlers {
  onDetails: (network: NetworkSummary) => void
  onRemove: (network: NetworkSummary) => void
}

export function NetworkRow({ network, handlers }: { network: NetworkSummary; handlers: NetworkRowHandlers }) {
  const blocked = networkRemoveBlock(network)
  const subnet = network.subnets.join(', ')
  const gateway = network.gateways.join(', ')
  const openDetails = () => handlers.onDetails(network)

  return (
    <div className={ROW} data-built-in={network.builtIn || undefined}>
      <span className={cn('flex min-w-0 flex-wrap items-center gap-1.5', POS.name)}>
        <button className={NAME} onClick={openDetails} type="button">
          {network.name}
        </button>
        {network.builtIn && (
          <Badge size="sm" variant="outline">
            Built in
          </Badge>
        )}
        {network.internal && (
          <Badge size="sm" variant="secondary">
            Internal
          </Badge>
        )}
        {network.project && (
          <Badge className="max-w-32 truncate max-sm:hidden" size="sm" variant="secondary">
            {network.project}
          </Badge>
        )}
      </span>

      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs @3xl:contents', POS.details)}>
        <span className="text-muted-foreground">{network.driver}</span>
        <span
          className={cn('min-w-0 truncate font-mono', !subnet && 'text-muted-foreground')}
          title={gateway ? `Gateway: ${gateway}` : undefined}
        >
          {subnet || '-'}
        </span>
        {network.containers.length === 0 ? (
          <span className="text-muted-foreground">No containers</span>
        ) : (
          <ContainerLinks containers={network.containers} shown={2} />
        )}
        <span className="text-muted-foreground">
          <RelativeTime value={network.createdAt} />
        </span>
      </div>

      <div className={cn('flex items-center justify-end gap-1', POS.actions)}>
        <Menu>
          <MenuTrigger
            render={<Button aria-label={`More actions for ${network.name}`} size="icon-sm" variant="ghost" />}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuItem onClick={openDetails}>
              <InfoIcon aria-hidden="true" />
              Details
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => void copyWithToast(network.id, 'Network ID copied', network.shortId)}>
              <CopyIcon aria-hidden="true" />
              Copy ID
            </MenuItem>
            <MenuSeparator />
            <MenuItem
              disabled={blocked !== null}
              onClick={() => handlers.onRemove(network)}
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
export function NetworkRowSkeleton() {
  return (
    <div aria-hidden="true" className={ROW}>
      <span className={cn('flex h-5 items-center gap-2', POS.name)}>
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-4 w-14 rounded-sm" />
      </span>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @3xl:contents', POS.details)}>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-12" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-28" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-20" />
        </span>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-16" />
        </span>
      </div>
      <Skeleton className={cn('size-8 rounded-lg sm:size-7', POS.actions)} />
    </div>
  )
}
