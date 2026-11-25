import {
  CopyIcon,
  MoreHorizontalIcon,
  PauseIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
  Trash2Icon,
  ZapIcon,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { copyWithToast } from '@/components/app/copy-feedback'
import { ImageIcon } from '@/components/app/image-icon'
import { Sparkline } from '@/components/charts/sparkline'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { UpdateBadge } from '@/components/updates/update-badge'
import { formatContainerStatus } from '@/lib/container-status'
import { isActiveState, isRunning } from '@/lib/container-view'
import { formatBytes } from '@/lib/format'
import type { IconKey } from '@/lib/image-icon'
import type { ContainerAction, ContainerPort, ContainerState, ContainerStats, ContainerSummary } from '@/lib/types'
import { cn } from '@/lib/utils'
import type { BusyMap } from './use-container-actions'

/**
 * One container row. The actions come last in the DOM, so the wide grid places them in the last track.
 * The first track holds the image tile (28px), with the status dot on its corner. The row is a grid whose
 * tracks are the same in every row, so the columns line up across the project sections. Below the container width @3xl (48rem) it stacks: name and actions on
 * the first line, then image, ports and the status line. The cells use display: contents above that
 * width, so they become the grid's own cells.
 */
const ROW =
  'grid grid-cols-[1.75rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2 hover:bg-accent/40 @3xl:grid-cols-[1.75rem_minmax(0,2.5fr)_minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1.2fr)_7.5rem_4.5rem_7rem]'

const WIDE_RESET = '@3xl:col-auto @3xl:row-auto'
const POS = {
  dot: `col-start-1 row-start-1 ${WIDE_RESET}`,
  name: `col-start-2 row-start-1 min-w-0 ${WIDE_RESET}`,
  actions: `col-start-3 row-start-1 ${WIDE_RESET}`,
  details: 'col-span-2 col-start-2 row-start-2 min-w-0',
}

export const STATE_LABEL: Record<ContainerState, string> = {
  running: 'Running',
  paused: 'Paused',
  restarting: 'Restarting',
  exited: 'Stopped',
  created: 'Created',
  dead: 'Dead',
  removing: 'Removing',
}

export const DOT_CLASS: Record<ContainerState, string> = {
  running: 'bg-success',
  paused: 'bg-warning',
  restarting: 'animate-pulse bg-warning',
  exited: 'bg-muted-foreground/40',
  created: 'bg-muted-foreground/40',
  dead: 'bg-muted-foreground/40',
  removing: 'bg-muted-foreground/40',
}

export const SELF_REASON = 'pow/dock runs in this container'

export interface RowHandlers {
  busy: BusyMap
  /** the icon of each image, by image id (see useImageStacks) */
  stacks: Readonly<Record<string, IconKey | null>>
  stats: ReadonlyMap<string, ContainerStats>
  statsPending: boolean
  /** the IDs of the local images that are behind (see updates.server.ts) */
  updateImageIds: ReadonlySet<string>
  /** true while another command runs, so the Update badge waits */
  updateDisabled: boolean
  onAction: (container: ContainerSummary, action: ContainerAction) => void
  onKill: (container: ContainerSummary) => void
  onRemove: (container: ContainerSummary) => void
  onUpdate: (container: ContainerSummary) => void
}

export function ContainerRow({ container: c, handlers }: { container: ContainerSummary; handlers: RowHandlers }) {
  const busy = handlers.busy.get(c.id)
  const stat = handlers.stats.get(c.id)
  const running = isRunning(c)
  const paused = c.state === 'paused'
  const active = isActiveState(c.state)
  const self = c.isSelf
  const isBusy = busy !== undefined
  const selfReason = self ? SELF_REASON : undefined
  const showStatSkeleton = running && !stat && handlers.statsPending
  // pow/dock does not offer to update its own container (the server refuses it too)
  const hasUpdate = !self && handlers.updateImageIds.has(c.imageId)

  return (
    <div className={ROW} data-state={c.state}>
      <span className={cn('relative size-7 shrink-0', POS.dot)}>
        <ImageIcon image={c.image} name={c.name} stack={handlers.stacks[c.imageId] ?? null} />
        <span
          aria-label={STATE_LABEL[c.state]}
          className={cn('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-card', DOT_CLASS[c.state])}
          role="img"
        />
      </span>

      <span className={cn('flex min-w-0 items-baseline gap-1.5', POS.name)}>
        <Link
          className="truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          params={{ id: c.id }}
          search={{}}
          title={c.name}
          to="/containers/$id"
        >
          {c.name}
        </Link>
        {c.service && c.service !== c.name && (
          <span className="truncate text-muted-foreground text-xs max-sm:hidden">{c.service}</span>
        )}
      </span>

      <div className={cn('flex flex-col gap-1 @3xl:contents', POS.details)}>
        <span className="flex min-w-0 items-center gap-2">
          <span className="min-w-0 truncate font-mono text-muted-foreground text-xs" title={c.image}>
            {c.image}
          </span>
          {hasUpdate && (
            <UpdateBadge
              disabled={handlers.updateDisabled}
              label={`Update ${c.name}`}
              onClick={() => handlers.onUpdate(c)}
              tip="A newer image is available. Click to update."
            />
          )}
        </span>
        <span className="flex min-w-0 items-center gap-1 overflow-hidden">
          {shownPorts(c.ports).shown.map((port) => (
            <PortBadge key={`${port.private}/${port.public ?? ''}/${port.type}/${port.ip ?? ''}`} port={port} />
          ))}
          <MorePorts ports={shownPorts(c.ports).rest} />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs @3xl:contents">
          <span className="min-w-0 truncate text-muted-foreground" title={c.status}>
            {formatContainerStatus(c.status)}
          </span>
          <span className="flex items-center gap-2 tabular-nums">
            <span>
              {showStatSkeleton ? <Skeleton className="inline-block h-3 w-10 align-middle" /> : cpuText(running, stat)}
            </span>
            <SparkCell pending={showStatSkeleton} running={running} stat={stat} />
          </span>
          <span
            className="tabular-nums text-muted-foreground"
            title={stat ? `Limit ${formatBytes(stat.memLimit)}` : undefined}
          >
            {showStatSkeleton ? <Skeleton className="inline-block h-3 w-14 align-middle" /> : memText(running, stat)}
          </span>
        </span>
      </div>

      <div className={cn('flex items-center justify-end gap-1', POS.actions)}>
        <IconAction
          disabled={isBusy || (active && self)}
          label={`${active ? 'Stop' : 'Start'} ${c.name}`}
          loading={busy === 'start' || busy === 'stop'}
          onClick={() => handlers.onAction(c, active ? 'stop' : 'start')}
          reason={active ? selfReason : undefined}
        >
          {active ? <SquareIcon aria-hidden="true" /> : <PlayIcon aria-hidden="true" />}
        </IconAction>
        <IconAction
          disabled={isBusy || self || !active}
          label={`Restart ${c.name}`}
          loading={busy === 'restart'}
          onClick={() => handlers.onAction(c, 'restart')}
          reason={active ? selfReason : 'Not running'}
        >
          <RotateCwIcon aria-hidden="true" />
        </IconAction>
        <Menu>
          <MenuTrigger
            render={
              <Button
                aria-label={`More actions for ${c.name}`}
                disabled={isBusy}
                loading={busy === 'pause' || busy === 'unpause' || busy === 'kill' || busy === 'remove'}
                size="icon-sm"
                variant="ghost"
              />
            }
          >
            <MoreHorizontalIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="end">
            {self && <p className="px-2 py-1.5 text-muted-foreground text-xs">{SELF_REASON}.</p>}
            <MenuItem
              disabled={isBusy || self || !(running || paused)}
              onClick={() => handlers.onAction(c, paused ? 'unpause' : 'pause')}
            >
              {paused ? <PlayIcon aria-hidden="true" /> : <PauseIcon aria-hidden="true" />}
              {paused ? 'Resume' : 'Pause'}
            </MenuItem>
            <MenuItem disabled={isBusy || self || !active} onClick={() => handlers.onKill(c)}>
              <ZapIcon aria-hidden="true" />
              Kill
            </MenuItem>
            <MenuItem onClick={() => void copyWithToast(c.id, 'Container ID copied', c.shortId)}>
              <CopyIcon aria-hidden="true" />
              Copy ID
            </MenuItem>
            <MenuSeparator />
            <MenuItem disabled={isBusy || self} onClick={() => handlers.onRemove(c)} variant="destructive">
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
export function ContainerRowSkeleton() {
  return (
    <div aria-hidden="true" className={ROW}>
      <Skeleton className={cn('size-7 rounded-lg', POS.dot)} />
      <span className={cn('flex h-5 items-center', POS.name)}>
        <Skeleton className="h-3 w-36" />
      </span>
      <div className={cn('flex flex-col gap-1 @3xl:contents', POS.details)}>
        <span className="flex h-4 items-center">
          <Skeleton className="h-3 w-44" />
        </span>
        <span className="flex h-5 items-center">
          <Skeleton className="h-3 w-16" />
        </span>
        <span className="flex flex-wrap items-center gap-x-3 gap-y-1 @3xl:contents">
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-28" />
          </span>
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-10" />
          </span>
          <span className="flex h-4 items-center">
            <Skeleton className="h-3 w-14" />
          </span>
        </span>
      </div>
      <Skeleton className={cn('size-7 rounded-md sm:size-6', POS.actions)} />
    </div>
  )
}

/**
 * The CPU sparkline of a row. Every row has the same 48 by 16 box, so the columns line up: a stopped
 * container keeps the empty box, and a running one without a sample yet shows a skeleton of the same size.
 * It hides on phones, where the row is narrow.
 */
function SparkCell({
  running,
  pending,
  stat,
}: {
  running: boolean
  pending: boolean
  stat: ContainerStats | undefined
}) {
  let content: ReactNode = null
  if (pending) content = <Skeleton className="size-full rounded-sm" />
  else if (running && stat) content = <Sparkline className="block" values={stat.spark} />
  return <span className="inline-flex h-4 w-12 shrink-0 max-sm:hidden">{content}</span>
}

function cpuText(running: boolean, stat: ContainerStats | undefined): string {
  if (!running) return ''
  if (!stat || stat.cpuPercent === null) return '-'
  return `${stat.cpuPercent.toFixed(1)}%`
}

function memText(running: boolean, stat: ContainerStats | undefined): string {
  if (!running) return ''
  if (!stat) return '-'
  return formatBytes(stat.memUsage)
}

/** How many port badges a row shows before the rest is folded into "+N", so rows keep one height. */
const MAX_PORT_BADGES = 1

/**
 * Only published ports get a badge: a port that is only exposed cannot be reached from the host, and
 * images like RabbitMQ expose many of them. The rest of the published ports fold into "+N".
 */
function shownPorts(ports: readonly ContainerPort[]): { shown: ContainerPort[]; rest: ContainerPort[] } {
  const published = ports.filter((port) => port.public !== undefined)
  return { shown: published.slice(0, MAX_PORT_BADGES), rest: published.slice(MAX_PORT_BADGES) }
}

function portLabel(port: ContainerPort): string {
  const ports = port.public === undefined ? `${port.private}` : `${port.public}→${port.private}`
  return port.type === 'tcp' ? ports : `${ports}/${port.type}`
}

/** "+3", with the folded ports listed in a tooltip. */
function MorePorts({ ports }: { ports: readonly ContainerPort[] }) {
  if (ports.length === 0) return null
  return (
    <Tooltip>
      <TooltipTrigger render={<Badge size="sm" variant="outline" />}>+{ports.length}</TooltipTrigger>
      <TooltipPopup>{ports.map(portLabel).join(', ')}</TooltipPopup>
    </Tooltip>
  )
}

/** `3000→80` for a published port (host→container), `80` for a port that is only exposed. */
function PortBadge({ port }: { port: ContainerPort }) {
  const label = portLabel(port)
  if (port.public !== undefined && port.type === 'tcp') {
    return (
      <Badge
        render={
          <a
            href={`http://localhost:${port.public}`}
            rel="noopener noreferrer"
            target="_blank"
            title={`Open localhost:${port.public} in a new tab`}
          />
        }
        size="sm"
        variant="secondary"
      >
        {label}
      </Badge>
    )
  }
  return (
    <Badge
      size="sm"
      title={port.public === undefined ? 'Exposed to other containers, not published' : 'Published on the host'}
      variant="outline"
    >
      {label}
    </Badge>
  )
}

/** An icon button in a row. A disabled one explains why in its tooltip (the wrapper keeps the tooltip working). */
function IconAction({
  label,
  reason,
  disabled,
  loading,
  onClick,
  children,
}: {
  label: string
  reason?: string
  disabled: boolean
  loading: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button
          aria-label={label}
          disabled={disabled}
          loading={loading}
          onClick={onClick}
          size="icon-sm"
          variant="ghost"
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipPopup>{reason ?? label}</TooltipPopup>
    </Tooltip>
  )
}
