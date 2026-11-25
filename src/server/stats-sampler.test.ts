import { describe, expect, test } from 'bun:test'
import type { RawStats } from './docker.server'
import {
  blockIoTotals,
  counterRate,
  createStatsSampler,
  IDLE_STOP_MS,
  networkTotals,
  pushRing,
  RING_SIZE,
  sampleFrom,
  SAMPLE_CONCURRENCY,
  SAMPLE_INTERVAL_MS,
  sparkOf,
  statsOf,
  totalsOf,
} from './stats-sampler.server'
import type { StatsSample } from '@/lib/types'

// Nothing here touches the Docker socket or a real timer: the sampler gets fake deps, and the tests call tick() by hand.

/** A stats response with the given counters. CPU: total and system time in nanoseconds. */
function raw(options: {
  cpu?: number
  system?: number
  mem?: number
  limit?: number
  rx?: number
  tx?: number
  read?: number
  write?: number
}): RawStats {
  return {
    cpu_stats: {
      cpu_usage: { total_usage: options.cpu ?? 0 },
      system_cpu_usage: options.system ?? 0,
      online_cpus: 2,
    },
    memory_stats: { usage: options.mem ?? 0, limit: options.limit ?? 4096 },
    networks: { eth0: { rx_bytes: options.rx ?? 0, tx_bytes: options.tx ?? 0 } },
    blkio_stats: {
      io_service_bytes_recursive: [
        { op: 'read', value: options.read ?? 0 },
        { op: 'write', value: options.write ?? 0 },
      ],
    },
  }
}

function sample(overrides: Partial<StatsSample> = {}): StatsSample {
  return {
    t: 0,
    cpu: 1,
    mem: 1,
    memLimit: 2,
    netRx: 0,
    netTx: 0,
    blkRead: 0,
    blkWrite: 0,
    ...overrides,
  }
}

describe('counterRate', () => {
  test('bytes per second from two readings', () => {
    expect(counterRate({ t: 0, value: 1000 }, { t: 2000, value: 5000 })).toBe(2000)
  })

  test('no earlier reading gives null', () => {
    expect(counterRate(undefined, { t: 0, value: 1000 })).toBeNull()
  })

  test('a counter that went backwards (a restart) gives 0', () => {
    expect(counterRate({ t: 0, value: 9000 }, { t: 2000, value: 100 })).toBe(0)
  })

  test('no time between the readings gives null (no division by zero)', () => {
    expect(counterRate({ t: 5, value: 1 }, { t: 5, value: 9 })).toBeNull()
  })
})

describe('network and block I/O counters', () => {
  test('network counters are summed over all interfaces', () => {
    const stats: RawStats = {
      networks: { eth0: { rx_bytes: 100, tx_bytes: 10 }, eth1: { rx_bytes: 50, tx_bytes: 5 }, bare: {} },
    }
    expect(networkTotals(stats)).toEqual({ rx: 150, tx: 15 })
    expect(networkTotals({})).toEqual({ rx: 0, tx: 0 })
  })

  test('block I/O is read and write summed over devices, and the op names ignore case (cgroup v1 and v2)', () => {
    const stats: RawStats = {
      blkio_stats: {
        io_service_bytes_recursive: [
          { op: 'Read', value: 10 },
          { op: 'read', value: 5 },
          { op: 'Write', value: 7 },
          { op: 'Total', value: 999 },
          { value: 3 },
        ],
      },
    }
    expect(blockIoTotals(stats)).toEqual({ read: 15, write: 7 })
  })

  test('a missing or null block list counts as no I/O', () => {
    expect(blockIoTotals({})).toEqual({ read: 0, write: 0 })
    expect(blockIoTotals({ blkio_stats: { io_service_bytes_recursive: null } })).toEqual({ read: 0, write: 0 })
  })
})

describe('sampleFrom', () => {
  test('the first sample has no CPU percent and no rates, but the memory', () => {
    const { sample: first, point } = sampleFrom(raw({ mem: 500, rx: 100 }), undefined, 1000)
    expect(first).toEqual({
      t: 1000,
      cpu: null,
      mem: 500,
      memLimit: 4096,
      netRx: null,
      netTx: null,
      blkRead: null,
      blkWrite: null,
    })
    expect(point.rx).toBe(100)
  })

  test('the second sample has the rates from the counters, per second', () => {
    const first = sampleFrom(raw({ rx: 1000, tx: 0, read: 0, write: 0 }), undefined, 0).point
    const second = sampleFrom(
      raw({ cpu: 1_000_000_000, system: 50_000_000_000, rx: 3000, tx: 500, read: 4000, write: 0 }),
      first,
      2000,
    ).sample
    expect(second.netRx).toBe(1000)
    expect(second.netTx).toBe(250)
    expect(second.blkRead).toBe(2000)
    expect(second.blkWrite).toBe(0)
  })

  test('the CPU percent comes from the two CPU samples (the same formula as before)', () => {
    const first = sampleFrom(raw({ cpu: 1_000_000_000, system: 50_000_000_000 }), undefined, 0).point
    const { sample: second } = sampleFrom(raw({ cpu: 1_500_000_000, system: 51_000_000_000 }), first, 2000)
    // (0.5e9 / 1e9) * 2 CPUs * 100 = 100
    expect(second.cpu).toBeCloseTo(100, 6)
  })
})

describe('pushRing', () => {
  test('adds the item at the end and keeps the input as it was', () => {
    const ring = [1, 2]
    expect(pushRing(ring, 3, 10)).toEqual([1, 2, 3])
    expect(ring).toEqual([1, 2])
  })

  test('drops the oldest items past the size', () => {
    expect(pushRing([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
    expect(pushRing([], 1, 1)).toEqual([1])
  })
})

describe('totalsOf', () => {
  test('sums the containers, and skips the missing rates', () => {
    const totals = totalsOf(10, [
      sample({ cpu: 10, mem: 100, netRx: 5, netTx: null, blkRead: null, blkWrite: 2 }),
      sample({ cpu: null, mem: 300, netRx: 7, netTx: 3, blkRead: null, blkWrite: 4 }),
    ])
    expect(totals).toEqual({
      t: 10,
      containers: 2,
      cpu: 10,
      mem: 400,
      netRx: 12,
      netTx: 3,
      blkRead: null,
      blkWrite: 6,
    })
  })

  test('no containers gives zeros, and nulls where there is nothing to add', () => {
    expect(totalsOf(5, [])).toEqual({
      t: 5,
      containers: 0,
      cpu: null,
      mem: 0,
      netRx: null,
      netTx: null,
      blkRead: null,
      blkWrite: null,
    })
  })
})

describe('sparkline and latest values', () => {
  test('the sparkline has the last 30 CPU values, and a missing value stays a gap (null)', () => {
    const samples = Array.from({ length: 40 }, (_, i) => sample({ cpu: i === 39 ? null : i }))
    const spark = sparkOf(samples)
    expect(spark).toHaveLength(30)
    expect(spark[0]).toBe(10)
    expect(spark[29]).toBeNull()
  })

  test('the latest values come from the last sample', () => {
    const stats = statsOf('abc', [sample({ cpu: 1, mem: 10 }), sample({ cpu: 2, mem: 20, memLimit: 30 })])
    expect(stats).toEqual({ id: 'abc', cpuPercent: 2, memUsage: 20, memLimit: 30, spark: [1, 2] })
    expect(statsOf('abc', [])).toBeNull()
  })
})

// A sampler with fake deps: the clock, the running list and the stats are controlled by the test.
function fakeSampler(running: string[]) {
  let now = 1_000_000
  let timerFn: (() => void) | null = null
  const timers: { ms: number }[] = []
  const cleared: unknown[] = []
  const state = { listed: running, fetched: [] as string[], failList: false, counters: new Map<string, number>() }
  const deps = {
    now: () => now,
    listRunning: async () => {
      if (state.failList) throw new Error('down')
      return state.listed
    },
    fetchStats: async (id: string) => {
      state.fetched.push(id)
      const count = (state.counters.get(id) ?? 0) + 1
      state.counters.set(id, count)
      return raw({ cpu: count * 1_000_000_000, system: count * 10_000_000_000, mem: count * 100, rx: count * 1000 })
    },
    setTimer: (run: () => void, ms: number) => {
      timers.push({ ms })
      timerFn = run
      return timers.length
    },
    clearTimer: (handle: unknown) => {
      cleared.push(handle)
    },
  }
  return {
    sampler: createStatsSampler(deps),
    state,
    timers,
    cleared,
    advance: (ms: number) => {
      now += ms
    },
    fireTimer: () => timerFn?.(),
  }
}

describe('stats sampler', () => {
  test('a tick samples every listed container and adds one totals sample', async () => {
    const fake = fakeSampler(['a', 'b'])
    await fake.sampler.tick()
    fake.advance(SAMPLE_INTERVAL_MS)
    await fake.sampler.tick()
    const history = fake.sampler.history('a')
    expect(history).toHaveLength(2)
    // the fake adds 1e9 container time over 1e10 system time, on 2 CPUs: 0.1 * 2 * 100
    expect(history[1]?.cpu).toBeCloseTo(20, 6)
    expect(fake.sampler.totals()).toHaveLength(2)
    expect(fake.sampler.totals()[1]?.containers).toBe(2)
  })

  test('the ring keeps only the last RING_SIZE samples', async () => {
    const fake = fakeSampler(['a'])
    for (let i = 0; i < RING_SIZE + 10; i++) {
      fake.advance(SAMPLE_INTERVAL_MS)
      await fake.sampler.tick()
    }
    expect(fake.sampler.history('a')).toHaveLength(RING_SIZE)
    expect(fake.sampler.totals()).toHaveLength(RING_SIZE)
  })

  test('a container that stopped loses its history on the next tick', async () => {
    const fake = fakeSampler(['a', 'b'])
    await fake.sampler.tick()
    fake.state.listed = ['b']
    await fake.sampler.tick()
    expect(fake.sampler.history('a')).toEqual([])
    expect(fake.sampler.history('b')).toHaveLength(2)
  })

  test('at most SAMPLE_CONCURRENCY stats calls run at once', async () => {
    const ids = Array.from({ length: 20 }, (_, i) => `c${i}`)
    let running = 0
    let peak = 0
    const sampler = createStatsSampler({
      now: () => 0,
      listRunning: async () => ids,
      fetchStats: async () => {
        running += 1
        peak = Math.max(peak, running)
        await new Promise((resolve) => setTimeout(resolve, 2))
        running -= 1
        return raw({})
      },
      setTimer: () => 0,
      clearTimer: () => {},
    })
    await sampler.tick()
    expect(peak).toBe(SAMPLE_CONCURRENCY)
    expect(sampler.history('c19')).toHaveLength(1)
  })

  test('overlapping ticks share one run', async () => {
    const fake = fakeSampler(['a'])
    const first = fake.sampler.tick()
    const second = fake.sampler.tick()
    await Promise.all([first, second])
    expect(fake.state.fetched).toEqual(['a'])
  })

  test('when Docker cannot be listed, the history is kept and nothing throws', async () => {
    const fake = fakeSampler(['a'])
    await fake.sampler.tick()
    fake.state.failList = true
    await fake.sampler.tick()
    expect(fake.sampler.history('a')).toHaveLength(1)
  })

  test('a read starts the timer once, and the loop stops after 30 seconds without a read', async () => {
    const fake = fakeSampler(['a'])
    expect(fake.sampler.isRunning()).toBe(false)
    fake.sampler.latest(['a'])
    fake.sampler.history('a')
    expect(fake.sampler.isRunning()).toBe(true)
    expect(fake.timers).toEqual([{ ms: SAMPLE_INTERVAL_MS }])

    // a timer tick within the idle time keeps the loop going
    fake.advance(IDLE_STOP_MS - 1000)
    fake.fireTimer()
    expect(fake.sampler.isRunning()).toBe(true)

    // more than 30 seconds after the last read, the next timer tick stops it
    fake.advance(2000)
    fake.fireTimer()
    expect(fake.sampler.isRunning()).toBe(false)
    expect(fake.cleared).toEqual([1])
  })

  test('the next read starts the loop again', () => {
    const fake = fakeSampler(['a'])
    fake.sampler.totals()
    fake.advance(IDLE_STOP_MS + 1)
    fake.fireTimer()
    expect(fake.sampler.isRunning()).toBe(false)
    fake.sampler.totals()
    expect(fake.sampler.isRunning()).toBe(true)
    expect(fake.timers).toHaveLength(2)
  })

  test('latest returns only the requested containers that have a sample', async () => {
    const fake = fakeSampler(['a', 'b'])
    await fake.sampler.tick()
    const stats = fake.sampler.latest(['b', 'missing'])
    expect(stats.map((stat) => stat.id)).toEqual(['b'])
    expect(stats[0]?.spark).toEqual([null]) // the first sample has no CPU value yet: a gap, not 0
  })
})
