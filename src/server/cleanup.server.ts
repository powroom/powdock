import { isStoppedState } from '@/lib/cleanup-view'
import type {
  BuildCacheUsage,
  ContainerUsage,
  DiskUsage,
  ImageUsage,
  NetworkSummary,
  PruneResult,
  VolumeUsage,
} from '@/lib/types'
import { dockerRequest } from './docker.server'
import { tagsOf } from './images.server'
import { isAnonymousVolume, type RawVolume } from './volumes.server'
import { listNetworks } from './networks.server'

/**
 * The Cleanup page's calls to the Docker Engine: the disk usage summary (GET /system/df) and the prune calls.
 * The summary and the query builders are pure and unit tested with fixtures. Nothing in the tests touches the
 * socket. Each prune call can take labels: the UI never passes any, so only a label filter limits a prune.
 */

/** Build cache older than this counts as "older than a week". Docker's `until` filter takes hours. */
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const WEEK_FILTER = '168h'

/** One image of GET /system/df. `Containers` is -1 when Docker has not counted them. */
export interface RawDfImage {
  Id: string
  RepoTags?: string[] | null
  Size?: number
  Containers?: number
}

/** One container of GET /system/df. `SizeRw` is the writable layer, null or missing when not counted. */
export interface RawDfContainer {
  Id: string
  State?: string
  SizeRw?: number | null
}

/** One volume of GET /system/df, with its usage. `Size` is -1 when Docker has not worked it out. */
export interface RawDfVolume extends RawVolume {
  UsageData?: { Size?: number; RefCount?: number } | null
}

/** One entry of the build cache in GET /system/df. Times are ISO 8601 text. */
export interface RawBuildCache {
  ID?: string
  InUse?: boolean
  Size?: number
  CreatedAt?: string
  LastUsedAt?: string | null
}

/** GET /system/df (only the fields the Cleanup page reads). */
export interface RawDiskUsage {
  LayersSize?: number
  Images?: RawDfImage[] | null
  Containers?: RawDfContainer[] | null
  Volumes?: RawDfVolume[] | null
  BuildCache?: RawBuildCache[] | null
}

/** The response of each prune endpoint (only the fields pow/dock reads). */
interface RawPrune {
  SpaceReclaimed?: number | null
  ContainersDeleted?: string[] | null
  VolumesDeleted?: string[] | null
  NetworksDeleted?: string[] | null
  CachesDeleted?: string[] | null
  ImagesDeleted?: { Untagged?: string; Deleted?: string }[] | null
}

const sum = (values: readonly number[]): number => values.reduce((total, value) => total + value, 0)

/** A size Docker could not work out (-1, or missing) counts as 0 in the totals. */
function knownSize(size: number | undefined): number {
  return size !== undefined && size >= 0 ? size : 0
}

/** A time as milliseconds, or NaN when it is missing or cannot be read (such an entry never counts as old). */
function timeOf(text: string | null | undefined): number {
  return text ? Date.parse(text) : Number.NaN
}

export function summarizeImages(images: readonly RawDfImage[], layersSize: number | undefined): ImageUsage {
  const unused = images.filter((image) => image.Containers === 0)
  const dangling = images.filter((image) => tagsOf(image.RepoTags).length === 0)
  return {
    total: layersSize ?? sum(images.map((image) => knownSize(image.Size))),
    count: images.length,
    unused: sum(unused.map((image) => knownSize(image.Size))),
    unusedCount: unused.length,
    dangling: sum(dangling.map((image) => knownSize(image.Size))),
    danglingCount: dangling.length,
  }
}

export function summarizeContainers(containers: readonly RawDfContainer[]): ContainerUsage {
  const sizeOf = (container: RawDfContainer): number => container.SizeRw ?? 0
  const stopped = containers.filter((container) => isStoppedState(container.State ?? ''))
  return {
    count: containers.length,
    stoppedCount: stopped.length,
    size: sum(containers.map(sizeOf)),
    stoppedSize: sum(stopped.map(sizeOf)),
  }
}

/** A volume is unused when Docker counts no container that uses it (RefCount 0). Unknown usage is not unused. */
export function summarizeVolumes(volumes: readonly RawDfVolume[]): VolumeUsage {
  const unused = volumes.filter((volume) => volume.UsageData?.RefCount === 0)
  const anonymousUnused = unused.filter((volume) => isAnonymousVolume(volume))
  return {
    total: sum(volumes.map((volume) => knownSize(volume.UsageData?.Size))),
    count: volumes.length,
    unused: sum(unused.map((volume) => knownSize(volume.UsageData?.Size))),
    unusedCount: unused.length,
    anonymousUnused: sum(anonymousUnused.map((volume) => knownSize(volume.UsageData?.Size))),
    anonymousUnusedCount: anonymousUnused.length,
  }
}

/** The build cache. `nowMs` is passed in, so the week cut-off is testable. */
export function summarizeBuildCache(entries: readonly RawBuildCache[], nowMs: number): BuildCacheUsage {
  const cutoff = nowMs - WEEK_MS
  const reclaimable = entries.filter((entry) => !entry.InUse)
  const olderThanWeek = reclaimable.filter((entry) => timeOf(entry.LastUsedAt ?? entry.CreatedAt) < cutoff)
  return {
    total: sum(entries.map((entry) => knownSize(entry.Size))),
    count: entries.length,
    reclaimable: sum(reclaimable.map((entry) => knownSize(entry.Size))),
    reclaimableCount: reclaimable.length,
    olderThanWeek: sum(olderThanWeek.map((entry) => knownSize(entry.Size))),
    olderThanWeekCount: olderThanWeek.length,
  }
}

/** Custom networks with no container attached. Built-in networks never count. */
export function countUnusedNetworks(networks: readonly Pick<NetworkSummary, 'builtIn' | 'containers'>[]): number {
  return networks.filter((network) => !network.builtIn && network.containers.length === 0).length
}

/** The whole summary from the raw df response and the count of unused networks. */
export function summarizeDiskUsage(raw: RawDiskUsage, unusedNetworks: number, nowMs: number): DiskUsage {
  return {
    images: summarizeImages(raw.Images ?? [], raw.LayersSize),
    containers: summarizeContainers(raw.Containers ?? []),
    volumes: summarizeVolumes(raw.Volumes ?? []),
    buildCache: summarizeBuildCache(raw.BuildCache ?? [], nowMs),
    unusedNetworks,
  }
}

/**
 * The `filters` query value for a Docker call: a JSON object of name to list of values. Empty lists are
 * left out, and no filter at all gives undefined (so the query parameter is not sent).
 */
export function buildFilters(filters: Record<string, readonly string[] | undefined>): string | undefined {
  const present = Object.entries(filters).filter(([, values]) => values && values.length > 0)
  if (present.length === 0) return undefined
  return JSON.stringify(Object.fromEntries(present))
}

/** The label filter values: `key=value` or `key`. Blank entries are left out. */
function labelValues(labels: readonly string[] | undefined): string[] | undefined {
  const values = (labels ?? []).map((label) => label.trim()).filter(Boolean)
  return values.length > 0 ? values : undefined
}

/** The query of POST /containers/prune. */
export function containerPruneQuery(labels?: readonly string[]): Record<string, string | undefined> {
  return { filters: buildFilters({ label: labelValues(labels) }) }
}

/** The query of POST /images/prune: dangling images only, or every image no container uses (dangling=false). */
export function imagePruneQuery(options: {
  all: boolean
  labels?: readonly string[]
}): Record<string, string | undefined> {
  return { filters: buildFilters({ label: labelValues(options.labels), dangling: [options.all ? 'false' : 'true'] }) }
}

/**
 * The query of POST /volumes/prune. Docker 23 and newer keep named volumes unless the filter all=true is sent,
 * so the filter is sent only when named volumes are wanted too.
 */
export function volumePruneQuery(options: {
  named: boolean
  labels?: readonly string[]
}): Record<string, string | undefined> {
  return { filters: buildFilters({ label: labelValues(options.labels), all: options.named ? ['true'] : undefined }) }
}

/** The query of POST /networks/prune. */
export function networkPruneQuery(labels?: readonly string[]): Record<string, string | undefined> {
  return { filters: buildFilters({ label: labelValues(labels) }) }
}

/**
 * The query of POST /build/prune: every unused cache record (all=true), and only those last used more than a
 * week ago when olderThanWeek is set. Docker's build prune has no label filter, so it takes no labels.
 */
export function buildPruneQuery(options: { olderThanWeek: boolean }): { all: boolean; filters: string | undefined } {
  return { all: true, filters: buildFilters({ until: options.olderThanWeek ? [WEEK_FILTER] : undefined }) }
}

/** The result of a prune call. A missing size counts as 0. */
export function pruneResultOf(removed: number, spaceReclaimed: number | null | undefined): PruneResult {
  return { removed, spaceReclaimed: spaceReclaimed ?? 0 }
}

/** The images Docker deleted. Untagged entries are tags that were removed, not images, so they are not counted. */
export function countImagesDeleted(entries: RawPrune['ImagesDeleted']): number {
  return (entries ?? []).filter((entry) => Boolean(entry.Deleted)).length
}

/** The disk usage summary: GET /system/df and the network list, which are read at the same time. */
export async function readDiskUsage(): Promise<DiskUsage> {
  const [raw, networks] = await Promise.all([dockerRequest<RawDiskUsage | null>('GET', '/system/df'), listNetworks()])
  return summarizeDiskUsage(raw ?? {}, countUnusedNetworks(networks), Date.now())
}

export async function pruneContainers(options: { labels?: string[] } = {}): Promise<PruneResult> {
  const raw = await dockerRequest<RawPrune | null>('POST', '/containers/prune', {
    query: containerPruneQuery(options.labels),
  })
  return pruneResultOf(raw?.ContainersDeleted?.length ?? 0, raw?.SpaceReclaimed)
}

export async function pruneImages(options: { all: boolean; labels?: string[] }): Promise<PruneResult> {
  const raw = await dockerRequest<RawPrune | null>('POST', '/images/prune', {
    query: imagePruneQuery(options),
  })
  return pruneResultOf(countImagesDeleted(raw?.ImagesDeleted), raw?.SpaceReclaimed)
}

export async function pruneVolumes(options: { named: boolean; labels?: string[] }): Promise<PruneResult> {
  const raw = await dockerRequest<RawPrune | null>('POST', '/volumes/prune', {
    query: volumePruneQuery(options),
  })
  return pruneResultOf(raw?.VolumesDeleted?.length ?? 0, raw?.SpaceReclaimed)
}

export async function pruneNetworks(options: { labels?: string[] } = {}): Promise<PruneResult> {
  const raw = await dockerRequest<RawPrune | null>('POST', '/networks/prune', {
    query: networkPruneQuery(options.labels),
  })
  return pruneResultOf(raw?.NetworksDeleted?.length ?? 0, raw?.SpaceReclaimed)
}

export async function pruneBuildCache(options: { olderThanWeek: boolean }): Promise<PruneResult> {
  const raw = await dockerRequest<RawPrune | null>('POST', '/build/prune', {
    query: buildPruneQuery(options),
  })
  return pruneResultOf(raw?.CachesDeleted?.length ?? 0, raw?.SpaceReclaimed)
}
