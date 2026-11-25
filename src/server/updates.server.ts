import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { redactSecrets } from '@/lib/redact'
import {
  checkReference,
  CHECK_CONCURRENCY,
  CHECK_INTERVAL_MS,
  emptyStoredUpdates,
  FIRST_CHECK_DELAY_MS,
  isCheckDue,
  parseStoredUpdates,
  isImageIdText,
  planChecks,
  type CheckItem,
  type StoredUpdates,
  type UpdateResult,
  type UpdateState,
} from '@/lib/updates'
import { containerRows, imageRows } from './docker-cache.server'
import { dockerRequest, mapLimit, type RawContainer } from './docker.server'
import { dataDir } from './data-dir.server'
import { writeJsonFile } from './json-file.server'
import { updateCheckEnabled } from './update-check.server'

/**
 * Checks whether the image of each container has a newer version on its registry. The Engine answers
 * GET /distribution/{name}/json from the manifest only (nothing is downloaded), with the daemon's own
 * registry login. The results are kept in memory and in updates.json in the data folder, so they
 * survive a restart. Only one full check runs at a time. The pure parts are in src/lib/updates.ts.
 */

const FILE_NAME = 'updates.json'

/** The results, read from the data folder once. */
let stored: Promise<StoredUpdates> | null = null
/** The full check that runs now, shared by every caller that asks while it runs. */
let running: Promise<void> | null = null

function filePath(): string {
  return path.join(dataDir(), FILE_NAME)
}

async function readStored(): Promise<StoredUpdates> {
  try {
    return parseStoredUpdates(JSON.parse(await readFile(filePath(), 'utf8')))
  } catch {
    // no file yet, or a damaged one: start empty (the next check writes a good file)
    return emptyStoredUpdates()
  }
}

function current(): Promise<StoredUpdates> {
  if (stored === null) stored = readStored()
  return stored
}

/** The state the browser sees. */
export async function updateStatus(): Promise<UpdateState> {
  const saved = await current()
  return { lastCheckedAt: saved.lastCheckedAt, checking: running !== null, results: saved.results }
}

/** One registry check. Any failure is kept as "unknown" with a short reason, so one bad image never stops the rest. */
async function checkItem(item: CheckItem, checkedAt: string): Promise<UpdateResult> {
  const base = { reference: item.reference, checkedAt }
  try {
    const remote = await dockerRequest<{ Descriptor?: { digest?: string } } | null>(
      'GET',
      `/distribution/${encodeURIComponent(item.reference)}/json`,
    )
    const digest = remote?.Descriptor?.digest ?? ''
    if (!digest) return { ...base, status: 'unknown', error: 'The registry sent no digest.' }
    const { status, outdatedImageIds } = checkReference(digest, item)
    if (status === 'unknown') return { ...base, status, error: 'No local copy of this image to compare with.' }
    return { ...base, status, outdatedImageIds }
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The check failed.'
    return { ...base, status: 'unknown', error: redactSecrets(message) }
  }
}

/**
 * The name a container was created with. Docker lists an image ID instead when the tag has moved, so such a
 * container is inspected for its own Config.Image. Null when that fails.
 */
async function nameOf(container: RawContainer): Promise<string | null> {
  if (!isImageIdText(container.Image)) return container.Image
  try {
    const raw = await dockerRequest<{ Config?: { Image?: string } } | null>(
      'GET',
      `/containers/${encodeURIComponent(container.Id)}/json`,
    )
    return raw?.Config?.Image ?? null
  } catch {
    return null
  }
}

/** Reads the containers and images, checks each tagged reference (four at a time), and stores the results. */
async function runCheck(): Promise<void> {
  const [containers, images] = await Promise.all([containerRows(), imageRows()])
  const names = await mapLimit(containers, CHECK_CONCURRENCY, nameOf)
  const items = planChecks(
    containers.map((container, index) => ({ image: names[index] ?? '', imageId: container.ImageID ?? '' })),
    images.map((image) => ({ id: image.Id, repoDigests: image.RepoDigests ?? [] })),
  )
  const checkedAt = new Date().toISOString()
  const results = await mapLimit(items, CHECK_CONCURRENCY, (item) => checkItem(item, checkedAt))
  const next: StoredUpdates = {
    lastCheckedAt: checkedAt,
    results: Object.fromEntries(results.map((result) => [result.reference, result])),
  }
  stored = Promise.resolve(next)
  await writeJsonFile(filePath(), next)
}

/**
 * Runs a full check now. A call while one runs waits for that one (it does not start a second).
 * Resolves with the state when the check is done. Rejects when Docker cannot be read.
 */
export function checkUpdates(): Promise<UpdateState> {
  if (running === null) {
    running = runCheck().finally(() => {
      running = null
    })
  }
  return running.then(() => updateStatus())
}

/**
 * The automatic checks: the first one FIRST_CHECK_DELAY_MS after the server starts, then every
 * CHECK_INTERVAL_MS. A check is skipped when the last one is less than an hour old (a restart does not
 * check again at once). Off when POWDOCK_UPDATE_CHECK is off. The timers do not keep the process alive.
 */
let scheduled = false

export function scheduleUpdateChecks(env: Readonly<Record<string, string | undefined>> = process.env): void {
  if (scheduled || !updateCheckEnabled(env)) return
  scheduled = true
  const runIfDue = async (): Promise<void> => {
    const saved = await current()
    const last = saved.lastCheckedAt === null ? null : Date.parse(saved.lastCheckedAt)
    if (!isCheckDue(last, Date.now())) return
    // A failed check (Docker is down, for example) is tried again at the next tick.
    await checkUpdates().catch(() => undefined)
  }
  const first = setTimeout(() => void runIfDue(), FIRST_CHECK_DELAY_MS)
  first.unref()
  const timer = setInterval(() => void runIfDue(), CHECK_INTERVAL_MS)
  timer.unref()
}
