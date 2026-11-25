import type { RecentFailure } from './recent-failures'
import type { ContainerStats, ContainerSummary } from './types'

// The "Needs attention" list of the dashboard: which containers need a look, and why. Pure functions,
// so they are unit tested with fixtures. Each container shows at most one reason: the first that applies,
// in the order of ATTENTION_ORDER. Stopped containers come from the server's recent failures (which already
// skip normal stops, old stops and stops before the last boot).

export type AttentionKind = 'unhealthy' | 'restarting' | 'exited' | 'memory'

export interface AttentionItem {
  id: string
  name: string
  kind: AttentionKind
  /** the short reason on the row, for example "Ran out of memory" */
  reason: string
}

/** The rows the dashboard shows before "+N more". */
export const ATTENTION_ROWS = 5
/** Memory above this share of the container's own limit needs attention. */
export const MEMORY_ATTENTION_RATIO = 0.9

const ATTENTION_ORDER: readonly AttentionKind[] = ['unhealthy', 'restarting', 'exited', 'memory']

/**
 * The reason a container needs attention, or null. `failure` is the server's recent failure of this
 * container, and it counts only while the container is stopped. `hostMemory` is the memory of the machine
 * in bytes; the memory check runs only for a container with its own limit below it, and only when it is known.
 */
export function reasonOf(
  container: Pick<ContainerSummary, 'state' | 'status'>,
  stats: Pick<ContainerStats, 'memUsage' | 'memLimit'> | undefined,
  hostMemory: number | null,
  failure: RecentFailure | undefined,
): { kind: AttentionKind; reason: string } | null {
  if (container.status.includes('(unhealthy)')) return { kind: 'unhealthy', reason: 'Unhealthy' }
  if (container.state === 'restarting') return { kind: 'restarting', reason: 'Keeps restarting' }
  if (container.state === 'exited' && failure) return { kind: 'exited', reason: failure.reason }
  if (stats && hostMemory !== null && stats.memLimit > 0 && stats.memLimit < hostMemory) {
    const ratio = stats.memUsage / stats.memLimit
    if (ratio > MEMORY_ATTENTION_RATIO) {
      return { kind: 'memory', reason: `Memory ${Math.round(ratio * 100)}% of limit` }
    }
  }
  return null
}

/** Every container that needs attention: the most urgent first, then by name, one reason per container. */
export function attentionItems(
  containers: readonly ContainerSummary[],
  stats: readonly ContainerStats[],
  hostMemory: number | null,
  failures: readonly RecentFailure[],
): AttentionItem[] {
  const statsById = new Map(stats.map((stat) => [stat.id, stat]))
  const failuresById = new Map(failures.map((failure) => [failure.id, failure]))
  const items = containers.flatMap((container): AttentionItem[] => {
    const found = reasonOf(container, statsById.get(container.id), hostMemory, failuresById.get(container.id))
    return found ? [{ id: container.id, name: container.name, ...found }] : []
  })
  return items.sort(
    (a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind) || a.name.localeCompare(b.name),
  )
}
