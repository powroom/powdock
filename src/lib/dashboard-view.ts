import { countLabel, formatBytes } from './format'
import type { ContainerStats, ContainerSummary, EngineInfo, TotalsSample } from './types'

// Pure helpers for the dashboard: the CPU share of the whole machine, the busiest containers, the footer
// line and the volume size total. No React here, so they are unit tested with plain fixtures.

/** How many containers the "Busiest containers" card lists. */
export const BUSIEST_ROWS = 5

/**
 * The CPU of all containers as a share of the whole machine, 0 to 100. The sampler sums the containers' CPU
 * per core (100 means one full core), so the sum is divided by the number of CPUs. Null stays null.
 */
export function machineCpuPercent(percentPerCore: number | null, cpus: number): number | null {
  if (percentPerCore === null || cpus <= 0) return null
  return percentPerCore / cpus
}

/** The CPU values of the usage chart, as a share of the machine. */
export function machineCpuSeries(totals: readonly TotalsSample[], cpus: number): (number | null)[] {
  return totals.map((total) => machineCpuPercent(total.cpu, cpus))
}

export interface BusyRow {
  container: ContainerSummary
  /** null until the sampler has a sample of the container */
  stat: ContainerStats | null
}

/**
 * The running containers with the highest CPU, highest first. A container with no CPU value yet counts as the
 * lowest, and ties are sorted by name. Only the first `limit` rows are returned.
 */
export function busiestRows(
  containers: readonly ContainerSummary[],
  stats: readonly ContainerStats[],
  limit: number = BUSIEST_ROWS,
): BusyRow[] {
  const statsById = new Map(stats.map((stat) => [stat.id, stat]))
  return containers
    .filter((container) => container.state === 'running')
    .map((container) => ({ container, stat: statsById.get(container.id) ?? null }))
    .sort(
      (a, b) =>
        (b.stat?.cpuPercent ?? -1) - (a.stat?.cpuPercent ?? -1) || a.container.name.localeCompare(b.container.name),
    )
    .slice(0, limit)
}

/** The footer line: "Docker 29.8.0 · Ubuntu 24.04.3 LTS · 12 CPUs · 7.8 GB". */
export function engineLine(engine: EngineInfo): string {
  return [`Docker ${engine.version}`, engine.os, countLabel(engine.cpus, 'CPU'), formatBytes(engine.memTotal)]
    .filter((part) => part.length > 0)
    .join(' · ')
}

/** The total size of the volumes whose size is known. Unknown sizes (null) add nothing. */
export function volumeSizeTotal(sizes: Readonly<Record<string, number | null>>): number {
  return Object.values(sizes).reduce<number>((total, size) => total + (size ?? 0), 0)
}
