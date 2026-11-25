import { existsSync, readFileSync } from 'node:fs'
import { toContainerDetails, type ContainerDetails, type RawInspect } from '@/lib/container-details'
import type { StopState } from '@/lib/recent-failures'
import { createTtlCache } from '@/lib/ttl-cache'
import type { ContainerAction, ContainerState, ContainerPort, ContainerSummary, EngineInfo } from '@/lib/types'

/**
 * A small client for the Docker Engine API. It talks over the Unix socket with Bun's fetch.
 * Only the calls pow/dock needs are here: list, one-shot stats, start/stop/restart/pause/kill, and remove.
 * The pure functions (mapping, CPU and memory math) are exported for unit tests, which never use the socket.
 */

/** The Engine API version pow/dock asks for. 1.47 works with Engine 25 and later (the newest is 1.56). */
export const API_VERSION = 'v1.47'
const DEFAULT_SOCKET = '/var/run/docker.sock'
const UNIX_PREFIX = 'unix://'
/** Seconds Docker waits before it kills a container on stop. */
const STOP_TIMEOUT_SECONDS = 10
/** Docker IDs are hex. The short form is 12 characters. */
const SHORT_ID_LENGTH = 12
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project'
const COMPOSE_SERVICE_LABEL = 'com.docker.compose.service'

/** Actions that would stop pow/dock itself. The UI disables them too. */
const SELF_BLOCKED_ACTIONS: readonly ContainerAction[] = ['stop', 'restart', 'pause', 'kill']

// ---------------------------------------------------------------------------
// Connection
// ---------------------------------------------------------------------------

/** The socket path: POWDOCK_DOCKER_SOCKET, else DOCKER_HOST when it is a unix:// URL, else /var/run/docker.sock. */
export function socketPathFrom(env: Readonly<Record<string, string | undefined>>): string {
  const explicit = stripUnixPrefix((env.POWDOCK_DOCKER_SOCKET ?? '').trim())
  if (explicit) return explicit
  const host = (env.DOCKER_HOST ?? '').trim()
  if (host.startsWith(UNIX_PREFIX)) return stripUnixPrefix(host) || DEFAULT_SOCKET
  return DEFAULT_SOCKET
}

function stripUnixPrefix(value: string): string {
  return value.startsWith(UNIX_PREFIX) ? value.slice(UNIX_PREFIX.length) : value
}

export function unreachableMessage(socket: string): string {
  return `Cannot reach the Docker Engine at ${socket}. Is Docker running, and can this user use the socket?`
}

/** The message from Docker's JSON error body, or a generic text when the body has none. */
export function dockerErrorMessage(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { message?: unknown }
    if (typeof parsed.message === 'string' && parsed.message) return parsed.message
  } catch {
    // not JSON: fall through to the generic text
  }
  return `Docker returned HTTP ${status}.`
}

type DockerMethod = 'GET' | 'POST' | 'DELETE'

interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
  /** aborts the call (and a streamed body) when it fires */
  signal?: AbortSignal
}

/**
 * One request to the Engine, with the response as it came (the body is not read). Rejects only when
 * the Engine cannot be reached. The message says where pow/dock looked for the socket.
 */
export async function dockerFetch(method: DockerMethod, path: string, options: RequestOptions = {}): Promise<Response> {
  const socket = socketPathFrom(process.env)
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined) params.set(key, String(value))
  }
  const search = params.toString()
  const url = `http://docker/${API_VERSION}${path}${search ? `?${search}` : ''}`
  const hasBody = options.body !== undefined
  try {
    return await fetch(url, {
      method,
      unix: socket,
      headers: hasBody ? { 'Content-Type': 'application/json' } : undefined,
      body: hasBody ? JSON.stringify(options.body) : undefined,
      signal: options.signal,
    })
  } catch {
    // A missing socket and a permission error look the same to fetch, so one message covers both.
    throw new Error(unreachableMessage(socket))
  }
}

/**
 * One call to the Engine. Resolves to the parsed JSON body (null when the body is empty).
 * Rejects with an Error whose message is Docker's own message, and whose `status` is the HTTP status.
 */
export async function dockerRequest<T>(method: DockerMethod, path: string, options: RequestOptions = {}): Promise<T> {
  const response = await dockerFetch(method, path, options)
  const text = await response.text()
  // 304 means the container is already in the requested state (for example, start on a running one).
  if (response.ok || response.status === 304) return (text ? JSON.parse(text) : null) as T
  throw Object.assign(new Error(dockerErrorMessage(response.status, text)), { status: response.status })
}

// ---------------------------------------------------------------------------
// Which container is pow/dock
// ---------------------------------------------------------------------------

/**
 * The container id from the mount of /etc/hostname, which Docker binds from .../containers/<id>/hostname.
 * Only that line is read: other lines can name other containers (their shm mounts, for example).
 */
export function selfIdFromMountinfo(mountinfo: string): string | null {
  for (const line of mountinfo.split('\n')) {
    // fields: id parent major:minor root mount-point ...
    const fields = line.split(' ')
    if (fields[4] !== '/etc/hostname') continue
    const match = /\/containers\/([a-f0-9]{64})\/hostname/.exec(fields[3] ?? '')
    if (match) return match[1] ?? null
  }
  return null
}

/** True when two ids (full or short) name the same container. Both must be at least 12 characters. */
export function isSameContainer(a: string, b: string | null): boolean {
  if (!b) return false
  const length = Math.min(a.length, b.length)
  return length >= SHORT_ID_LENGTH && a.slice(0, length) === b.slice(0, length)
}

export function isSelfActionBlocked(action: ContainerAction): boolean {
  return SELF_BLOCKED_ACTIONS.includes(action)
}

let selfId: string | null | undefined

/**
 * The id of the container pow/dock runs in, or null when it runs outside Docker. Read once.
 * Inside Docker the id comes from the mount paths. Without them, the hostname (the short id by
 * default) is used, but only inside a container (there is a /.dockerenv file).
 */
export function selfContainerId(): string | null {
  if (selfId === undefined) selfId = detectSelfId()
  return selfId
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

function detectSelfId(): string | null {
  // outside a container there is no self to protect, whatever the mount table says
  if (!existsSync('/.dockerenv')) return null
  const fromMounts = selfIdFromMountinfo(readText('/proc/self/mountinfo') ?? '')
  if (fromMounts) return fromMounts
  const hostname = (readText('/etc/hostname') ?? '').trim()
  return /^[a-f0-9]{12}$/.test(hostname) ? hostname : null
}

// ---------------------------------------------------------------------------
// Containers
// ---------------------------------------------------------------------------

/** One entry of GET /containers/json (only the fields pow/dock reads). */
export interface RawContainer {
  Id: string
  Names?: string[]
  Image: string
  /** the id of the image the container was made from (sha256:...) */
  ImageID?: string
  /** Unix time in seconds */
  Created: number
  Ports?: RawPort[]
  Labels?: Record<string, string>
  State: string
  Status: string
  /** the mounts of the container: volumes, bind mounts and others */
  Mounts?: RawMount[]
}

/** One mount of a container (only the fields the Volumes and Networks pages read). */
export interface RawMount {
  /** "volume", "bind", "tmpfs" and so on */
  Type?: string
  /** the volume name, for a volume mount */
  Name?: string
  /** the path on the host, for a bind mount */
  Source?: string
  /** the path inside the container */
  Destination?: string
  RW?: boolean
}

export interface RawPort {
  IP?: string
  PrivatePort: number
  PublicPort?: number
  Type?: string
}

const CONTAINER_STATES: readonly ContainerState[] = [
  'running',
  'exited',
  'paused',
  'restarting',
  'created',
  'dead',
  'removing',
]

/** A state the Engine reports that pow/dock does not know counts as stopped. */
export function toContainerState(value: string): ContainerState {
  return (CONTAINER_STATES as readonly string[]).includes(value) ? (value as ContainerState) : 'exited'
}

/**
 * Ports as the Engine lists them. A published port on 0.0.0.0 comes twice (IPv4 and IPv6, "::"),
 * so each published port is kept once, with the IPv4 entry when there is one.
 */
export function normalizePorts(raw: readonly RawPort[] = []): ContainerPort[] {
  const byKey = new Map<string, ContainerPort>()
  for (const entry of raw) {
    const type = entry.Type || 'tcp'
    const publicPort = entry.PublicPort || undefined
    const ip = entry.IP || undefined
    const port: ContainerPort = {
      private: entry.PrivatePort,
      type,
      ...(publicPort === undefined ? {} : { public: publicPort }),
      ...(ip === undefined ? {} : { ip }),
    }
    const key = `${entry.PrivatePort}/${publicPort ?? ''}/${type}`
    const existing = byKey.get(key)
    if (!existing || (isIpv6(existing.ip) && !isIpv6(ip))) byKey.set(key, port)
  }
  return [...byKey.values()].sort((a, b) => a.private - b.private || (a.public ?? 0) - (b.public ?? 0))
}

function isIpv6(ip: string | undefined): boolean {
  return ip !== undefined && ip.includes(':')
}

/** Maps one Engine entry to the summary the UI uses. */
export function toContainerSummary(raw: RawContainer, self: string | null): ContainerSummary {
  const labels = raw.Labels ?? {}
  const name = (raw.Names?.[0] ?? '').replace(/^\//, '') || raw.Id.slice(0, SHORT_ID_LENGTH)
  return {
    id: raw.Id,
    shortId: raw.Id.slice(0, SHORT_ID_LENGTH),
    name,
    image: raw.Image,
    imageId: raw.ImageID ?? '',
    state: toContainerState(raw.State),
    status: raw.Status,
    createdAt: new Date(raw.Created * 1000).toISOString(),
    ports: normalizePorts(raw.Ports),
    project: labels[COMPOSE_PROJECT_LABEL] || null,
    service: labels[COMPOSE_SERVICE_LABEL] || null,
    isSelf: isSameContainer(raw.Id, self),
  }
}

/** Runs start, stop, restart, pause, unpause or kill. Stop waits up to 10 seconds before it kills. */
export async function containerAction(id: string, action: ContainerAction): Promise<void> {
  if (isSelfActionBlocked(action) && isSameContainer(id, selfContainerId())) {
    throw new Error(`pow/dock cannot ${action} the container it runs in.`)
  }
  await dockerRequest('POST', `/containers/${encodeURIComponent(id)}/${action}`, {
    query: action === 'stop' ? { t: STOP_TIMEOUT_SECONDS } : undefined,
  })
}

/** Removes a container. `force` also stops a running one. `volumes` removes its anonymous volumes. */
export async function removeContainer(id: string, options: { force: boolean; volumes: boolean }): Promise<void> {
  if (isSameContainer(id, selfContainerId())) throw new Error('pow/dock cannot remove the container it runs in.')
  await dockerRequest('DELETE', `/containers/${encodeURIComponent(id)}`, {
    query: { force: options.force, v: options.volumes },
  })
}

/** The details of one container (GET /containers/{id}/json), trimmed for the Details tab. */
export async function inspectContainer(id: string): Promise<ContainerDetails> {
  const raw = await dockerRequest<RawInspect | null>('GET', `/containers/${encodeURIComponent(id)}/json`)
  return toContainerDetails(raw ?? {})
}

// ---------------------------------------------------------------------------
// Stats
// ---------------------------------------------------------------------------

/** The part of GET /containers/{id}/stats that pow/dock reads. */
export interface RawStats {
  /** the time of the sample, as an RFC 3339 string */
  read?: string
  cpu_stats?: {
    cpu_usage?: { total_usage?: number; percpu_usage?: number[] }
    system_cpu_usage?: number
    online_cpus?: number
  }
  memory_stats?: {
    usage?: number
    limit?: number
    stats?: { inactive_file?: number; cache?: number }
  }
  /** one entry per network of the container, with its byte counters since the container started */
  networks?: Record<string, { rx_bytes?: number; tx_bytes?: number }>
  blkio_stats?: {
    /** one entry per device and operation. cgroup v1 writes "Read"/"Write", cgroup v2 "read"/"write". */
    io_service_bytes_recursive?: { op?: string; value?: number }[] | null
  }
}

export interface CpuSample {
  totalUsage: number
  systemUsage: number
  onlineCpus: number
}

export function cpuSampleOf(raw: RawStats): CpuSample {
  const cpu: NonNullable<RawStats['cpu_stats']> = raw.cpu_stats ?? {}
  const perCpu = cpu.cpu_usage?.percpu_usage?.length ?? 0
  return {
    totalUsage: cpu.cpu_usage?.total_usage ?? 0,
    systemUsage: cpu.system_cpu_usage ?? 0,
    onlineCpus: cpu.online_cpus || perCpu || 1,
  }
}

/**
 * CPU percent between two samples: the container's CPU time over the host's CPU time, times the
 * number of CPUs (so 100 means one full CPU). Null when there is no earlier sample, or when the
 * counters went backwards (the container restarted).
 */
export function cpuPercentFrom(previous: CpuSample | undefined, current: CpuSample): number | null {
  if (!previous) return null
  const deltaContainer = current.totalUsage - previous.totalUsage
  const deltaSystem = current.systemUsage - previous.systemUsage
  if (deltaContainer < 0 || deltaSystem <= 0) return null
  return (deltaContainer / deltaSystem) * current.onlineCpus * 100
}

/** Memory in use, without the page cache (inactive file on cgroup v2, cache on v1), and the limit. */
export function memoryOf(raw: RawStats): { memUsage: number; memLimit: number } {
  const memory = raw.memory_stats ?? {}
  const usage = memory.usage ?? 0
  const cache = memory.stats?.inactive_file ?? memory.stats?.cache ?? 0
  return { memUsage: Math.max(0, usage - cache), memLimit: memory.limit ?? 0 }
}

/** Runs `fn` over `items`, with at most `limit` calls running at once. Results keep the input order. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await fn(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => worker()))
  return results
}

/**
 * One one-shot stats sample of a container (GET /containers/{id}/stats). Null when the call fails,
 * for example because the container stopped after the list was read.
 */
export async function fetchRawStats(id: string): Promise<RawStats | null> {
  return dockerRequest<RawStats | null>('GET', `/containers/${encodeURIComponent(id)}/stats`, {
    query: { stream: false, 'one-shot': true },
  }).catch(() => null)
}

let hostMemory: number | undefined

/**
 * The memory of the host in bytes (GET /info, MemTotal). A container without a memory limit reports
 * this as its limit. Read once. Null when Docker does not answer (then the next call asks again).
 */
export async function hostMemoryTotal(): Promise<number | null> {
  if (hostMemory !== undefined) return hostMemory
  const info = await dockerRequest<{ MemTotal?: number } | null>('GET', '/info').catch(() => null)
  const total = info?.MemTotal ?? null
  if (total !== null && total > 0) hostMemory = total
  return total !== null && total > 0 ? total : null
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

/** The part of GET /info that the dashboard and the sidebar read. */
export interface RawInfo {
  ServerVersion?: string
  OperatingSystem?: string
  NCPU?: number
  MemTotal?: number
}

/** How long the engine details are kept. They change rarely (a Docker upgrade, for example). */
const ENGINE_INFO_TTL_MS = 60_000

export function toEngineInfo(raw: RawInfo): EngineInfo {
  return {
    version: raw.ServerVersion ?? '',
    os: raw.OperatingSystem ?? '',
    cpus: raw.NCPU ?? 0,
    memTotal: raw.MemTotal ?? 0,
  }
}

const cachedEngineInfo = createTtlCache<EngineInfo>(ENGINE_INFO_TTL_MS)

/** The Docker version, the operating system, the CPU count and the memory of the host (GET /info), kept for a minute. */
export function engineInfo(): Promise<EngineInfo> {
  return cachedEngineInfo(async () => {
    const raw = (await dockerRequest<RawInfo | null>('GET', '/info')) ?? {}
    return toEngineInfo(raw)
  })
}

/**
 * What inspect says about the last stop of a container: its out-of-memory flag and its finish time.
 * Null when the call fails (for example, the container was removed meanwhile).
 */
export async function inspectStopState(id: string): Promise<StopState | null> {
  const raw = await dockerRequest<{ State?: { OOMKilled?: boolean; FinishedAt?: string } } | null>(
    'GET',
    `/containers/${encodeURIComponent(id)}/json`,
  ).catch(() => null)
  if (!raw) return null
  return { oomKilled: raw.State?.OOMKilled === true, finishedAt: raw.State?.FinishedAt ?? null }
}
