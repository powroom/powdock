import { parseEnvLine, shortImageId } from '@/lib/container-details'
import type { IconKey } from '@/lib/image-icon'
import { baseOsFromHistory, detectStack, stackFromTags } from '@/lib/image-stack'
import type { ImageDetails, ImageHistoryEntry, ImageRemoval, ImageSummary } from '@/lib/types'
import { dockerRequest, mapLimit, type RawContainer } from './docker.server'
import { containerRows, imageRows } from './docker-cache.server'

/**
 * The Images page's calls to the Docker Engine: list, inspect, and remove. Read-only except for
 * remove. The mapping is pure and unit tested with fixtures (the tests never touch the socket).
 * Pulling is in image-pull.server.ts.
 */

/** One entry of GET /images/json (only the fields pow/dock reads). */
export interface RawImage {
  Id: string
  RepoTags?: string[] | null
  /** "name@sha256:..." for each registry the image was pulled from. Empty for an image built here. */
  RepoDigests?: string[] | null
  /** Unix time in seconds */
  Created: number
  Size: number
}

/** GET /images/{id}/json (only the fields pow/dock reads). Docker leaves any of them out. */
export interface RawImageInspect {
  Id?: string
  RepoTags?: string[] | null
  /** ISO 8601 with nanoseconds */
  Created?: string
  Size?: number
  Os?: string
  Architecture?: string
  Variant?: string
  Author?: string
  RootFS?: { Layers?: string[] | null }
  Config?: {
    Entrypoint?: string[] | null
    Cmd?: string[] | null
    WorkingDir?: string
    User?: string
    ExposedPorts?: Record<string, unknown> | null
    Env?: string[] | null
    Labels?: Record<string, string> | null
  }
}

/** One entry of GET /images/{id}/history. */
export interface RawHistory {
  /** Unix time in seconds, 0 when unknown */
  Created?: number
  CreatedBy?: string
  Size?: number
}

/** One entry of the list DELETE /images/{id} answers with. */
export interface RawRemoval {
  Untagged?: string
  Deleted?: string
}

/** Docker's placeholder for an image without a tag. */
const NO_TAG = '<none>:<none>'
const NONE = '<none>'

/** Splits "repo:tag". A colon before the last slash is a registry port, not a tag. */
export function splitTag(reference: string): { repository: string; tag: string } {
  const colon = reference.lastIndexOf(':')
  if (colon > reference.lastIndexOf('/')) {
    return { repository: reference.slice(0, colon), tag: reference.slice(colon + 1) }
  }
  return { repository: reference, tag: 'latest' }
}

/** The tags Docker lists, without the "<none>:<none>" placeholder. */
export function tagsOf(repoTags: readonly string[] | null | undefined): string[] {
  return (repoTags ?? []).filter((tag) => tag && tag !== NO_TAG)
}

/** Unix seconds as ISO text, or null when the value is missing or zero. */
function isoFromUnix(seconds: number | undefined): string | null {
  if (!seconds) return null
  return new Date(seconds * 1000).toISOString()
}

/** ISO text from the Engine, rounded to milliseconds, or null when it cannot be read. */
function isoFromText(value: string | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/** How many containers (of any state) use each image id. */
export function countContainersByImage(containers: readonly Pick<RawContainer, 'ImageID'>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const container of containers) {
    if (!container.ImageID) continue
    counts.set(container.ImageID, (counts.get(container.ImageID) ?? 0) + 1)
  }
  return counts
}

/** One image row. An image with several tags shows its first tag. The rest are in `tags`. */
export function toImageSummary(raw: RawImage, containerCounts: ReadonlyMap<string, number>): ImageSummary {
  const tags = tagsOf(raw.RepoTags)
  const first = tags[0] ? splitTag(tags[0]) : { repository: NONE, tag: NONE }
  return {
    id: raw.Id,
    shortId: shortImageId(raw.Id),
    tags,
    repository: first.repository,
    tag: first.tag,
    size: raw.Size,
    createdAt: isoFromUnix(raw.Created) ?? new Date(0).toISOString(),
    containers: containerCounts.get(raw.Id) ?? 0,
    dangling: tags.length === 0,
  }
}

/** The history rows the UI shows, newest first, as Docker lists them. */
export function toHistoryEntries(raw: readonly RawHistory[] | null | undefined): ImageHistoryEntry[] {
  return (raw ?? []).map((step) => ({
    createdBy: step.CreatedBy ?? '',
    size: step.Size ?? 0,
    createdAt: isoFromUnix(step.Created),
  }))
}

/** The details of one image, from GET /images/{id}/json and GET /images/{id}/history. */
export function toImageDetails(raw: RawImageInspect, history: readonly RawHistory[] | null | undefined): ImageDetails {
  const id = raw.Id ?? ''
  const config = raw.Config ?? {}
  return {
    id,
    shortId: shortImageId(id),
    tags: tagsOf(raw.RepoTags),
    createdAt: isoFromText(raw.Created),
    size: raw.Size ?? 0,
    os: raw.Os ?? '',
    architecture: raw.Architecture ?? '',
    variant: raw.Variant ?? '',
    author: raw.Author ?? '',
    entrypoint: config.Entrypoint ?? [],
    cmd: config.Cmd ?? [],
    workingDir: config.WorkingDir ?? '',
    user: config.User ?? '',
    exposedPorts: Object.keys(config.ExposedPorts ?? {}).sort(),
    env: (config.Env ?? []).map(parseEnvLine),
    labels: Object.entries(config.Labels ?? {})
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => ({ key, value })),
    layers: raw.RootFS?.Layers?.length ?? 0,
    history: toHistoryEntries(history),
  }
}

/** What DELETE /images/{id} removed. Docker lists one entry per untagged name and per deleted layer. */
export function toImageRemoval(raw: readonly RawRemoval[] | null | undefined): ImageRemoval {
  const untagged: string[] = []
  const deleted: string[] = []
  for (const entry of raw ?? []) {
    if (entry.Untagged) untagged.push(entry.Untagged)
    if (entry.Deleted) deleted.push(entry.Deleted)
  }
  return { untagged, deleted }
}

/** Every image (not the intermediate layers), with how many containers use it. */
export async function listImages(): Promise<ImageSummary[]> {
  const [images, containers] = await Promise.all([imageRows(), containerRows()])
  const counts = countContainersByImage(containers)
  return images.map((image) => toImageSummary(image, counts))
}

/** The details of one image. `id` is the full id or a short one (the route checks its form). */
export async function inspectImage(id: string): Promise<ImageDetails> {
  const base = `/images/${encodeURIComponent(id)}`
  const [inspect, history] = await Promise.all([
    dockerRequest<RawImageInspect | null>('GET', `${base}/json`),
    dockerRequest<RawHistory[] | null>('GET', `${base}/history`),
  ])
  return toImageDetails(inspect ?? {}, history)
}

/**
 * Removes an image. `force` also removes it when containers use it (Docker still refuses a running
 * one). Docker's own message comes back in the error, for example the 409 that names the container.
 */
/**
 * Removes a tag (`nginx:1.27`), or an image by ID when it has no tags. Docker deletes the image itself only
 * when the removed tag was its last one and no container uses it, so other tags of the same image stay.
 */
export async function removeImage(ref: string, options: { force: boolean }): Promise<ImageRemoval> {
  const raw = await dockerRequest<RawRemoval[] | null>('DELETE', `/images/${encodeURIComponent(ref)}`, {
    query: { force: options.force },
  })
  return toImageRemoval(raw)
}

/** How many image inspects run at once when the stacks of several images are read. */
const STACK_INSPECT_CONCURRENCY = 8

/**
 * The icon of each image id. An image id names one fixed config, so an answer is kept for good. The
 * Images and Containers pages only read it, so it needs no size limit beyond the images on the host.
 */
const stackCache = new Map<string, IconKey | null>()

/**
 * The icon key of one image: from its config, then its tags, then its base OS in the history. The history is
 * only read when the others name nothing. Throws when Docker cannot answer.
 */
async function inspectStack(id: string): Promise<IconKey | null> {
  const raw = await dockerRequest<RawImageInspect | null>('GET', `/images/${encodeURIComponent(id)}/json`)
  const config = raw?.Config ?? {}
  return (
    detectStack({
      env: config.Env ?? [],
      entrypoint: config.Entrypoint ?? null,
      cmd: config.Cmd ?? null,
      labels: config.Labels ?? {},
    }) ??
    stackFromTags(raw?.RepoTags ?? []) ??
    baseOsFromHistory(await historyLines(id))
  )
}

/** The CreatedBy line of each step of an image's history, newest first. */
async function historyLines(id: string): Promise<string[]> {
  const history = await dockerRequest<RawHistory[] | null>('GET', `/images/${encodeURIComponent(id)}/history`)
  return (history ?? []).map((step) => step.CreatedBy ?? '')
}

/**
 * The icon of each image id, null when the config does not tell. Only the ids not in `cache` are
 * inspected, at most eight at a time. An image Docker no longer has (404) is cached as null. Any other
 * failure gives null for this call only, so the next call asks again.
 */
export async function resolveImageStacks(
  ids: readonly string[],
  cache: Map<string, IconKey | null>,
  inspect: (id: string) => Promise<IconKey | null>,
): Promise<Record<string, IconKey | null>> {
  const unique = [...new Set(ids)]
  const misses = unique.filter((id) => !cache.has(id))
  await mapLimit(misses, STACK_INSPECT_CONCURRENCY, async (id) => {
    try {
      cache.set(id, await inspect(id))
    } catch (error) {
      if ((error as { status?: unknown }).status === 404) cache.set(id, null)
    }
  })
  return Object.fromEntries(unique.map((id) => [id, cache.get(id) ?? null]))
}

/** The icon of each of the given images (see resolveImageStacks). */
export function imageStacks(ids: readonly string[]): Promise<Record<string, IconKey | null>> {
  return resolveImageStacks(ids, stackCache, inspectStack)
}
