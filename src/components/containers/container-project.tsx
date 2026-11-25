import { Link } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  FolderOpenIcon,
  MoreHorizontalIcon,
  PlayIcon,
  RotateCwIcon,
  SquareIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Frame, FrameHeader, FramePanel } from '@/components/ui/frame'
import { Menu, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { bulkTargets } from '@/lib/container-view'
import type { BulkAction, ProjectGroup } from '@/lib/container-view'
import type { ContainerSummary } from '@/lib/types'
import { ContainerRow } from './container-row'
import type { RowHandlers } from './container-row'

/** One section of the list: a header with the collapse toggle and the project menu, then the rows. */
export function ContainerProject({
  group,
  shown,
  collapsed,
  onToggle,
  onBulk,
  rows,
}: {
  group: ProjectGroup
  /** the rows that pass the search and the filter */
  shown: readonly ContainerSummary[]
  collapsed: boolean
  onToggle: (key: string) => void
  onBulk: (containers: readonly ContainerSummary[], action: BulkAction) => void
  rows: RowHandlers
}) {
  const total = group.containers.length
  return (
    <Frame>
      <FrameHeader className="flex-row items-center gap-2 px-2 py-1.5">
        <Button
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${group.title}`}
          onClick={() => onToggle(group.key)}
          size="icon-xs"
          variant="ghost"
        >
          {collapsed ? <ChevronRightIcon aria-hidden="true" /> : <ChevronDownIcon aria-hidden="true" />}
        </Button>
        <h2 className="min-w-0 truncate font-medium text-sm">
          {group.isProject ? (
            <Link
              className="rounded-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              params={{ name: group.key }}
              to="/projects/$name"
            >
              {group.title}
            </Link>
          ) : (
            group.title
          )}
        </h2>
        <Badge size="sm" variant="secondary">
          {group.running}/{total} running
        </Badge>
        {group.isProject && (
          <div className="ms-auto">
            <ProjectMenu group={group} onBulk={onBulk} />
          </div>
        )}
      </FrameHeader>
      {!collapsed && (
        <FramePanel className="overflow-hidden p-0">
          {shown.map((container) => (
            <ContainerRow container={container} handlers={rows} key={container.id} />
          ))}
        </FramePanel>
      )}
    </Frame>
  )
}

/** Start, stop and restart for every container of the project. Each one runs in order. */
function ProjectMenu({
  group,
  onBulk,
}: {
  group: ProjectGroup
  onBulk: (containers: readonly ContainerSummary[], action: BulkAction) => void
}) {
  const start = bulkTargets(group.containers, 'start')
  const stop = bulkTargets(group.containers, 'stop')
  const restart = bulkTargets(group.containers, 'restart')
  return (
    <Menu>
      <MenuTrigger render={<Button aria-label={`Actions for ${group.title}`} size="icon-xs" variant="ghost" />}>
        <MoreHorizontalIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="end">
        <MenuItem disabled={start.length === 0} onClick={() => onBulk(start, 'start')}>
          <PlayIcon aria-hidden="true" />
          Start all
        </MenuItem>
        <MenuItem disabled={stop.length === 0} onClick={() => onBulk(stop, 'stop')}>
          <SquareIcon aria-hidden="true" />
          Stop all
        </MenuItem>
        <MenuItem disabled={restart.length === 0} onClick={() => onBulk(restart, 'restart')}>
          <RotateCwIcon aria-hidden="true" />
          Restart all
        </MenuItem>
        <MenuSeparator />
        <MenuLinkItem render={<Link params={{ name: group.key }} to="/projects/$name" />}>
          <FolderOpenIcon aria-hidden="true" />
          Open project
        </MenuLinkItem>
      </MenuPopup>
    </Menu>
  )
}
