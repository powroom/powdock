import { describe, expect, test } from 'bun:test'
import { dockerValidators } from '@/api/validators'
import {
  cpuPercentFrom,
  cpuSampleOf,
  dockerErrorMessage,
  isSameContainer,
  isSelfActionBlocked,
  mapLimit,
  memoryOf,
  normalizePorts,
  selfIdFromMountinfo,
  socketPathFrom,
  toContainerSummary,
  toContainerState,
  unreachableMessage,
  type RawContainer,
  type RawStats,
} from './docker.server'

// Fixtures shaped like the Docker Engine 29 API (GET /containers/json, GET /containers/{id}/stats).
// Nothing here touches the socket: the tests call only the pure functions.

const SELF_ID = 'a1b2c3d4e5f60718293a4b5c6d7e8f9011223344556677889900aabbccddeeff'
const WEB_ID = 'cbc267a813a30bad6f9a919ac8768e30870ceb29c7ea0a7b1415c2b83c914357'

const REDIS: RawContainer = {
  Id: WEB_ID,
  Names: ['/nia-bench-redis-now2'],
  Image: 'redis:7-alpine',
  ImageID: 'sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',
  Command: 'docker-entrypoint.sh redis-server',
  Created: 1795490750,
  Ports: [{ IP: '127.0.0.1', PrivatePort: 6379, PublicPort: 6393, Type: 'tcp' }],
  Labels: {},
  State: 'running',
  Status: 'Up 23 seconds',
  HostConfig: { NetworkMode: 'bridge' },
} as RawContainer

const WEB: RawContainer = {
  Id: 'ff00ee11dd22cc33bb44aa5509876543210fedcba9876543210fedcba98765432',
  Names: ['/shop-web-1'],
  Image: 'nginx:1.27',
  Created: 1795400000,
  // a published port on all interfaces comes twice: IPv4 and IPv6
  Ports: [
    { IP: '::', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
    { IP: '0.0.0.0', PrivatePort: 80, PublicPort: 8080, Type: 'tcp' },
    { PrivatePort: 9000, Type: 'tcp' },
    { IP: '0.0.0.0', PrivatePort: 53, PublicPort: 5353, Type: 'udp' },
  ],
  Labels: {
    'com.docker.compose.project': 'shop',
    'com.docker.compose.service': 'web',
  },
  State: 'paused',
  Status: 'Up 3 hours (Paused)',
}

const STATS_T0: RawStats = {
  cpu_stats: {
    cpu_usage: { total_usage: 1_000_000_000, percpu_usage: [600_000_000, 400_000_000] },
    system_cpu_usage: 50_000_000_000,
    online_cpus: 2,
  },
  memory_stats: { usage: 150 * 1024 * 1024, limit: 2048 * 1024 * 1024, stats: { inactive_file: 30 * 1024 * 1024 } },
}

const STATS_T1: RawStats = {
  cpu_stats: {
    cpu_usage: { total_usage: 1_500_000_000, percpu_usage: [900_000_000, 600_000_000] },
    system_cpu_usage: 51_000_000_000,
    online_cpus: 2,
  },
  memory_stats: { usage: 150 * 1024 * 1024, limit: 2048 * 1024 * 1024, stats: { cache: 20 * 1024 * 1024 } },
}

describe('socketPathFrom', () => {
  test('defaults to the standard socket', () => {
    expect(socketPathFrom({})).toBe('/var/run/docker.sock')
  })

  test('POWDOCK_DOCKER_SOCKET wins over DOCKER_HOST', () => {
    expect(
      socketPathFrom({ POWDOCK_DOCKER_SOCKET: '/run/user/1000/docker.sock', DOCKER_HOST: 'unix:///other.sock' }),
    ).toBe('/run/user/1000/docker.sock')
  })

  test('DOCKER_HOST with a unix:// URL gives the path', () => {
    expect(socketPathFrom({ DOCKER_HOST: 'unix:///var/run/alt.sock' })).toBe('/var/run/alt.sock')
  })

  test('a tcp DOCKER_HOST is not used, the default socket is', () => {
    expect(socketPathFrom({ DOCKER_HOST: 'tcp://10.0.0.2:2375' })).toBe('/var/run/docker.sock')
  })

  test('blank values count as not set', () => {
    expect(socketPathFrom({ POWDOCK_DOCKER_SOCKET: '   ', DOCKER_HOST: '' })).toBe('/var/run/docker.sock')
  })
})

describe('error text', () => {
  test('unreachable message names the socket and the two things to check', () => {
    expect(unreachableMessage('/var/run/docker.sock')).toBe(
      'Cannot reach the Docker Engine at /var/run/docker.sock. Is Docker running, and can this user use the socket?',
    )
  })

  test("uses Docker's message field from the JSON body", () => {
    expect(dockerErrorMessage(409, '{"message":"You cannot remove a running container. Stop it first."}')).toBe(
      'You cannot remove a running container. Stop it first.',
    )
  })

  test('falls back to the HTTP status for a body that is not JSON', () => {
    expect(dockerErrorMessage(500, '<html>oops</html>')).toBe('Docker returned HTTP 500.')
    expect(dockerErrorMessage(404, '')).toBe('Docker returned HTTP 404.')
  })
})

describe('containers', () => {
  test('maps a running container without compose labels', () => {
    const summary = toContainerSummary(REDIS, null)
    expect(summary).toMatchObject({
      id: WEB_ID,
      shortId: 'cbc267a813a3',
      name: 'nia-bench-redis-now2',
      image: 'redis:7-alpine',
      state: 'running',
      status: 'Up 23 seconds',
      project: null,
      service: null,
      isSelf: false,
    })
    expect(summary.createdAt).toBe(new Date(1795490750 * 1000).toISOString())
    expect(summary.ports).toEqual([{ private: 6379, public: 6393, type: 'tcp', ip: '127.0.0.1' }])
  })

  test('keeps the image id, and an empty one when the Engine omits it', () => {
    expect(toContainerSummary(REDIS, null).imageId).toBe(
      'sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',
    )
    expect(toContainerSummary({ ...REDIS, ImageID: undefined }, null).imageId).toBe('')
  })

  test('reads the compose labels and keeps the paused state', () => {
    const summary = toContainerSummary(WEB, null)
    expect(summary.project).toBe('shop')
    expect(summary.service).toBe('web')
    expect(summary.state).toBe('paused')
    expect(summary.name).toBe('shop-web-1')
  })

  test('an empty compose label counts as no project', () => {
    const summary = toContainerSummary({ ...REDIS, Labels: { 'com.docker.compose.project': '' } }, null)
    expect(summary.project).toBeNull()
  })

  test('marks the container pow/dock runs in, by full id or by short id', () => {
    const own = { ...REDIS, Id: SELF_ID }
    expect(toContainerSummary(own, SELF_ID).isSelf).toBe(true)
    expect(toContainerSummary(own, SELF_ID.slice(0, 12)).isSelf).toBe(true)
    expect(toContainerSummary(REDIS, SELF_ID).isSelf).toBe(false)
    expect(toContainerSummary(own, null).isSelf).toBe(false)
  })

  test('a container without names falls back to its short id', () => {
    const summary = toContainerSummary({ ...REDIS, Names: [] }, null)
    expect(summary.name).toBe('cbc267a813a3')
  })

  test('unknown states count as stopped', () => {
    expect(toContainerState('running')).toBe('running')
    expect(toContainerState('restarting')).toBe('restarting')
    expect(toContainerState('something-new')).toBe('exited')
  })

  test('the IPv4 and IPv6 pair of one published port becomes one port', () => {
    expect(normalizePorts(WEB.Ports)).toEqual([
      { private: 53, public: 5353, type: 'udp', ip: '0.0.0.0' },
      { private: 80, public: 8080, type: 'tcp', ip: '0.0.0.0' },
      { private: 9000, type: 'tcp' },
    ])
  })

  test('keeps the IPv4 entry when it comes second', () => {
    const ports = normalizePorts([
      { IP: '::', PrivatePort: 6379, PublicPort: 6379, Type: 'tcp' },
      { IP: '0.0.0.0', PrivatePort: 6379, PublicPort: 6379, Type: 'tcp' },
    ])
    expect(ports).toEqual([{ private: 6379, public: 6379, type: 'tcp', ip: '0.0.0.0' }])
  })

  test('no ports gives an empty list', () => {
    expect(normalizePorts(undefined)).toEqual([])
    expect(normalizePorts([])).toEqual([])
  })
})

describe('self detection', () => {
  test('finds the id in the mount paths of a container', () => {
    const mountinfo = [
      `315 78 8:32 /var/lib/docker/containers/${SELF_ID}/hostname /etc/hostname rw - ext4 /dev/sdc rw`,
      `316 78 8:32 /var/lib/docker/containers/${SELF_ID}/resolv.conf /etc/resolv.conf rw - ext4 /dev/sdc rw`,
    ].join('\n')
    expect(selfIdFromMountinfo(mountinfo)).toBe(SELF_ID)
  })

  test("another container's mount (an shm mount on the host) is not read as this container", () => {
    const other = 'b'.repeat(64)
    const mountinfo = `120 30 0:55 / /var/lib/docker/containers/${other}/mounts/shm rw - tmpfs shm rw`
    expect(selfIdFromMountinfo(mountinfo)).toBeNull()
  })

  test('no container paths means not in Docker', () => {
    const mountinfo = '22 28 0:21 / /sys rw,nosuid - sysfs sysfs rw\n30 28 254:1 / / rw - ext4 /dev/vda1 rw'
    expect(selfIdFromMountinfo(mountinfo)).toBeNull()
    expect(selfIdFromMountinfo('')).toBeNull()
  })

  test('a short id matches the full id, and two different ids do not match', () => {
    expect(isSameContainer(SELF_ID, SELF_ID.slice(0, 12))).toBe(true)
    expect(isSameContainer(SELF_ID.slice(0, 12), SELF_ID)).toBe(true)
    expect(isSameContainer(WEB_ID, SELF_ID)).toBe(false)
    expect(isSameContainer(WEB_ID, null)).toBe(false)
    expect(isSameContainer('abc', SELF_ID)).toBe(false)
  })

  test('stop, restart, pause and kill are blocked for pow/dock itself', () => {
    expect(['stop', 'restart', 'pause', 'kill'].every((a) => isSelfActionBlocked(a as 'stop'))).toBe(true)
    expect(isSelfActionBlocked('start')).toBe(false)
    expect(isSelfActionBlocked('unpause')).toBe(false)
  })
})

describe('stats', () => {
  test('the first sample has no CPU percent', () => {
    expect(cpuPercentFrom(undefined, cpuSampleOf(STATS_T0))).toBeNull()
  })

  test('CPU percent from two samples: container time over system time, times the CPUs', () => {
    const percent = cpuPercentFrom(cpuSampleOf(STATS_T0), cpuSampleOf(STATS_T1))
    // (1.5e9 - 1.0e9) / (51e9 - 50e9) * 2 CPUs * 100 = 100
    expect(percent).toBeCloseTo(100, 6)
  })

  test('a counter that went backwards (restart) gives no percent', () => {
    const restarted: RawStats = { ...STATS_T1, cpu_stats: { ...STATS_T1.cpu_stats, cpu_usage: { total_usage: 10 } } }
    expect(cpuPercentFrom(cpuSampleOf(STATS_T0), cpuSampleOf(restarted))).toBeNull()
  })

  test('no system time change gives no percent (no division by zero)', () => {
    expect(cpuPercentFrom(cpuSampleOf(STATS_T0), cpuSampleOf(STATS_T0))).toBeNull()
  })

  test('the CPU count falls back to the per-CPU list, then to 1', () => {
    expect(cpuSampleOf(STATS_T0).onlineCpus).toBe(2)
    const noOnline: RawStats = { cpu_stats: { cpu_usage: { total_usage: 1, percpu_usage: [1, 2, 3, 4] } } }
    expect(cpuSampleOf(noOnline).onlineCpus).toBe(4)
    expect(cpuSampleOf({}).onlineCpus).toBe(1)
  })

  test('memory leaves out the inactive file cache (cgroup v2)', () => {
    expect(memoryOf(STATS_T0)).toEqual({
      memUsage: 120 * 1024 * 1024,
      memLimit: 2048 * 1024 * 1024,
    })
  })

  test('memory leaves out the cache on cgroup v1', () => {
    expect(memoryOf(STATS_T1)).toEqual({
      memUsage: 130 * 1024 * 1024,
      memLimit: 2048 * 1024 * 1024,
    })
  })

  test('memory never goes below zero', () => {
    expect(memoryOf({ memory_stats: { usage: 5, stats: { cache: 9 } } }).memUsage).toBe(0)
  })
})

describe('mapLimit', () => {
  test('never runs more than the limit at once, and keeps the order of the results', async () => {
    let running = 0
    let peak = 0
    const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    const results = await mapLimit(items, 8, async (n) => {
      running += 1
      peak = Math.max(peak, running)
      await new Promise((resolve) => setTimeout(resolve, 5 * (n % 3)))
      running -= 1
      return n * 10
    })
    expect(peak).toBeLessThanOrEqual(8)
    expect(peak).toBeGreaterThan(1)
    expect(results).toEqual(items.map((n) => n * 10))
  })

  test('no items gives no results', async () => {
    expect(await mapLimit([], 8, async () => 1)).toEqual([])
  })
})

describe('validators', () => {
  const { statsInput, actionInput, removeInput } = dockerValidators()

  test('container ids are hex, 12 to 64 characters', () => {
    expect(statsInput.safeParse({ ids: [WEB_ID, WEB_ID.slice(0, 12)] }).success).toBe(true)
    expect(statsInput.safeParse({ ids: ['abc'] }).success).toBe(false)
    expect(statsInput.safeParse({ ids: ['zzzzzzzzzzzz'] }).success).toBe(false)
    expect(statsInput.safeParse({ ids: ['a'.repeat(65)] }).success).toBe(false)
    expect(statsInput.safeParse({ ids: ['../../images'] }).success).toBe(false)
  })

  test('at most 500 ids per stats call', () => {
    const ids = Array.from({ length: 501 }, () => WEB_ID)
    expect(statsInput.safeParse({ ids }).success).toBe(false)
  })

  test('only the known actions are accepted', () => {
    expect(actionInput.safeParse({ id: WEB_ID, action: 'restart' }).success).toBe(true)
    expect(actionInput.safeParse({ id: WEB_ID, action: 'rm' }).success).toBe(false)
  })

  test('remove needs both flags as booleans', () => {
    expect(removeInput.safeParse({ id: WEB_ID, force: true, volumes: false }).success).toBe(true)
    expect(removeInput.safeParse({ id: WEB_ID, force: 'yes', volumes: false }).success).toBe(false)
  })
})
