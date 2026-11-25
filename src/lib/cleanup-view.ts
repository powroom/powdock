import { countLabel, formatBytes } from './format'
import type { DiskUsage, PruneResult } from './types'

// Pure helpers for the Cleanup page: the segments of the usage bar, the totals, the share of each part,
// and the text of the result toast. No React here, so they are unit tested.

/** Container states that Docker keeps running. Every other state counts as stopped, as Docker's prune does. */
const RUNNING_STATES = ['running', 'paused', 'restarting']

/** True when a container is stopped, so a container prune removes it. */
export function isStoppedState(state: string): boolean {
  return !RUNNING_STATES.includes(state)
}

export interface UsageSegment {
  key: 'images' | 'containers' | 'volumes' | 'buildCache'
  label: string
  bytes: number
}

/** The four parts of the usage bar, in the order the bar draws them. */
export function usageSegments(usage: DiskUsage): UsageSegment[] {
  return [
    { key: 'images', label: 'Images', bytes: usage.images.total },
    { key: 'containers', label: 'Containers', bytes: usage.containers.size },
    { key: 'volumes', label: 'Volumes', bytes: usage.volumes.total },
    { key: 'buildCache', label: 'Build cache', bytes: usage.buildCache.total },
  ]
}

/** All the disk Docker uses: the sum of the four parts. */
export function totalUse(usage: DiskUsage): number {
  return usageSegments(usage).reduce((sum, segment) => sum + segment.bytes, 0)
}

/** About how much can be freed: unused images, stopped containers, unused volumes and reclaimable build cache. */
export function totalReclaimable(usage: DiskUsage): number {
  return usage.images.unused + usage.containers.stoppedSize + usage.volumes.unused + usage.buildCache.reclaimable
}

/** True when no cleanup action would remove anything: no dangling or unused image, stopped container, unused volume, reclaimable build cache or unused network. */
export function nothingToClean(usage: DiskUsage): boolean {
  return (
    usage.images.danglingCount === 0 &&
    usage.images.unusedCount === 0 &&
    usage.containers.stoppedCount === 0 &&
    usage.volumes.unusedCount === 0 &&
    usage.volumes.anonymousUnusedCount === 0 &&
    usage.buildCache.reclaimableCount === 0 &&
    usage.unusedNetworks === 0
  )
}

/** A part as a percentage of the total, 0 when the total is 0. */
export function shareOf(bytes: number, total: number): number {
  if (total <= 0) return 0
  return (bytes / total) * 100
}

/** The toast after a prune. `noun` is the singular name of what was removed, for example "image". */
export function pruneToast(
  result: PruneResult,
  noun: string,
): { type: 'success' | 'info'; title: string; description?: string } {
  if (result.removed === 0 && result.spaceReclaimed === 0) return { type: 'info', title: 'Nothing to remove' }
  if (result.spaceReclaimed > 0) {
    return {
      type: 'success',
      title: `Freed ${formatBytes(result.spaceReclaimed)}`,
      description: `${countLabel(result.removed, noun)} removed`,
    }
  }
  return { type: 'success', title: `Removed ${countLabel(result.removed, noun)}` }
}
