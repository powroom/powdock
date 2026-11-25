// Image update checks, the pure parts. The server asks the Engine which digest a tag points to now
// (GET /distribution/{name}/json, which reads the manifest only) and compares it with the digests
// the local image was pulled with (RepoDigests). The result is kept per reference, and it names the
// local images (by ID) that are behind, so a container or an image can be matched by its image ID.
// No I/O here, so the unit tests use plain fixtures.

export type UpdateStatus = 'current' | 'update' | 'unknown'

export interface UpdateResult {
  /** the reference as normalizeReference writes it, for example docker.io/library/nginx:1.27 */
  reference: string
  status: UpdateStatus
  /** ISO time of the check that made this result */
  checkedAt: string
  /** the local image IDs (sha256:...) that run this reference and are behind the registry */
  outdatedImageIds?: string[]
  /** why the status is unknown. Shown only in a tooltip, never as an error. */
  error?: string
}

/** What the browser gets: the last full check, whether one runs now, and the result of each reference. */
export interface UpdateState {
  lastCheckedAt: string | null
  checking: boolean
  /** by normalized reference */
  results: Record<string, UpdateResult>
}

/** A check does not run again when the last one is newer than this (the automatic ones; a button press always runs). */
export const MIN_CHECK_GAP_MS = 60 * 60 * 1000
/** The first automatic check runs this long after the server starts. */
export const FIRST_CHECK_DELAY_MS = 2 * 60 * 1000
/** The automatic checks repeat this often while the server runs. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
/** How many registry checks run at once. */
export const CHECK_CONCURRENCY = 4

const DEFAULT_REGISTRY = 'docker.io'
const REGISTRY_ALIASES: Readonly<Record<string, string>> = {
  'index.docker.io': DEFAULT_REGISTRY,
  'registry-1.docker.io': DEFAULT_REGISTRY,
}

/**
 * The full name of a repository, as Docker writes it in RepoDigests: the registry host, then the path.
 * A name without a host is on Docker Hub, and a single name there is in the "library" namespace:
 * "nginx" and "docker.io/nginx" both become "docker.io/library/nginx".
 */
export function normalizeRepository(name: string): string {
  const parts = name.trim().toLowerCase().split('/')
  const first = parts[0] ?? ''
  const hasHost = parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost')
  const rawHost = hasHost ? first : DEFAULT_REGISTRY
  const host = REGISTRY_ALIASES[rawHost] ?? rawHost
  const path = hasHost ? parts.slice(1) : parts
  const namespaced = host === DEFAULT_REGISTRY && path.length === 1 ? ['library', ...path] : path
  return [host, ...namespaced].join('/')
}

/**
 * The full tagged name of an image reference ("nginx" becomes "docker.io/library/nginx:latest").
 * Null for the references that are not checked: an image ID (sha256:...), a digest reference (name@sha256:...),
 * and the "<none>" placeholder of an image without a tag.
 */
export function normalizeReference(ref: string): string | null {
  const text = ref.trim()
  if (!text || text === '<none>' || text.startsWith('sha256:') || text.includes('@')) return null
  const slash = text.lastIndexOf('/')
  const colon = text.lastIndexOf(':')
  const hasTag = colon > slash
  const repository = hasTag ? text.slice(0, colon) : text
  const tag = hasTag ? text.slice(colon + 1) : 'latest'
  if (!repository || !tag || tag === '<none>') return null
  return `${normalizeRepository(repository)}:${tag}`
}

/**
 * True when a container's Image text is an image ID rather than a name. Docker shows the ID once the tag
 * has moved to another image (after a pull, for example). Such a container needs its own inspect for the name.
 */
export function isImageIdText(text: string): boolean {
  return /^(sha256:)?[a-f0-9]{12,64}$/.test(text.trim())
}

/** The repository part of a normalized reference (the tag is cut off). */
export function repositoryOf(reference: string): string {
  const colon = reference.lastIndexOf(':')
  return colon > reference.lastIndexOf('/') ? reference.slice(0, colon) : reference
}

/** One RepoDigests entry ("busybox@sha256:...") split into its normalized repository and its digest. Null when it has no digest. */
export function parseRepoDigest(entry: string): { repository: string; digest: string } | null {
  const at = entry.lastIndexOf('@')
  if (at <= 0) return null
  return { repository: normalizeRepository(entry.slice(0, at)), digest: entry.slice(at + 1) }
}

/**
 * Compares the digest the registry gives for a tag with the digests the local image was pulled with, for
 * the same repository. "current" when one matches, "update" when the repository has digests and none
 * matches, and "unknown" when the local image has no digest for this repository (it was built here, or
 * pulled under another name).
 */
export function compareDigests(remote: string, repoDigests: readonly string[], repository: string): UpdateStatus {
  const local = repoDigests.flatMap((entry) => {
    const parsed = parseRepoDigest(entry)
    return parsed && parsed.repository === repository ? [parsed.digest] : []
  })
  if (local.length === 0) return 'unknown'
  return local.includes(remote) ? 'current' : 'update'
}

/** One local image that runs a reference: its ID and its RepoDigests. */
export interface CheckImage {
  id: string
  repoDigests: readonly string[]
}

/** One reference to check: its normalized name, its repository, and each distinct local image that runs it. */
export interface CheckItem {
  reference: string
  repository: string
  images: readonly CheckImage[]
}

/** The container facts the plan needs: its image reference (a name, not an ID) and the ID of the image it runs. */
export interface ContainerImageFact {
  image: string
  imageId: string
}

/** The image facts the plan needs: its ID and its RepoDigests (empty for an image built here). */
export interface LocalImageFact {
  id: string
  repoDigests: readonly string[]
}

/**
 * The references to check: each tagged reference that a container uses, once, with every distinct image
 * a container runs under it. An image with no RepoDigests (built here) is skipped, and so is a container
 * whose image is not in the list.
 */
export function planChecks(containers: readonly ContainerImageFact[], images: readonly LocalImageFact[]): CheckItem[] {
  const byId = new Map(images.map((image) => [image.id, image]))
  const items = new Map<string, { reference: string; repository: string; images: Map<string, CheckImage> }>()
  for (const container of containers) {
    const reference = normalizeReference(container.image)
    const image = byId.get(container.imageId)
    if (reference === null || !image || image.repoDigests.length === 0) continue
    let item = items.get(reference)
    if (!item) {
      item = { reference, repository: repositoryOf(reference), images: new Map() }
      items.set(reference, item)
    }
    item.images.set(image.id, { id: image.id, repoDigests: image.repoDigests })
  }
  return [...items.values()].map((item) => ({ ...item, images: [...item.images.values()] }))
}

/**
 * The result of one reference, given the registry digest of its tag. Each local image under it is compared.
 * "update" when at least one is behind (its IDs are listed), "current" when all that can be compared match,
 * and "unknown" when none can be compared.
 */
export function checkReference(remote: string, item: CheckItem): { status: UpdateStatus; outdatedImageIds: string[] } {
  const compared = item.images.map((image) => ({
    id: image.id,
    status: compareDigests(remote, image.repoDigests, item.repository),
  }))
  const outdatedImageIds = compared.filter((entry) => entry.status === 'update').map((entry) => entry.id)
  if (outdatedImageIds.length > 0) return { status: 'update', outdatedImageIds }
  if (compared.some((entry) => entry.status === 'current')) return { status: 'current', outdatedImageIds }
  return { status: 'unknown', outdatedImageIds }
}

/**
 * True when an automatic check is due: none has run, or the last one is at least MIN_CHECK_GAP_MS old.
 * `lastCheckedMs` is the time of the last check in milliseconds (null when there was none).
 */
export function isCheckDue(lastCheckedMs: number | null, nowMs: number): boolean {
  if (lastCheckedMs === null) return true
  return nowMs - lastCheckedMs >= MIN_CHECK_GAP_MS
}

/** The stored check results (the data folder's updates.json), as they are kept between restarts. */
export interface StoredUpdates {
  lastCheckedAt: string | null
  results: Record<string, UpdateResult>
}

export function emptyStoredUpdates(): StoredUpdates {
  return { lastCheckedAt: null, results: {} }
}

const STATUSES: readonly string[] = ['current', 'update', 'unknown']

function isResult(value: unknown): value is UpdateResult {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return (
    typeof record.reference === 'string' &&
    typeof record.status === 'string' &&
    STATUSES.includes(record.status) &&
    typeof record.checkedAt === 'string' &&
    (record.error === undefined || typeof record.error === 'string') &&
    (record.outdatedImageIds === undefined ||
      (Array.isArray(record.outdatedImageIds) && record.outdatedImageIds.every((id) => typeof id === 'string')))
  )
}

/**
 * Reads the stored file. Anything that is not a valid result is dropped, so a damaged file loses only
 * the bad entries and never stops the server.
 */
export function parseStoredUpdates(value: unknown): StoredUpdates {
  if (typeof value !== 'object' || value === null) return emptyStoredUpdates()
  const record = value as Record<string, unknown>
  const lastCheckedAt = typeof record.lastCheckedAt === 'string' ? record.lastCheckedAt : null
  const results: Record<string, UpdateResult> = {}
  if (typeof record.results === 'object' && record.results !== null) {
    for (const [key, entry] of Object.entries(record.results)) {
      if (isResult(entry) && entry.reference === key) results[key] = entry
    }
  }
  return { lastCheckedAt, results }
}

/** The IDs of the local images that are behind: every image named by a result that says "update". */
export function updateImageIds(results: Readonly<Record<string, UpdateResult>>): Set<string> {
  const ids = new Set<string>()
  for (const result of Object.values(results)) {
    if (result.status !== 'update') continue
    for (const id of result.outdatedImageIds ?? []) ids.add(id)
  }
  return ids
}
