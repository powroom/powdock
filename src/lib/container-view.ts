import type { ContainerAction, ContainerState, ContainerSummary } from '@/lib/types'

// Pure helpers for the containers page: what to show, how to group it, and which containers a bulk
// action on a project should touch. No React here, so they are unit tested with plain fixtures.

export type StateFilter = 'all' | 'running' | 'stopped'

/** The group key of the containers without a Compose project. Project names are never empty. */
export const OTHER_GROUP = ''
export const OTHER_GROUP_TITLE = 'Other containers'

export interface ProjectGroup {
  /** the Compose project name, or OTHER_GROUP */
  key: string
  title: string
  /** false for the "Other containers" group, which has no bulk menu */
  isProject: boolean
  /** sorted by name, so the rows keep their place while the list refreshes */
  containers: ContainerSummary[]
  running: number
}

export function isRunning(container: Pick<ContainerSummary, 'state'>): boolean {
  return container.state === 'running'
}

/** States with a live process: stop and kill apply, and removing needs force. */
export function isActiveState(state: ContainerState): boolean {
  return state === 'running' || state === 'paused' || state === 'restarting'
}

export function matchesFilter(container: Pick<ContainerSummary, 'state'>, filter: StateFilter): boolean {
  if (filter === 'running') return isRunning(container)
  if (filter === 'stopped') return !isRunning(container)
  return true
}

/** Case-insensitive match on the name, image, project and service. An empty query matches all. */
export function matchesSearch(container: ContainerSummary, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [container.name, container.image, container.project, container.service].some((value) =>
    (value ?? '').toLowerCase().includes(needle),
  )
}

export function countByFilter(containers: readonly ContainerSummary[]): Record<StateFilter, number> {
  const running = containers.filter(isRunning).length
  return { all: containers.length, running, stopped: containers.length - running }
}

/** Compose projects with running containers first, then the others, each by name; then the containers without a project. */
export function groupByProject(containers: readonly ContainerSummary[]): ProjectGroup[] {
  const byKey = new Map<string, ContainerSummary[]>()
  for (const container of containers) {
    const key = container.project ?? OTHER_GROUP
    const list = byKey.get(key)
    if (list) list.push(container)
    else byKey.set(key, [container])
  }
  const groups = [...byKey].map(([key, members]): ProjectGroup => {
    const sorted = [...members].sort((a, b) => a.name.localeCompare(b.name))
    return {
      key,
      title: key === OTHER_GROUP ? OTHER_GROUP_TITLE : key,
      isProject: key !== OTHER_GROUP,
      containers: sorted,
      running: sorted.filter(isRunning).length,
    }
  })
  return groups.sort((a, b) => {
    if (a.key === OTHER_GROUP) return 1
    if (b.key === OTHER_GROUP) return -1
    // what is running now is what people look for first
    const active = Number(b.running > 0) - Number(a.running > 0)
    return active || a.title.localeCompare(b.title)
  })
}

export type BulkAction = Extract<ContainerAction, 'start' | 'stop' | 'restart'>

/**
 * The containers a project-wide action changes. Start: every stopped one. Stop: every one with a live
 * process. Restart: every running one. pow/dock's own container is always left out of stop and restart.
 */
export function bulkTargets(containers: readonly ContainerSummary[], action: BulkAction): ContainerSummary[] {
  return containers.filter((container) => {
    if (action === 'start') return !isRunning(container)
    if (container.isSelf) return false
    if (action === 'stop') return isActiveState(container.state)
    return isRunning(container)
  })
}

/**
 * The containers the command palette offers for a query: running and stopped alike, matched on the name.
 * Names that start with the query come first, then names that contain it. At most `limit` are returned.
 * An empty query returns none, so the palette shows containers only once someone types.
 */
export function paletteMatches(containers: readonly ContainerSummary[], query: string, limit = 8): ContainerSummary[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const rank = (container: ContainerSummary): number => {
    const name = container.name.toLowerCase()
    if (name.startsWith(needle)) return 0
    return name.includes(needle) ? 1 : 2
  }
  return containers
    .filter((container) => rank(container) < 2)
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
    .slice(0, limit)
}
