import { readFileSync } from 'node:fs'
import { bootTimeFrom, exitCandidates, failureOf, INSPECT_CONCURRENCY, type RecentFailure } from '@/lib/recent-failures'
import { createTtlCache } from '@/lib/ttl-cache'
import { inspectStopState, mapLimit } from './docker.server'
import { listContainers } from './docker-cache.server'

// The dashboard's recent failures: a few stopped containers are inspected for their out-of-memory flag and
// their finish time. The answer is kept for 30 seconds, so the dashboard never inspects on every poll.

const FAILURES_TTL_MS = 30_000
const UPTIME_PATH = '/proc/uptime'

/** The text of /proc/uptime, or null when it cannot be read (then no boot filter is applied). */
function readUptime(): string | null {
  try {
    return readFileSync(UPTIME_PATH, 'utf8')
  } catch {
    return null
  }
}

const cachedFailures = createTtlCache<RecentFailure[]>(FAILURES_TTL_MS)

/** The stops worth a look on the dashboard: out-of-memory kills and non-zero codes after the last boot. */
export function recentFailures(): Promise<RecentFailure[]> {
  return cachedFailures(async () => {
    const now = Date.now()
    const candidates = exitCandidates(await listContainers())
    const bootMs = bootTimeFrom(readUptime(), now)
    const states = await mapLimit(candidates, INSPECT_CONCURRENCY, (candidate) => inspectStopState(candidate.id))
    return candidates.flatMap((candidate, index) => {
      const state = states[index]
      if (!state) return []
      const failure = failureOf(candidate, state, bootMs, now)
      return failure ? [failure] : []
    })
  })
}
