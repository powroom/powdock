import type { ContainerStats, StatsSample, TotalsSample } from '@/lib/types'
import { listRunningIds } from './docker-cache.server'
import {
  cpuPercentFrom,
  cpuSampleOf,
  fetchRawStats,
  mapLimit,
  memoryOf,
  type CpuSample,
  type RawStats,
} from './docker.server'

/**
 * Keeps a short history of the CPU, memory, network and disk I/O of the running containers.
 *
 * The sampler runs only on demand. Every read marks the time of its demand. A timer takes a sample
 * every 2 seconds while the demand is recent, and it stops when nobody has read for 30 seconds. The
 * next read starts it again. Everything that touches the clock, the timer or Docker is passed in, so
 * the tests can run the loop by hand with fakes (see stats-sampler.test.ts).
 */

export const SAMPLE_INTERVAL_MS = 2000
/** 150 samples at 2 seconds: the last five minutes. */
export const RING_SIZE = 150
/** The CPU values a sparkline shows. */
export const SPARK_LENGTH = 30
/** The loop stops when nobody has read the stats for this long. */
export const IDLE_STOP_MS = 30_000
/** At most this many stats calls run at the same time. */
export const SAMPLE_CONCURRENCY = 8

/** The raw counters of one sample. The next sample uses them to compute the rates. */
export interface RawPoint {
  t: number
  cpu: CpuSample
  rx: number
  tx: number
  read: number
  write: number
}

export interface Counter {
  t: number
  value: number
}

/**
 * The rate per second between two counter readings. Null without an earlier reading or when the time
 * did not move. A counter that went backwards (an interface or a container restarted) gives 0.
 */
export function counterRate(previous: Counter | undefined, current: Counter): number | null {
  if (!previous) return null
  const seconds = (current.t - previous.t) / 1000
  if (seconds <= 0) return null
  if (current.value < previous.value) return 0
  return (current.value - previous.value) / seconds
}

/** The received and sent bytes of all networks of a container (summed). */
export function networkTotals(raw: RawStats): { rx: number; tx: number } {
  let rx = 0
  let tx = 0
  for (const network of Object.values(raw.networks ?? {})) {
    rx += network.rx_bytes ?? 0
    tx += network.tx_bytes ?? 0
  }
  return { rx, tx }
}

/** The read and written bytes of a container's block devices (summed). The op names differ by cgroup version. */
export function blockIoTotals(raw: RawStats): { read: number; write: number } {
  let read = 0
  let write = 0
  for (const entry of raw.blkio_stats?.io_service_bytes_recursive ?? []) {
    const op = (entry.op ?? '').toLowerCase()
    if (op === 'read') read += entry.value ?? 0
    else if (op === 'write') write += entry.value ?? 0
  }
  return { read, write }
}

/** The raw counters of one stats response, taken at time t. */
export function pointOf(raw: RawStats, t: number): RawPoint {
  const net = networkTotals(raw)
  const blk = blockIoTotals(raw)
  return { t, cpu: cpuSampleOf(raw), rx: net.rx, tx: net.tx, read: blk.read, write: blk.write }
}

/** A sample of one container: the rates come from the previous point, when there is one. */
export function sampleFrom(
  raw: RawStats,
  previous: RawPoint | undefined,
  t: number,
): { sample: StatsSample; point: RawPoint } {
  const point = pointOf(raw, t)
  const { memUsage, memLimit } = memoryOf(raw)
  const rate = (pick: (p: RawPoint) => number): number | null =>
    counterRate(previous && { t: previous.t, value: pick(previous) }, { t, value: pick(point) })
  const sample: StatsSample = {
    t,
    cpu: cpuPercentFrom(previous?.cpu, point.cpu),
    mem: memUsage,
    memLimit,
    netRx: rate((p) => p.rx),
    netTx: rate((p) => p.tx),
    blkRead: rate((p) => p.read),
    blkWrite: rate((p) => p.write),
  }
  return { sample, point }
}

/** The ring with `item` added at the end. The oldest items go when it is longer than `size`. The input is not changed. */
export function pushRing<T>(ring: readonly T[], item: T, size: number): T[] {
  const next = [...ring, item]
  return next.length > size ? next.slice(next.length - size) : next
}

function sumOrNull(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null)
  return present.length === 0 ? null : present.reduce((total, value) => total + value, 0)
}

/** The sum of all containers at one tick. Sums skip the containers without a value (null). */
export function totalsOf(t: number, samples: readonly StatsSample[]): TotalsSample {
  return {
    t,
    containers: samples.length,
    cpu: sumOrNull(samples.map((sample) => sample.cpu)),
    mem: samples.reduce((total, sample) => total + sample.mem, 0),
    netRx: sumOrNull(samples.map((sample) => sample.netRx)),
    netTx: sumOrNull(samples.map((sample) => sample.netTx)),
    blkRead: sumOrNull(samples.map((sample) => sample.blkRead)),
    blkWrite: sumOrNull(samples.map((sample) => sample.blkWrite)),
  }
}

/**
 * The CPU values of the sparkline: the last SPARK_LENGTH samples. A missing value stays null, so the
 * sparkline draws a gap there instead of a false drop to 0 (and nothing before the first sample).
 */
export function sparkOf(samples: readonly StatsSample[]): (number | null)[] {
  return samples.slice(-SPARK_LENGTH).map((sample) => sample.cpu)
}

/** The latest values of one container with its sparkline. Null when it has no sample yet. */
export function statsOf(id: string, samples: readonly StatsSample[]): ContainerStats | null {
  const latest = samples.at(-1)
  if (!latest) return null
  return {
    id,
    cpuPercent: latest.cpu,
    memUsage: latest.mem,
    memLimit: latest.memLimit,
    spark: sparkOf(samples),
  }
}

export interface SamplerDeps {
  now: () => number
  /** the ids of the running containers */
  listRunning: () => Promise<string[]>
  /** one stats sample of a container, or null when it cannot be read */
  fetchStats: (id: string) => Promise<RawStats | null>
  setTimer: (run: () => void, ms: number) => unknown
  clearTimer: (handle: unknown) => void
}

export interface StatsSampler {
  /** Returns the latest stats of the given containers (only those with a sample). Starts the loop. */
  latest: (ids: readonly string[]) => ContainerStats[]
  /** The samples of one container, oldest first. Starts the loop. */
  history: (id: string) => StatsSample[]
  /** The totals of all running containers, oldest first. Starts the loop. */
  totals: () => TotalsSample[]
  /** Takes one sample of every running container now. Overlapping calls share one run. */
  tick: () => Promise<void>
  /** True while the timer runs. */
  isRunning: () => boolean
}

export function createStatsSampler(deps: SamplerDeps): StatsSampler {
  const rings = new Map<string, StatsSample[]>()
  const previous = new Map<string, RawPoint>()
  let totalsRing: TotalsSample[] = []
  let timer: unknown = null
  let lastDemand = Number.NEGATIVE_INFINITY
  let inFlight: Promise<void> | null = null

  async function listOrNull(): Promise<string[] | null> {
    try {
      return await deps.listRunning()
    } catch {
      return null
    }
  }

  async function run(): Promise<void> {
    const listed = await listOrNull()
    // Docker cannot be reached: keep the history as it is and try again on the next tick.
    if (listed === null) return
    const ids = [...new Set(listed)]
    const results = await mapLimit(ids, SAMPLE_CONCURRENCY, async (id) => {
      const raw = await deps.fetchStats(id)
      return raw === null ? null : { id, raw, t: deps.now() }
    })

    // Containers that are no longer running lose their history.
    const alive = new Set(ids)
    for (const id of rings.keys()) {
      if (!alive.has(id)) {
        rings.delete(id)
        previous.delete(id)
      }
    }

    const samples: StatsSample[] = []
    for (const result of results) {
      if (result === null) continue
      const { sample, point } = sampleFrom(result.raw, previous.get(result.id), result.t)
      previous.set(result.id, point)
      rings.set(result.id, pushRing(rings.get(result.id) ?? [], sample, RING_SIZE))
      samples.push(sample)
    }
    totalsRing = pushRing(totalsRing, totalsOf(deps.now(), samples), RING_SIZE)
  }

  function tick(): Promise<void> {
    if (inFlight) return inFlight
    inFlight = run().finally(() => {
      inFlight = null
    })
    return inFlight
  }

  function onInterval(): void {
    if (deps.now() - lastDemand > IDLE_STOP_MS) {
      stopLoop()
      return
    }
    void tick()
  }

  function startLoop(): void {
    if (timer !== null) return
    timer = deps.setTimer(onInterval, SAMPLE_INTERVAL_MS)
    void tick()
  }

  function stopLoop(): void {
    if (timer === null) return
    deps.clearTimer(timer)
    timer = null
  }

  function touch(): void {
    lastDemand = deps.now()
    startLoop()
  }

  return {
    latest(ids) {
      touch()
      return ids.flatMap((id) => {
        const stats = statsOf(id, rings.get(id) ?? [])
        return stats ? [stats] : []
      })
    },
    history(id) {
      touch()
      return rings.get(id) ?? []
    },
    totals() {
      touch()
      return totalsRing
    },
    tick,
    isRunning: () => timer !== null,
  }
}

/** The sampler the server uses. It starts its timer only when a read asks for stats. */
export const statsSampler = createStatsSampler({
  now: () => Date.now(),
  listRunning: listRunningIds,
  fetchStats: fetchRawStats,
  setTimer: (run, ms) => setInterval(run, ms),
  clearTimer: (handle) => clearInterval(handle as ReturnType<typeof setInterval>),
})
