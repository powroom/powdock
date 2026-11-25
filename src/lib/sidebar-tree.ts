import { isRunning } from '@/lib/container-view'
import type { ContainerSummary } from '@/lib/types'

// Pure helpers for the sidebar tree: the state dots, which projects are open, and what the stored
// choices mean. No React or storage here, so they are unit tested with plain fixtures.

export type DotTone = 'success' | 'warning' | 'muted'

type Stateful = Pick<ContainerSummary, 'state'>

/** Green while the container runs, amber while it is paused or restarting, grey otherwise. */
export function containerTone(container: Stateful): DotTone {
  if (isRunning(container)) return 'success'
  if (container.state === 'paused' || container.state === 'restarting') return 'warning'
  return 'muted'
}

/** Green when any container runs, grey when none runs. The "2/3" count beside it tells the rest. */
export function projectTone(containers: readonly Stateful[]): DotTone {
  return containers.some(isRunning) ? 'success' : 'muted'
}

/** The text beside a container in its project: the Compose service, or the container name. */
export function containerLabel(container: Pick<ContainerSummary, 'name' | 'service'>): string {
  return container.service || container.name
}

/** The list after the user opens or closes one project. */
export function toggleName(list: readonly string[], name: string): string[] {
  return list.includes(name) ? list.filter((item) => item !== name) : [...list, name]
}

/**
 * The list with the project of the open page added, so opening a project or one of its containers
 * shows it in the tree. The user can close it again; it opens on the next visit to that project.
 */
export function withName(list: readonly string[], name: string | null): readonly string[] {
  return name === null || list.includes(name) ? list : [...list, name]
}

/** Reads a stored JSON array of strings. Null when nothing is stored or the text is not such an array. */
export function parseNameList(raw: string | null): string[] | null {
  if (raw === null) return null
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return null
    return parsed.filter((item): item is string => typeof item === 'string')
  } catch {
    return null
  }
}

/** The project of the open page: the project route's name, or the project of the open container. */
export function currentProjectOf(
  page: { projectName?: string; containerId?: string },
  containers: readonly ContainerSummary[],
): string | null {
  if (page.projectName) return page.projectName
  if (!page.containerId) return null
  const container = containers.find((item) => item.id === page.containerId)
  return container?.project ?? null
}

/** The remembered projects that have no containers now. A project with containers is listed from the container list. */
export function idleOnly<T extends { name: string }>(idle: readonly T[], listed: readonly string[]): T[] {
  const names = new Set(listed)
  return idle.filter((project) => !names.has(project.name))
}
