import { Link } from '@tanstack/react-router'
import { CopyIcon, InfoIcon, MoreHorizontalIcon, ShieldAlertIcon, Trash2Icon } from 'lucide-react'
import { ImageIcon } from '@/components/app/image-icon'
import { copyWithToast } from '@/components/app/copy-feedback'
import { RelativeTime } from '@/components/app/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { UpdateBadge } from '@/components/updates/update-badge'
import { countLabel, formatBytes } from '@/lib/format'
import { imageName } from '@/lib/image-view'
import type { IconKey } from '@/lib/image-icon'
import { scanBadge } from '@/lib/scan'
import type { ScanCounts, ImageSummary, ScanSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

/**
 * One image row. Below the container width @3xl (48rem) the row stacks: the name and the actions on
 * the first line, then the id, size, age and usage. From @3xl up, the cells become the columns of one
 * grid, and every row uses the same tracks, so the columns line up.
 */
const ROW =
  'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-accent/40 @3xl:grid-cols-[minmax(0,2.5fr)_7.5rem_9.5rem_6.5rem_8rem_auto]'
const WIDE_RESET = '@3xl:col-auto @3xl:row-auto'
const POS = {
  name: `col-start-1 row-start-1 min-w-0 ${WIDE_RESET}`,
  actions: `col-start-2 row-start-1 ${WIDE_RESET}`,
  details: 'col-span-2 col-start-1 row-start-2 min-w-0',
}

const NAME =
  'rounded-sm text-left font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring truncate'

export interface ImageRowHandlers {
  onRemove: (image: ImageSummary) => void
  onScan: (image: ImageSummary) => void
}

export function ImageRow({
  image,
  stack = null,
  hasUpdate = false,
  scan = null,
  canScan = false,
  handlers,
}: {
  image: ImageSummary
  /** the icon the image's config names (see useImageStacks) */
  stack?: IconKey | null
  /** one of its tags has a newer version on the registry */
  hasUpdate?: boolean
  /** the last vulnerability scan of the image, or null when it was never scanned */
  scan?: ScanSummary | null
  /** false when Trivy is not installed, so the Scan menu item is off */
  canScan?: boolean
  handlers: ImageRowHandlers
}) {
  const name = imageName(image)
  const extraTags = image.tags.slice(1)

  return (
    <div className={ROW} data-dangling={image.dangling || undefined}>
      <span className={cn('flex min-w-0 items-center gap-1.5', POS.name)}>
        <ImageIcon className="me-1" image={name ?? image.id} stack={stack} />
        <Link
          className={cn(NAME, image.dangling && 'text-muted-foreground')}
          params={{ id: image.shortId }}
          title={image.repository}
          to="/images/$id"
        >
          {image.repository}
        </Link>
        {image.dangling ? (
          <Badge size="sm" variant="outline">
            Dangling
          </Badge>
        ) : (
          <Badge className="max-w-40 truncate" size="sm" variant="secondary">
            {image.tag}
          </Badge>
        )}
        {extraTags.length > 0 && <MoreTags tags={extraTags} />}
        {hasUpdate && (
          <UpdateBadge tip="A newer image exists for this tag. Update the containers that use it on the Containers page." />
        )}
      </span>

      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs @3xl:contents', POS.details)}>
        <button
          aria-label={`Copy image ID ${image.shortId}`}
          className="min-w-0 truncate rounded-sm font-mono text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
          onClick={() => void copyWithToast(image.id, 'Image ID copied', image.shortId)}
          title="Copy the full image ID"
          type="button"
        >
          {image.shortId}
        </button>
        <span className="flex min-w-0 items-center gap-2">
          <span className="tabular-nums">{formatBytes(image.size)}</span>
          {scan && <ScanBadge counts={scan.counts} />}
        </span>
        <span className="text-muted-foreground">
          <RelativeTime value={image.createdAt} />
        </span>
        <span className={cn(image.containers === 0 ? 'text-muted-foreground' : 'text-foreground')}>
          {image.containers === 0 ? 'Unused' : countLabel(image.containers, 'container')}
        </span>
      </div>

      <div className={cn('flex items-center justify-end gap-1', POS.actions)}>
        <Menu>
          <MenuTrigger
            render={<Button aria-label={`More actions for ${name ?? image.shortId}`} size="icon-sm" variant="ghost" />}
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            <MenuLinkItem render={<Link params={{ id: image.shortId }} to="/images/$id" />}>
              <InfoIcon aria-hidden="true" />
              Details
            </MenuLinkItem>
            <MenuSeparator />
            <MenuItem onClick={() => void copyWithToast(image.id, 'Image ID copied', image.shortId)}>
              <CopyIcon aria-hidden="true" />
              Copy ID
            </MenuItem>
            <MenuItem
              disabled={!name}
              onClick={() => {
                if (name) void copyWithToast(name, 'Image name copied', name)
              }}
            >
              <CopyIcon aria-hidden="true" />
              Copy name
            </MenuItem>
            <MenuItem disabled={!canScan} onClick={() => handlers.onScan(image)}>
              <ShieldAlertIcon aria-hidden="true" />
              Scan for vulnerabilities
            </MenuItem>
            <MenuSeparator />
            <MenuItem onClick={() => handlers.onRemove(image)} variant="destructive">
              <Trash2Icon aria-hidden="true" />
              Remove
            </MenuItem>
          </MenuPopup>
        </Menu>
      </div>
    </div>
  )
}

/** The worst vulnerability count of a scan ("2 critical"), or "No known issues" (see scanBadge). */
function ScanBadge({ counts }: { counts: ScanCounts }) {
  const { label, tone } = scanBadge(counts)
  const variant = tone === 'critical' ? 'error' : tone === 'high' ? 'warning' : tone === 'low' ? 'secondary' : 'outline'
  return (
    <Badge
      className={cn('max-w-full truncate', tone === 'none' && 'text-muted-foreground')}
      size="sm"
      variant={variant}
    >
      {label}
    </Badge>
  )
}

/** "+N tags" for the other tags of an image, with the full list in a tooltip. */
function MoreTags({ tags }: { tags: readonly string[] }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge size="sm" variant="outline" />}>
        +{tags.length} {tags.length === 1 ? 'tag' : 'tags'}
      </TooltipTrigger>
      <TooltipPopup>{tags.join(', ')}</TooltipPopup>
    </Tooltip>
  )
}

/** A row of the same shape while the list loads. Its heights match the real rows. */
export function ImageRowSkeleton() {
  return (
    <div aria-hidden="true" className={ROW}>
      <span className={cn('flex items-center gap-2', POS.name)}>
        <Skeleton className="size-7 shrink-0 rounded-lg" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-4 w-14 rounded-sm" />
      </span>
      <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @3xl:contents', POS.details)}>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-20" />
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
