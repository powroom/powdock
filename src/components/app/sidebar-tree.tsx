import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import {
  ChevronDownIcon,
  ChevronRightIcon,
  EllipsisIcon,
  PlayIcon,
  RotateCwIcon,
  ScrollTextIcon,
  SquareIcon,
  SquareTerminalIcon,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useContainerActions } from '@/components/containers/use-container-actions'
import {
  ContextMenu,
  ContextMenuItem,
  ContextMenuPopup,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'
import { groupByProject, isRunning } from '@/lib/container-view'
import { containersQuery, idleProjectsQuery } from '@/lib/queries'
import {
  containerLabel,
  containerTone,
  currentProjectOf,
  idleOnly,
  parseNameList,
  projectTone,
  toggleName,
  withName,
} from '@/lib/sidebar-tree'
import type { DotTone } from '@/lib/sidebar-tree'
import type { ContainerAction, ContainerSummary } from '@/lib/types'
import { cn } from '@/lib/utils'

/** The containers are polled every 5 seconds while the tab is visible, as the nav counts are. */
const POLL_MS = 5_000
const GROUPS_KEY = 'powdock.sidebar.groups'
const EXPANDED_KEY = 'powdock.sidebar.expanded'

// name bar widths for the loading list; the rows themselves keep the real height
const SKELETON_ITEM_WIDTHS = ['w-3/5', 'w-1/2', 'w-2/3', 'w-2/5']

const DOT_CLASS: Record<DotTone, string> = {
  success: 'bg-success',
  warning: 'bg-warning',
  muted: 'bg-muted-foreground/40',
}

/** A list in localStorage. Every access is wrapped: storage can be blocked, and the tree works without it. */
function readNames(key: string): string[] | null {
  try {
    return parseNameList(window.localStorage.getItem(key))
  } catch {
    return null
  }
}

function writeNames(key: string, names: readonly string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(names))
  } catch {
    // Not saved: the defaults apply again on the next visit.
  }
}

function useStoredNames(key: string): [string[] | null, (next: string[]) => void] {
  const [value, setValue] = useState<string[] | null>(() => readNames(key))
  const update = (next: string[]) => {
    setValue(next)
    writeNames(key, next)
  }
  return [value, update]
}

type Tools = {
  act: (container: ContainerSummary, action: ContainerAction) => void
  closeSheet: () => void
}

type MenuEntry = { label: string; icon: typeof PlayIcon; onClick: () => void } | 'separator'

function Dot({ tone }: { tone: DotTone }) {
  return <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', DOT_CLASS[tone])} />
}

function TreeGroup({
  id,
  label,
  count,
  closed,
  onToggle,
  children,
}: {
  id: string
  label: string
  count?: number
  closed: readonly string[]
  onToggle: (id: string) => void
  children: ReactNode
}) {
  const open = !closed.includes(id)
  return (
    <SidebarGroup className="py-1">
      <SidebarGroupLabel
        aria-expanded={open}
        className="h-7 w-full cursor-pointer gap-1 font-medium text-[0.7rem] text-sidebar-foreground/80 uppercase tracking-wider hover:text-sidebar-accent-foreground [&>svg]:size-3.5"
        onClick={() => onToggle(id)}
        render={<button type="button" />}
      >
        {open ? (
          <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-60" />
        ) : (
          <ChevronRightIcon aria-hidden="true" className="size-3.5 opacity-60" />
        )}
        {label}
        {count !== undefined && (
          // lines up with the "⋯" buttons of the rows below
          <span className="ms-auto me-5 font-normal tabular-nums tracking-normal opacity-70">{count}</span>
        )}
      </SidebarGroupLabel>
      {open && <SidebarGroupContent>{children}</SidebarGroupContent>}
    </SidebarGroup>
  )
}

/** One container: a link with its state dot, a "⋯" menu on hover and the same menu on right click. */
function ContainerEntry({
  container,
  label,
  sub,
  active,
  tools,
}: {
  container: ContainerSummary
  label: string
  sub: boolean
  active: boolean
  tools: Tools
}) {
  const navigate = useNavigate()
  const { act, closeSheet } = tools
  const running = isRunning(container)
  const go = (search: { tab?: 'terminal' }) => {
    closeSheet()
    void navigate({ to: '/containers/$id', params: { id: container.id }, search })
  }
  const run = (action: ContainerAction) => () => {
    closeSheet()
    act(container, action)
  }

  // A pow/dock container never offers Stop or Restart: it would stop the page the user is on.
  const lifecycle: MenuEntry[] = running
    ? container.isSelf
      ? []
      : [
          { label: 'Stop', icon: SquareIcon, onClick: run('stop') },
          { label: 'Restart', icon: RotateCwIcon, onClick: run('restart') },
        ]
    : [{ label: 'Start', icon: PlayIcon, onClick: run('start') }]
  const entries: MenuEntry[] = [
    { label: 'Logs', icon: ScrollTextIcon, onClick: () => go({}) },
    ...(running ? [{ label: 'Terminal', icon: SquareTerminalIcon, onClick: () => go({ tab: 'terminal' }) }] : []),
    ...(lifecycle.length > 0 ? ['separator' as const, ...lifecycle] : []),
  ]

  const Item = sub ? SidebarMenuSubItem : SidebarMenuItem
  const Button = sub ? SidebarMenuSubButton : SidebarMenuButton
  return (
    <Item>
      <ContextMenu>
        <ContextMenuTrigger
          render={
            <Button
              className={sub ? 'h-6 gap-2 pe-7 sm:h-6' : 'pe-7'}
              isActive={active}
              onClick={closeSheet}
              render={<Link params={{ id: container.id }} to="/containers/$id" />}
              size="sm"
              title={container.name}
            />
          }
        >
          <Dot tone={containerTone(container)} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
        </ContextMenuTrigger>
        <ContextMenuPopup>
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              <ContextMenuSeparator key={`separator-${i}`} />
            ) : (
              <ContextMenuItem key={entry.label} onClick={entry.onClick}>
                <entry.icon aria-hidden="true" />
                {entry.label}
              </ContextMenuItem>
            ),
          )}
        </ContextMenuPopup>
      </ContextMenu>
      <Menu>
        <MenuTrigger
          render={
            <SidebarMenuAction
              aria-label={`Actions for ${container.name}`}
              className={cn(
                'data-popup-open:opacity-100',
                // Shown on hover of its own row. A sub item sits inside its project's menu item, so the
                // project's hover must not reveal every row: sub items use their own group.
                sub
                  ? 'top-0.5 group-focus-within/menu-sub-item:opacity-100 group-hover/menu-sub-item:opacity-100 md:opacity-0'
                  : 'group-focus-within/menu-item:opacity-100 group-hover/menu-item:opacity-100 md:opacity-0',
              )}
            />
          }
        >
          <EllipsisIcon />
        </MenuTrigger>
        <MenuPopup align="start" side="right">
          {entries.map((entry, i) =>
            entry === 'separator' ? (
              <MenuSeparator key={`separator-${i}`} />
            ) : (
              <MenuItem key={entry.label} onClick={entry.onClick}>
                <entry.icon aria-hidden="true" />
                {entry.label}
              </MenuItem>
            ),
          )}
        </MenuPopup>
      </Menu>
    </Item>
  )
}

/** A Compose project: a link with its state dot, the running count, and a chevron that shows its containers. */
function ProjectItem({
  name,
  containers,
  idle,
  expanded,
  active,
  onToggle,
  tools,
  pageContainerId,
}: {
  name: string
  containers: ContainerSummary[]
  idle: boolean
  expanded: boolean
  active: boolean
  onToggle: () => void
  tools: Tools
  pageContainerId: string | undefined
}) {
  const running = containers.filter(isRunning).length
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="ps-7 pe-10"
        isActive={active}
        onClick={tools.closeSheet}
        render={<Link params={{ name }} to="/projects/$name" />}
        size="sm"
      >
        <Dot tone={projectTone(containers)} />
        <span className="min-w-0 flex-1 truncate">{name}</span>
      </SidebarMenuButton>
      {idle ? null : (
        <>
          <SidebarMenuAction
            aria-expanded={expanded}
            aria-label={`${expanded ? 'Hide' : 'Show'} containers of ${name}`}
            className="left-1 right-auto data-popup-open:opacity-100"
            onClick={onToggle}
          >
            {expanded ? (
              <ChevronDownIcon aria-hidden="true" className="size-3.5 opacity-70" />
            ) : (
              <ChevronRightIcon aria-hidden="true" className="size-3.5 opacity-70" />
            )}
          </SidebarMenuAction>
          <SidebarMenuBadge className="tabular-nums text-muted-foreground">
            {running}/{containers.length}
          </SidebarMenuBadge>
        </>
      )}
      {expanded && containers.length > 0 && (
        <SidebarMenuSub className="me-0 gap-px pe-0">
          {containers.map((container) => (
            <ContainerEntry
              active={container.id === pageContainerId}
              container={container}
              key={container.id}
              label={containerLabel(container)}
              sub
              tools={tools}
            />
          ))}
        </SidebarMenuSub>
      )}
    </SidebarMenuItem>
  )
}

function TreeSkeleton() {
  return (
    <SidebarGroup aria-busy="true" className="py-1">
      <span className="sr-only">Loading containers</span>
      <SidebarGroupLabel className="h-7 w-full gap-1 text-[0.7rem] tracking-wider">
        <Skeleton className="h-2.5 w-14" />
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-px">
          {SKELETON_ITEM_WIDTHS.map((width, i) => (
            <SidebarMenuItem key={i}>
              <div className="flex h-7 w-full items-center gap-2 overflow-hidden rounded-lg p-2 text-sm">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <Skeleton className={cn('h-3', width)} />
              </div>
            </SidebarMenuItem>
          ))}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}

/** The project and container tree under the nav: the Compose projects, then the containers without one. */
export function SidebarTree() {
  const containers = useQuery({ ...containersQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const idle = useQuery(idleProjectsQuery())
  const params = useParams({ strict: false }) as { name?: string; id?: string }
  const { isMobile, setOpenMobile } = useSidebar()
  const { act } = useContainerActions()
  const [closedGroups, setClosedGroups] = useStoredNames(GROUPS_KEY)
  const [expandedStored, setExpandedStored] = useStoredNames(EXPANDED_KEY)

  // On phones the sidebar is a sheet: close it once a link or menu item has been used.
  const closeSheet = () => {
    if (isMobile) setOpenMobile(false)
  }
  const tools: Tools = { act, closeSheet }
  const toggleGroup = (id: string) => setClosedGroups(toggleName(closedGroups ?? [], id))
  const expanded = expandedStored ?? []
  const pageProject = currentProjectOf({ projectName: params.name, containerId: params.id }, containers.data ?? [])

  // Opening a project, or one of its containers, shows that project's containers in the tree. Only
  // once per page, so the user can still close it while it is open.
  const handledPage = useRef<string | null>(null)
  useEffect(() => {
    if (pageProject === handledPage.current) return
    handledPage.current = pageProject
    const current = expandedStored ?? []
    const next = withName(current, pageProject)
    if (next !== current) setExpandedStored([...next])
  }, [pageProject, expandedStored, setExpandedStored])

  if (containers.isError) {
    return <p className="px-2 py-2 text-muted-foreground text-xs">Could not load containers.</p>
  }
  if (containers.isPending) {
    return <TreeSkeleton />
  }

  const groups = groupByProject(containers.data)
  const projects = groups.filter((group) => group.isProject)
  const loose = groups.find((group) => !group.isProject)?.containers ?? []
  const idleList = idleOnly(
    idle.data?.projects ?? [],
    projects.map((group) => group.key),
  )
  const closed = closedGroups ?? []

  if (projects.length === 0 && idleList.length === 0 && loose.length === 0) return null

  return (
    <>
      {(projects.length > 0 || idleList.length > 0) && (
        <TreeGroup
          closed={closed}
          count={projects.length + idleList.length}
          id="projects"
          label="Projects"
          onToggle={toggleGroup}
        >
          <SidebarMenu className="gap-px">
            {projects.map((group) => (
              <ProjectItem
                active={params.name === group.key}
                containers={group.containers}
                expanded={expanded.includes(group.key)}
                idle={false}
                key={group.key}
                name={group.key}
                onToggle={() => setExpandedStored(toggleName(expanded, group.key))}
                pageContainerId={params.id}
                tools={tools}
              />
            ))}
            {idleList.map((project) => (
              <ProjectItem
                active={params.name === project.name}
                containers={[]}
                expanded={false}
                idle
                key={`idle-${project.name}`}
                name={project.name}
                onToggle={() => undefined}
                pageContainerId={params.id}
                tools={tools}
              />
            ))}
          </SidebarMenu>
        </TreeGroup>
      )}
      {loose.length > 0 && (
        <TreeGroup closed={closed} count={loose.length} id="containers" label="Containers" onToggle={toggleGroup}>
          <SidebarMenu className="gap-px">
            {loose.map((container) => (
              <ContainerEntry
                active={container.id === params.id}
                container={container}
                key={container.id}
                label={container.name}
                sub={false}
                tools={tools}
              />
            ))}
          </SidebarMenu>
        </TreeGroup>
      )}
    </>
  )
}
