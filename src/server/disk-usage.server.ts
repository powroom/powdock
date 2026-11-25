import type { DiskUsage, DiskUsageState } from '@/lib/types'
import { readDiskUsage } from './cleanup.server'
import { diskGeneration } from './docker-cache.server'

/**
 * The disk usage (GET /system/df) takes about 3 seconds on a busy host, and the dashboard and the Cleanup
 * page both read it. The last answer is kept for 60 seconds, and reads that come together share one call.
 *
 * When the answer is stale (older than 60 seconds, or a container, image or volume was destroyed, or an
 * action such as a prune changed things), the previous answer is returned at once with `refreshing: true`,
 * and Docker is read again in the background. So the pages never go back to a skeleton after the first load.
 * A forced read (the Refresh button) always waits for a new answer.
 */

export const DISK_USAGE_TTL_MS = 60_000

/**
 * What a read does:
 * - `load`: wait for a new answer (there is none yet, or the read is forced).
 * - `serve`: the answer is fresh; return it.
 * - `refresh`: the answer is stale; return it now, and read again in the background.
 */
export type DiskUsageAction = 'load' | 'serve' | 'refresh'

export interface DiskUsageDecisionInput {
  /** false before the first answer */
  hasValue: boolean
  /** when the read that made the answer started (ms) */
  builtAt: number
  /** the disk generation when that read started */
  builtGeneration: number
  /** the disk generation now */
  generation: number
  now: number
  ttlMs: number
  /** true for the Refresh button */
  force: boolean
}

/** The pure decision: wait, serve the fresh answer, or serve the stale one and refresh it. */
export function decideDiskUsage(input: DiskUsageDecisionInput): DiskUsageAction {
  if (input.force || !input.hasValue) return 'load'
  const fresh = input.builtGeneration === input.generation && input.now - input.builtAt < input.ttlMs
  return fresh ? 'serve' : 'refresh'
}

interface Entry {
  usage: DiskUsage
  builtAt: number
  generation: number
  /** the order of the read that made it: an older read never replaces a newer answer */
  seq: number
}

interface Flight {
  generation: number
  promise: Promise<DiskUsage>
}

let entry: Entry | null = null
let flight: Flight | null = null
let lastSeq = 0

/** Starts one read of Docker. It becomes the answer when no newer read has finished before it. */
function startFlight(generation: number): Promise<DiskUsage> {
  lastSeq = lastSeq + 1
  const seq = lastSeq
  const startedAt = Date.now()
  const promise = readDiskUsage().then((usage) => {
    if (entry === null || seq > entry.seq) entry = { usage, builtAt: startedAt, generation, seq }
    return usage
  })
  const current: Flight = { generation, promise }
  flight = current
  const clear = () => {
    if (flight === current) flight = null
  }
  promise.then(clear, clear)
  return promise
}

/**
 * The disk usage for a read. `force` is true for the Refresh button. `refreshing` is true while a read of
 * Docker runs, and the numbers are then the previous answer.
 */
export async function diskUsageState(force: boolean): Promise<DiskUsageState> {
  const generation = diskGeneration()
  const current = entry
  const action = decideDiskUsage({
    hasValue: current !== null,
    builtAt: current?.builtAt ?? 0,
    builtGeneration: current?.generation ?? -1,
    generation,
    now: Date.now(),
    ttlMs: DISK_USAGE_TTL_MS,
    force,
  })

  if (action === 'load' || current === null) {
    // A read that is running is shared, unless a forced read needs a newer one than it started with.
    const running = flight
    const shared = running !== null && (!force || running.generation === generation)
    const usage = await (shared && running ? running.promise : startFlight(generation))
    return { ...usage, refreshing: false }
  }

  if (action === 'refresh' && flight === null) startFlight(generation)
  return { ...current.usage, refreshing: flight !== null }
}
