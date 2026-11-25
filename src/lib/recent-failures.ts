import { timeAgo } from './format'
import type { ContainerSummary } from './types'

// Recent failures: the stopped containers worth a look on the dashboard. A stop is a failure only when
// it was not a normal stop (code 0, Ctrl+C, docker stop), it happened in the last day, and it happened
// after the machine last booted (a WSL shutdown stops every container with a non-zero code). Pure
// functions, so they are unit tested with fixtures. The server (failures.server.ts) does the Docker calls.

export interface RecentFailure {
  id: string
  name: string
  /** the short reason on the dashboard row, for example "Stopped with code 1, 2h ago" */
  reason: string
}

/** A stopped container from the list: its exit code and how long ago it stopped (from Docker's status text). */
export interface ExitedCandidate {
  id: string
  name: string
  code: number
  agoMs: number
}

/** What inspect says about a stop: whether the kernel killed it for memory, and when it finished (ISO text). */
export interface StopState {
  oomKilled: boolean
  finishedAt: string | null
}

/** A stop counts only when it is this recent. */
export const FAILURE_WINDOW_MS = 24 * 60 * 60 * 1000
/** 130 (Ctrl+C) and 143 (SIGTERM, which docker stop sends first) are normal stops. Never flagged. */
export const NORMAL_STOP_CODES: readonly number[] = [130, 143]
/** 137 (SIGKILL) is also what docker stop sends after its timeout. Only an out-of-memory kill counts. */
export const KILL_CODE = 137
/** At most this many stopped containers are inspected: the most recent ones. */
export const MAX_INSPECTED = 10
/** How many inspect calls run at once. */
export const INSPECT_CONCURRENCY = 8
export const OOM_REASON = 'Ran out of memory'

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: MINUTE_MS,
  hour: HOUR_MS,
  day: 24 * HOUR_MS,
  week: 7 * 24 * HOUR_MS,
  month: 30 * 24 * HOUR_MS,
  year: 365 * 24 * HOUR_MS,
}

/**
 * How long ago Docker says something happened, as milliseconds: "2 hours ago", "About an hour ago",
 * "Less than a second ago". Null for a text this does not know, so such a stop never counts as recent.
 */
export function agoMsOf(text: string): number | null {
  const value = text.trim().toLowerCase()
  if (value === 'less than a second ago') return 0
  const match = /^(?:about )?(a|an|\d+) (second|minute|hour|day|week|month|year)s? ago$/.exec(value)
  if (!match) return null
  const count = match[1] === 'a' || match[1] === 'an' ? 1 : Number(match[1])
  return count * (UNIT_MS[match[2] ?? ''] ?? 0)
}

/** The exit code and the age of a stopped container, from Docker's status text ("Exited (137) 2 hours ago"). */
export function exitOf(status: string): { code: number; agoMs: number } | null {
  const match = /^Exited \((-?\d+)\) (.+)$/.exec(status)
  if (!match) return null
  const agoMs = agoMsOf(match[2] ?? '')
  if (agoMs === null) return null
  return { code: Number(match[1]), agoMs }
}

/**
 * The stopped containers that could be failures: stopped, a non-zero code that is not a normal stop, and
 * a stop in the last day. The most recent come first, and at most MAX_INSPECTED are kept.
 */
export function exitCandidates(
  containers: readonly Pick<ContainerSummary, 'id' | 'name' | 'state' | 'status'>[],
): ExitedCandidate[] {
  return containers
    .flatMap((container): ExitedCandidate[] => {
      if (container.state !== 'exited') return []
      const exit = exitOf(container.status)
      if (!exit || exit.code === 0 || NORMAL_STOP_CODES.includes(exit.code)) return []
      if (exit.agoMs > FAILURE_WINDOW_MS) return []
      return [{ id: container.id, name: container.name, code: exit.code, agoMs: exit.agoMs }]
    })
    .sort((a, b) => a.agoMs - b.agoMs)
    .slice(0, MAX_INSPECTED)
}

/**
 * The boot time in milliseconds, from the text of /proc/uptime (its first number is the seconds since boot).
 * The file is kernel-wide, so this also works inside a container. Null when it cannot be read.
 */
export function bootTimeFrom(uptimeText: string | null, nowMs: number): number | null {
  if (uptimeText === null) return null
  const first = uptimeText.trim().split(/\s+/)[0] ?? ''
  if (first === '') return null
  const seconds = Number(first)
  if (!Number.isFinite(seconds) || seconds < 0) return null
  return nowMs - seconds * 1000
}

/**
 * True when the stop finished after the last boot. Without a boot time nothing is filtered out. A stop with
 * no readable finish time, when the boot time is known, does not count.
 */
export function finishedAfterBoot(finishedAt: string | null, bootMs: number | null): boolean {
  if (bootMs === null) return true
  const finished = finishedAt ? Date.parse(finishedAt) : Number.NaN
  return Number.isFinite(finished) && finished > bootMs
}

/**
 * The failure to show for one stopped container, or null. A stop before the last boot never counts (the
 * machine went down). An out-of-memory kill is always "Ran out of memory". Another SIGKILL (137) is a
 * normal docker stop after its timeout, so it does not count. Any other code counts with its age.
 */
export function failureOf(
  candidate: ExitedCandidate,
  state: StopState,
  bootMs: number | null,
  nowMs: number,
): RecentFailure | null {
  if (!finishedAfterBoot(state.finishedAt, bootMs)) return null
  if (state.oomKilled) return { id: candidate.id, name: candidate.name, reason: OOM_REASON }
  if (candidate.code === KILL_CODE) return null
  return {
    id: candidate.id,
    name: candidate.name,
    reason: `Stopped with code ${candidate.code}, ${timeAgo(nowMs - candidate.agoMs, nowMs)}`,
  }
}
