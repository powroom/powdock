import type { VolumeDetails, VolumeMount, VolumeSummary } from '@/lib/types'
import { isValidResourceName } from '@/lib/resource-names'
import { dockerRequest, type RawContainer } from './docker.server'
import { containerRows } from './docker-cache.server'

/**
 * The Volumes page's calls to the Docker Engine: list, sizes, inspect, create and remove. The mapping
 * is pure and unit tested with fixtures (the tests never touch the socket).
 */

/** One entry of GET /volumes (only the fields pow/dock reads). */
export interface RawVolume {
  Name: string
  Driver?: string
  Mountpoint?: string
  /** ISO 8601 time */
  CreatedAt?: string
  Labels?: Record<string, string> | null
  Scope?: string
  Options?: Record<string, string> | null
}

/** GET /volumes answers with the list under "Volumes". */
export interface RawVolumeList {
  Volumes?: RawVolume[] | null
}

/** One entry of GET /system/df?type=volume. Size is -1 when Docker has not worked it out. */
export interface RawVolumeUsage {
  Name: string
  UsageData?: { Size?: number; RefCount?: number } | null
}

export interface RawDiskUsage {
  Volumes?: RawVolumeUsage[] | null
}

const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project'
/** Docker names an anonymous volume with a random 64-character hex ID. */
const ANONYMOUS_NAME = /^[a-f0-9]{64}$/

/** A timestamp as ISO text, or null when it is missing or cannot be read. */
function isoOrNull(value: string | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

function sortedPairs(values: Record<string, string> | null | undefined): { key: string; value: string }[] {
  return Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }))
}

/**
 * The container mounts of each volume, keyed by volume name. A container that mounts a volume twice
 * gets two entries. Bind mounts and other mount types are left out.
 */
export function mountsByVolume(containers: readonly RawContainer[]): Map<string, VolumeMount[]> {
  const byVolume = new Map<string, VolumeMount[]>()
  for (const container of containers) {
    const name = (container.Names?.[0] ?? '').replace(/^\//, '') || container.Id.slice(0, 12)
    for (const mount of container.Mounts ?? []) {
      if (mount.Type !== 'volume' || !mount.Name) continue
      const entry: VolumeMount = {
        id: container.Id,
        name,
        running: container.State === 'running',
        destination: mount.Destination ?? '',
        readOnly: mount.RW === false,
      }
      byVolume.set(mount.Name, [...(byVolume.get(mount.Name) ?? []), entry])
    }
  }
  return byVolume
}

/** Docker 23 and newer mark the volumes it creates for a container's VOLUME lines with this label. */
const ANONYMOUS_LABEL = 'com.docker.volume.anonymous'

/**
 * A volume is anonymous when Docker gave it an ID as its name and either marked it with the anonymous
 * label (Docker 23+) or gave it no labels at all (older engines).
 */
export function isAnonymousVolume(raw: Pick<RawVolume, 'Name' | 'Labels'>): boolean {
  if (!ANONYMOUS_NAME.test(raw.Name)) return false
  const labels = raw.Labels ?? {}
  return ANONYMOUS_LABEL in labels || Object.keys(labels).length === 0
}

/** One row of the Volumes page. The size is not known here: the page fills it in from the sizes query. */
export function toVolumeSummary(raw: RawVolume, mounts: readonly VolumeMount[]): VolumeSummary {
  const users = new Map<string, { id: string; name: string; running: boolean }>()
  for (const mount of mounts) {
    if (!users.has(mount.id)) users.set(mount.id, { id: mount.id, name: mount.name, running: mount.running })
  }
  return {
    name: raw.Name,
    driver: raw.Driver || 'local',
    mountpoint: raw.Mountpoint ?? '',
    createdAt: isoOrNull(raw.CreatedAt),
    project: raw.Labels?.[COMPOSE_PROJECT_LABEL] || null,
    anonymous: isAnonymousVolume(raw),
    usedBy: [...users.values()],
    size: null,
  }
}

/** The details of one volume: its labels and options, and every container mount. */
export function toVolumeDetails(raw: RawVolume, mounts: readonly VolumeMount[]): VolumeDetails {
  return {
    name: raw.Name,
    driver: raw.Driver || 'local',
    mountpoint: raw.Mountpoint ?? '',
    createdAt: isoOrNull(raw.CreatedAt),
    scope: raw.Scope || 'local',
    labels: sortedPairs(raw.Labels),
    options: sortedPairs(raw.Options),
    usedBy: [...mounts],
  }
}

/** Volume name to size in bytes. Docker's -1 ("not known") becomes null. */
export function toVolumeSizes(raw: RawDiskUsage | null | undefined): Record<string, number | null> {
  const sizes: Record<string, number | null> = {}
  for (const volume of raw?.Volumes ?? []) {
    const size = volume.UsageData?.Size
    sizes[volume.Name] = size === undefined || size < 0 ? null : size
  }
  return sizes
}

/** Every volume, with the containers that mount it. Sizes come from volumeSizes (Docker is slow to report them). */
export async function listVolumes(): Promise<VolumeSummary[]> {
  const [list, containers] = await Promise.all([
    dockerRequest<RawVolumeList | null>('GET', '/volumes'),
    containerRows(),
  ])
  const mounts = mountsByVolume(containers)
  return (list?.Volumes ?? []).map((volume) => toVolumeSummary(volume, mounts.get(volume.Name) ?? []))
}

/** The size of every volume, in bytes (null when unknown). Docker computes this slowly on big hosts. */
export async function volumeSizes(): Promise<Record<string, number | null>> {
  const raw = await dockerRequest<RawDiskUsage | null>('GET', '/system/df', { query: { type: 'volume' } })
  return toVolumeSizes(raw)
}

/** The details of one volume (GET /volumes/{name}) with its container mounts. */
export async function inspectVolume(name: string): Promise<VolumeDetails> {
  assertVolumeName(name)
  const [raw, containers] = await Promise.all([
    dockerRequest<RawVolume>('GET', `/volumes/${encodeURIComponent(name)}`),
    containerRows(),
  ])
  return toVolumeDetails(raw, mountsByVolume(containers).get(name) ?? [])
}

function assertVolumeName(name: string): void {
  if (!isValidResourceName(name)) throw new Error('Invalid volume name.')
}

/**
 * Creates a local volume. An empty name lets Docker pick one. Docker's own refusal (for example, a
 * name that is taken) comes back in the error.
 */
export async function createVolume(options: {
  name?: string
  driver: 'local'
  labels?: Record<string, string>
}): Promise<VolumeSummary> {
  const name = options.name?.trim() ?? ''
  if (name) assertVolumeName(name)
  const raw = await dockerRequest<RawVolume>('POST', '/volumes/create', {
    body: { Name: name || undefined, Driver: options.driver, Labels: options.labels ?? {} },
  })
  return toVolumeSummary(raw, [])
}

/**
 * Removes a volume. Docker refuses a volume that a container uses (HTTP 409), and its message names
 * the container. That message comes back in the error.
 */
export async function removeVolume(name: string, options: { force: boolean }): Promise<void> {
  assertVolumeName(name)
  await dockerRequest('DELETE', `/volumes/${encodeURIComponent(name)}`, { query: { force: options.force } })
}
