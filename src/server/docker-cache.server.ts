import type { ContainerSummary, DockerCounts } from '@/lib/types'
import { dockerFetch, dockerRequest, selfContainerId, toContainerSummary, type RawContainer } from './docker.server'
import type { RawImage } from './images.server'

/**
 * One in-memory copy of the container list and one of the image list, shared by every feature.
 *
 * Docker is slow to list containers (up to 350 ms), and every page asks for the list several times at
 * once. So the lists are read once, and they stay fresh because of the Docker events stream: a container
 * event marks the container list stale, and an image event marks the image list stale. Each read
 * refreshes a stale list. Readers that arrive together share one request.
 *
 * Volume and network events only bump a counter (a "version"). Short caches that depend on them, such
 * as the sidebar counts, compare the counter to know when to read again.
 *
 * The pure functions (the event parser, the freshness rule, the backoff and the debounce) are exported
 * for unit tests. The tests never touch the Docker socket.
 */

/** Two refreshes of the same list start at least this far apart, so a burst of events costs one call. */
export const REFRESH_DEBOUNCE_MS = 250
/** The container list is read again after this long, because the status text ("Up 3 hours") ages. */
export const CONTAINER_MAX_AGE_MS = 15_000
/** While the events stream is down, a list is kept for at most this long. */
export const DOWN_MAX_AGE_MS = 3_000
/** The events stream stops when nobody has read for this long. The next read starts it again. */
export const STREAM_IDLE_MS = 5 * 60_000
/** The sidebar counts are kept for this long (they also change with the versions below). */
export const COUNTS_TTL_MS = 5_000
/** Reconnect waits after each failed attempt, in milliseconds. The last value is used from then on. */
const BACKOFF_MS = [1_000, 2_000, 5_000, 30_000] as const
/** The Docker event types this cache reads. */
const EVENT_TYPES = ['container', 'image', 'volume', 'network'] as const

// ---------------------------------------------------------------------------
// Pure parts
// ---------------------------------------------------------------------------

export type EventKind = (typeof EVENT_TYPES)[number]

export interface DockerEvent {
  type: string
  action: string
}

/** The kinds of events the cache knows, by event type. Other types (for example "daemon") are ignored. */
export function kindOf(type: string): EventKind | null {
  return (EVENT_TYPES as readonly string[]).includes(type) ? (type as EventKind) : null
}

/**
 * The list an event makes stale, or null when it changes no list. Exec events (for example the health
 * checks of a container, which run as exec) do not change any field the lists show, and they come
 * several times a second on a busy host, so they are ignored.
 */
export function staleKindOf(event: DockerEvent): EventKind | null {
  const kind = kindOf(event.type)
  if (kind === 'container' && event.action.startsWith('exec_')) return null
  return kind
}

/** One line of the events stream as an event. Null when it is blank, not JSON or has no type. */
export function parseEventLine(line: string): DockerEvent | null {
  const text = line.trim()
  if (!text) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const raw = parsed as { Type?: unknown; type?: unknown; Action?: unknown; action?: unknown }
  const type = raw.Type ?? raw.type
  if (typeof type !== 'string') return null
  const action = raw.Action ?? raw.action
  return { type, action: typeof action === 'string' ? action : '' }
}

/**
 * Splits the text of the events stream into lines and parses each complete line. Docker ends every event
 * with a newline. A line cut by the end of a chunk waits for the next chunk.
 */
export function createEventParser(): { push: (chunk: string) => DockerEvent[] } {
  let pending = ''
  return {
    push(chunk) {
      const lines = (pending + chunk).split('\n')
      pending = lines.pop() ?? ''
      const events: DockerEvent[] = []
      for (const line of lines) {
        const event = parseEventLine(line)
        if (event) events.push(event)
      }
      return events
    },
  }
}

/** The wait before reconnect number `attempt` (0 for the first retry). The last wait repeats. */
export function backoffMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), BACKOFF_MS.length - 1)
  return BACKOFF_MS[index] ?? BACKOFF_MS[BACKOFF_MS.length - 1] ?? 30_000
}

/** How long a refresh must wait so that refreshes start at least REFRESH_DEBOUNCE_MS apart. */
export function debounceWaitMs(lastStartAt: number, now: number): number {
  return Math.max(0, lastStartAt + REFRESH_DEBOUNCE_MS - now)
}

export interface FreshnessInput {
  /** false before the first read */
  hasValue: boolean
  /** when the read that made the value started (ms) */
  builtAt: number
  /** the version of the events counter when that read started */
  builtVersion: number
  /** the events counter now */
  version: number
  now: number
  /** true while the events stream is connected */
  streamUp: boolean
  /** the list is read again after this age, whatever the events say */
  maxAgeMs: number
}

/** True when a list must be read again: no value yet, an event since the read, or the value is too old. */
export function needsRefresh(input: FreshnessInput): boolean {
  if (!input.hasValue) return true
  if (input.builtVersion !== input.version) return true
  const age = input.now - input.builtAt
  if (age >= input.maxAgeMs) return true
  if (!input.streamUp && age >= DOWN_MAX_AGE_MS) return true
  return false
}

/** The key of the sidebar counts: they are read again when any of the versions has moved. */
export function countsKey(versions: Readonly<Record<EventKind, number>>): string {
  return EVENT_TYPES.map((kind) => versions[kind]).join(':')
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

/** One event counter per kind. An event adds one, and so does a (re)connect, since events may have been missed. */
const versions: Record<EventKind, number> = { container: 0, image: 0, volume: 0, network: 0 }

interface Snapshot<T> {
  value: T | null
  builtAt: number
  builtVersion: number
  lastStartAt: number
  inFlight: { version: number; promise: Promise<T> } | null
}

function newSnapshot<T>(): Snapshot<T> {
  return { value: null, builtAt: -Infinity, builtVersion: -1, lastStartAt: -Infinity, inFlight: null }
}

const containerSnapshot = newSnapshot<RawContainer[]>()
const imageSnapshot = newSnapshot<RawImage[]>()

let streamRunning = false
let streamUp = false
/** Failed attempts since the stream last opened. The reconnect wait is backoffMs(failures - 1). */
let failures = 0
let controller: AbortController | null = null
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let idleTimer: ReturnType<typeof setTimeout> | null = null
/** Resolves when the first attempt of the current run has connected or failed. Readers wait for it. */
let firstAttempt: Promise<void> = Promise.resolve()
let settleFirstAttempt: () => void = () => undefined

function bumpAll(): void {
  for (const kind of EVENT_TYPES) versions[kind] = versions[kind] + 1
  diskGen = diskGen + 1
}

function applyEvent(event: DockerEvent): void {
  const kind = staleKindOf(event)
  if (kind) versions[kind] = versions[kind] + 1
  if (changesDiskUsage(event)) diskGen = diskGen + 1
}

/**
 * Bumped when a container, image or volume is destroyed, and by every invalidation. The disk usage cache
 * (disk-usage.server.ts) compares it to know when its answer may be out of date.
 */
let diskGen = 0

export function diskGeneration(): number {
  return diskGen
}

/** True for the destroy events that change what the disk usage counts (containers, images and volumes). */
export function changesDiskUsage(event: DockerEvent): boolean {
  return (event.type === 'container' || event.type === 'image' || event.type === 'volume') && event.action === 'destroy'
}

/** Marks the lists stale. Call it after an action that changes containers, images, volumes or networks. */
export function invalidateDockerCache(): void {
  bumpAll()
}

function sleep(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()
}

// ---------------------------------------------------------------------------
// The events stream
// ---------------------------------------------------------------------------

async function runEventsOnce(signal: AbortSignal): Promise<void> {
  const response = await dockerFetch('GET', '/events', {
    query: { filters: JSON.stringify({ type: EVENT_TYPES }) },
    signal,
  })
  if (!response.ok || !response.body) {
    await response.body?.cancel()
    throw new Error(`Docker events answered HTTP ${response.status}.`)
  }
  // Connected. Anything that happened while the stream was down is unknown, so every list is stale.
  streamUp = true
  failures = 0
  bumpAll()
  settleFirstAttempt()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = createEventParser()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) return
    for (const event of parser.push(decoder.decode(value, { stream: true }))) applyEvent(event)
  }
}

function connect(): void {
  const attempt = new AbortController()
  controller = attempt
  runEventsOnce(attempt.signal)
    .catch(() => undefined)
    .finally(() => {
      // A stop or a newer run replaced this attempt: do nothing.
      if (controller !== attempt) return
      streamUp = false
      settleFirstAttempt()
      failures = failures + 1
      reconnectTimer = setTimeout(
        () => {
          reconnectTimer = null
          connect()
        },
        backoffMs(failures - 1),
      )
    })
}

function stopEvents(): void {
  streamRunning = false
  streamUp = false
  controller?.abort()
  controller = null
  if (reconnectTimer !== null) clearTimeout(reconnectTimer)
  reconnectTimer = null
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = null
}

/** Starts the stream when it is not running, and keeps it for another STREAM_IDLE_MS. Resolves after the first attempt. */
function ensureEvents(): Promise<void> {
  if (idleTimer !== null) clearTimeout(idleTimer)
  idleTimer = setTimeout(stopEvents, STREAM_IDLE_MS)
  idleTimer.unref()
  if (!streamRunning) {
    streamRunning = true
    failures = 0
    firstAttempt = new Promise((resolve) => {
      settleFirstAttempt = resolve
    })
    connect()
  }
  return firstAttempt
}

// ---------------------------------------------------------------------------
// The snapshots
// ---------------------------------------------------------------------------

/**
 * Returns the snapshot's value, reading it again when it needs it. A read that is already running is
 * shared when no event came after it started. Otherwise the read waits until the debounce time has passed.
 */
function readSnapshot<T>(snapshot: Snapshot<T>, kind: EventKind, maxAgeMs: number, load: () => Promise<T>): Promise<T> {
  const now = Date.now()
  const version = versions[kind]
  if (snapshot.inFlight && snapshot.inFlight.version === version) return snapshot.inFlight.promise
  if (
    snapshot.value !== null &&
    !needsRefresh({
      hasValue: true,
      builtAt: snapshot.builtAt,
      builtVersion: snapshot.builtVersion,
      version,
      now,
      streamUp,
      maxAgeMs,
    })
  ) {
    return Promise.resolve(snapshot.value)
  }
  if (snapshot.inFlight) {
    // A read is running, but an event came after it started. Read again once it has finished.
    const again = () => readSnapshot(snapshot, kind, maxAgeMs, load)
    return snapshot.inFlight.promise.then(again, again)
  }

  const promise = sleep(debounceWaitMs(snapshot.lastStartAt, now)).then(() => {
    const startedAt = Date.now()
    const startedVersion = versions[kind]
    snapshot.lastStartAt = startedAt
    return load().then((value) => {
      snapshot.value = value
      snapshot.builtAt = startedAt
      snapshot.builtVersion = startedVersion
      return value
    })
  })
  const entry = { version, promise }
  snapshot.inFlight = entry
  const clear = () => {
    if (snapshot.inFlight === entry) snapshot.inFlight = null
  }
  promise.then(clear, clear)
  return promise
}

async function fetchContainers(): Promise<RawContainer[]> {
  const raw = await dockerRequest<RawContainer[] | null>('GET', '/containers/json', { query: { all: 1 } })
  return raw ?? []
}

async function fetchImages(): Promise<RawImage[]> {
  const raw = await dockerRequest<RawImage[] | null>('GET', '/images/json')
  return raw ?? []
}

/** Every container of any state, as Docker lists them (GET /containers/json?all=1). */
export async function containerRows(): Promise<RawContainer[]> {
  await ensureEvents()
  return readSnapshot(containerSnapshot, 'container', CONTAINER_MAX_AGE_MS, fetchContainers)
}

/** Every image (not the intermediate layers), as Docker lists them (GET /images/json). */
export async function imageRows(): Promise<RawImage[]> {
  await ensureEvents()
  return readSnapshot(imageSnapshot, 'image', Infinity, fetchImages)
}

/** Every container, mapped for the UI. */
export async function listContainers(): Promise<ContainerSummary[]> {
  const rows = await containerRows()
  const self = selfContainerId()
  return rows.map((container) => toContainerSummary(container, self))
}

/** The ids of the running containers. */
export async function listRunningIds(): Promise<string[]> {
  const rows = await containerRows()
  return rows.filter((container) => container.State === 'running').map((container) => container.Id)
}

// ---------------------------------------------------------------------------
// The sidebar counts
// ---------------------------------------------------------------------------

let countsCache: { key: string; at: number; value: DockerCounts } | null = null
let countsInFlight: { key: string; promise: Promise<DockerCounts> } | null = null

/**
 * The numbers the sidebar shows. Containers and images come from the snapshots. Volumes and networks
 * come from their list endpoints, which are fast (no per-network inspect). The result is kept for
 * COUNTS_TTL_MS, and it is read again early when any version has moved.
 */
export async function dockerCounts(): Promise<DockerCounts> {
  await ensureEvents()
  const key = countsKey(versions)
  if (countsCache && countsCache.key === key && Date.now() - countsCache.at < COUNTS_TTL_MS) {
    return countsCache.value
  }
  if (countsInFlight && countsInFlight.key === key) return countsInFlight.promise

  const load = async (): Promise<DockerCounts> => {
    const [containers, images, volumes, networks] = await Promise.all([
      containerRows(),
      imageRows(),
      dockerRequest<{ Volumes?: unknown[] | null } | null>('GET', '/volumes'),
      dockerRequest<unknown[] | null>('GET', '/networks'),
    ])
    const value: DockerCounts = {
      containersRunning: containers.filter((container) => container.State === 'running').length,
      containers: containers.length,
      images: images.length,
      volumes: volumes?.Volumes?.length ?? 0,
      networks: networks?.length ?? 0,
    }
    countsCache = { key, at: Date.now(), value }
    return value
  }
  const promise = load()
  const entry = { key, promise }
  countsInFlight = entry
  const clear = () => {
    if (countsInFlight === entry) countsInFlight = null
  }
  promise.then(clear, clear)
  return promise
}
