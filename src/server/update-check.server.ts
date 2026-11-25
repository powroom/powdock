import { APP_VERSION, isNewer, isVersion } from '@/lib/version'
import type { InstallMethod, ReleaseInfo, UpdateInfo } from '@/lib/version'

// Asks GitHub for the latest pow/dock release at most once a day. The only data sent is the
// User-Agent header (powdock/<version>). Set POWDOCK_UPDATE_CHECK=off to turn it off. A failed
// check is silent: the app works the same without it.

const DEFAULT_RELEASE_URL = 'https://api.github.com/repos/powroom/powdock/releases/latest'
const REQUEST_TIMEOUT_MS = 5_000
const SUCCESS_TTL_MS = 24 * 60 * 60 * 1000
const FAILURE_TTL_MS = 60 * 60 * 1000
const MAX_NOTES = 4000

type Env = Record<string, string | undefined>

export interface UpdateCheckOptions {
  now?: () => number
  fetch?: typeof fetch
  env?: Env
  /** the running version (default: APP_VERSION) */
  current?: string
}

type Fetched = { ok: true; release: ReleaseInfo | null } | { ok: false; reason: string }

interface Cached {
  release: ReleaseInfo | null
  expiresAt: number
}

/** docker and npm come from POWDOCK_INSTALL (set by the image and the npm launcher). Anything else is a source checkout. */
export function installMethod(env: Env): InstallMethod {
  const value = (env.POWDOCK_INSTALL ?? '').trim().toLowerCase()
  return value === 'docker' || value === 'npm' ? value : 'source'
}

/** Off when POWDOCK_UPDATE_CHECK is off, false or 0. On otherwise, including when it is not set. */
export function updateCheckEnabled(env: Env): boolean {
  const value = (env.POWDOCK_UPDATE_CHECK ?? '').trim().toLowerCase()
  return value !== 'off' && value !== 'false' && value !== '0'
}

function isWebLink(text: string): boolean {
  try {
    return new URL(text).protocol === 'https:'
  } catch {
    return false
  }
}

/** Reads GitHub's release JSON. Drafts and prereleases count as "no release". Anything else unexpected is a failure. */
export function parseReleaseResponse(data: unknown): Fetched {
  const unexpected: Fetched = { ok: false, reason: 'unexpected response from GitHub' }
  if (typeof data !== 'object' || data === null) return unexpected
  const fields = data as Record<string, unknown>
  if (fields.draft === true || fields.prerelease === true) return { ok: true, release: null }
  const tag = fields.tag_name
  const url = fields.html_url
  const publishedAt = fields.published_at
  const body = fields.body ?? ''
  if (typeof tag !== 'string' || typeof url !== 'string' || typeof publishedAt !== 'string') return unexpected
  if (typeof body !== 'string') return unexpected
  const version = tag.replace(/^v/, '')
  if (!isVersion(version) || !isWebLink(url)) return unexpected
  const notes = Array.from(body).slice(0, MAX_NOTES).join('')
  return { ok: true, release: { version, url, publishedAt, notes } }
}

function describeError(error: unknown): string {
  const name = (error as { name?: unknown } | null)?.name
  return name === 'TimeoutError' || name === 'AbortError' ? 'the request timed out' : 'could not reach GitHub'
}

async function fetchRelease(fetchImpl: typeof fetch, url: string, current: string): Promise<Fetched> {
  let response: Response
  try {
    response = await fetchImpl(url, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': `powdock/${current}` },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    return { ok: false, reason: describeError(error) }
  }
  // 404: the repository has no release yet, which is not an error
  if (response.status === 404) return { ok: true, release: null }
  if (!response.ok) return { ok: false, reason: `GitHub answered ${response.status}` }
  let data: unknown
  try {
    data = await response.json()
  } catch {
    return { ok: false, reason: 'the response is not JSON' }
  }
  return parseReleaseResponse(data)
}

/**
 * A checker with its own cache. The app uses one shared instance (getUpdateInfo below). Tests make
 * their own, with a fake clock and a fake fetch.
 */
export function createUpdateCheck(): (options?: UpdateCheckOptions) => Promise<UpdateInfo> {
  let cached: Cached | null = null
  let inFlight: Promise<ReleaseInfo | null> | null = null

  async function load(fetchImpl: typeof fetch, url: string, current: string, now: () => number) {
    const result = await fetchRelease(fetchImpl, url, current)
    const done = now()
    if (result.ok) {
      cached = { release: result.release, expiresAt: done + SUCCESS_TTL_MS }
      return result.release
    }
    // A failed check is not shown to anyone: it is retried after an hour, and the app keeps working.
    cached = { release: null, expiresAt: done + FAILURE_TTL_MS }
    return null
  }

  /** The latest release from the cache, or from one request shared by every caller that asks meanwhile. */
  function latestRelease(fetchImpl: typeof fetch, url: string, current: string, now: () => number) {
    if (cached && now() < cached.expiresAt) return Promise.resolve(cached.release)
    if (!inFlight) {
      inFlight = load(fetchImpl, url, current, now).finally(() => {
        inFlight = null
      })
    }
    return inFlight
  }

  return async function getUpdateInfo(options: UpdateCheckOptions = {}): Promise<UpdateInfo> {
    const env = options.env ?? process.env
    const current = options.current ?? APP_VERSION
    const install = installMethod(env)
    if (!updateCheckEnabled(env)) return { current, install, latest: null }

    const url = env.POWDOCK_UPDATE_URL?.trim() || DEFAULT_RELEASE_URL
    const release = await latestRelease(options.fetch ?? globalThis.fetch, url, current, options.now ?? Date.now)
    if (!release || !isNewer(release.version, current)) return { current, install, latest: null }
    return { current, install, latest: release }
  }
}

/** The shared checker used by the server function. Never throws and never logs: a failed check means latest is null. */
export const getUpdateInfo = createUpdateCheck()
