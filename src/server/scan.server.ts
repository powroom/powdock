import { access, readFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { parseStoredScans, parseTrivyReport, pruneScans, summariesOf, failureMessage } from '@/lib/scan'
import { redactSecrets } from '@/lib/redact'
import type { ScanPhase, ScanResult, ScanStatus, ScanSummary } from '@/lib/types'
import { imageRows } from './docker-cache.server'
import { socketPathFrom } from './docker.server'
import { dataDir } from './data-dir.server'
import { writeJsonFile } from './json-file.server'

/**
 * Vulnerability scans with Trivy. Trivy reads the image (it never pulls or changes one) and prints a JSON
 * report. The results are kept per image id in scans.json in the data folder. Only one scan runs at a
 * time, for the whole server; a second request for the same image waits for the running one. The pure
 * parts (the report, the badges, the stored-file rules) are in src/lib/scan.ts.
 */

const FILE_NAME = 'scans.json'
const TRIVY_TIMEOUT = '10m'
/** The message when no Trivy program is found. */
export const TRIVY_MISSING = 'Install Trivy to scan images. See https://trivy.dev'
/** How long a "Trivy is installed" answer is kept. A new install shows up within a minute. */
const AVAILABLE_TTL_MS = 60_000

let found: { at: number; path: string | null } | null = null

async function isExecutable(file: string): Promise<boolean> {
  try {
    await access(file, constants.X_OK)
    return true
  } catch {
    return false
  }
}

/** The Trivy program: $POWDOCK_TRIVY, else `trivy` on PATH, else ~/.local/bin/trivy. Null when none exists. */
async function findTrivy(): Promise<string | null> {
  const setting = process.env.POWDOCK_TRIVY
  if (setting) {
    if (!setting.includes('/')) return Bun.which(setting)
    return (await isExecutable(setting)) ? setting : null
  }
  const onPath = Bun.which('trivy')
  if (onPath) return onPath
  const local = path.join(homedir(), '.local', 'bin', 'trivy')
  return (await isExecutable(local)) ? local : null
}

/** The path of the Trivy program, or null when Trivy is not installed. The answer is kept for a minute. */
export async function scannerPath(): Promise<string | null> {
  const now = Date.now()
  if (found === null || now - found.at > AVAILABLE_TTL_MS) found = { at: now, path: await findTrivy() }
  return found.path
}

/** Trivy's cache folder (its default, or $TRIVY_CACHE_DIR). The vulnerability database lives in db/ there. */
export function trivyCacheDir(): string {
  if (process.env.TRIVY_CACHE_DIR) return process.env.TRIVY_CACHE_DIR
  const base = process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache')
  return path.join(base, 'trivy')
}

async function databaseReady(): Promise<boolean> {
  try {
    await access(path.join(trivyCacheDir(), 'db', 'trivy.db'), constants.R_OK)
    return true
  } catch {
    return false
  }
}

/** The arguments after the program name. No shell: each one is a separate argv entry. */
export function trivyArgs(imageId: string): string[] {
  return [
    'image',
    '--quiet',
    '--format',
    'json',
    '--scanners',
    'vuln',
    '--timeout',
    TRIVY_TIMEOUT,
    '--image-src',
    'docker',
    imageId,
  ]
}

interface Active {
  imageId: string
  /** true when no vulnerability database existed when the scan started */
  firstRun: boolean
}

/** Scans that run or wait, by image id. A second request for an id joins the one already here. */
const jobs = new Map<string, Promise<ScanResult>>()
let active: Active | null = null
/** Each scan starts after the one before it. A failed scan does not stop the next. */
let queue: Promise<unknown> = Promise.resolve()

/** Starts Trivy with the same Docker socket as the rest of pow/dock. */
function spawnTrivy(program: string, imageId: string) {
  try {
    return Bun.spawn([program, ...trivyArgs(imageId)], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, DOCKER_HOST: `unix://${socketPathFrom(process.env)}` },
    })
  } catch {
    throw new Error(`Could not start Trivy at ${program}.`)
  }
}

async function runTrivy(program: string, imageId: string): Promise<string> {
  const proc = spawnTrivy(program, imageId)
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])
  if (code !== 0) throw new Error(redactSecrets(failureMessage(err)))
  return out
}

async function runScan(imageId: string): Promise<ScanResult> {
  const program = await scannerPath()
  if (program === null) throw new Error(TRIVY_MISSING)
  active = { imageId, firstRun: !(await databaseReady()) }
  try {
    const out = await runTrivy(program, imageId)
    let raw: unknown
    try {
      raw = JSON.parse(out)
    } catch {
      throw new Error('Trivy gave a report that could not be read.')
    }
    const result = parseTrivyReport(raw, imageId, new Date().toISOString())
    await saveResult(result)
    return result
  } finally {
    active = null
  }
}

/**
 * Scans one image (by its full id) and returns the result. It waits its turn behind the scans before it.
 * The promise settles when this scan is done, so the caller gets the result or the error message.
 */
export function scanImage(imageId: string): Promise<ScanResult> {
  const running = jobs.get(imageId)
  if (running) return running
  const job = queue.then(() => runScan(imageId))
  const tracked = job.finally(() => jobs.delete(imageId))
  jobs.set(imageId, tracked)
  queue = tracked.catch(() => undefined)
  return tracked
}

/** Whether Trivy is installed, whether its database exists, and which scans run or wait. */
export async function scanStatus(): Promise<ScanStatus> {
  const available = (await scannerPath()) !== null
  const ready = await databaseReady()
  const scans = [...jobs.keys()].map((imageId) => {
    let phase: ScanPhase = 'queued'
    if (active?.imageId === imageId) phase = active.firstRun && !ready ? 'downloading' : 'scanning'
    return { imageId, phase }
  })
  return { available, databaseReady: ready, scans }
}

// The stored scans. Every change runs one at a time (see exclusive), so two requests never lose each
// other's change.

let cached: Record<string, ScanResult> | null = null
let storeChain: Promise<unknown> = Promise.resolve()

function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = storeChain.then(task, task)
  storeChain = next.catch(() => undefined)
  return next
}

function storeFile(): string {
  return path.join(dataDir(), FILE_NAME)
}

/** The stored scans, read once. A missing or damaged file is an empty store (a damaged one is logged). */
async function loadStore(): Promise<Record<string, ScanResult>> {
  if (cached !== null) return cached
  try {
    cached = parseStoredScans(JSON.parse(await readFile(storeFile(), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[powdock] could not read ${FILE_NAME}. The scan results start over.`)
    }
    cached = {}
  }
  return cached
}

async function writeStore(scans: Record<string, ScanResult>): Promise<void> {
  cached = scans
  await writeJsonFile(storeFile(), { scans })
}

async function saveResult(result: ScanResult): Promise<void> {
  await exclusive(async () => {
    const scans = await loadStore()
    await writeStore(pruneScans({ ...scans, [result.imageId]: result }).scans)
  })
}

/** The summaries of every stored scan, by image id. Scans of images Docker no longer has are dropped first. */
export function scanSummaries(): Promise<Record<string, ScanSummary>> {
  return exclusive(async () => {
    const images = await imageRows()
    const scans = await loadStore()
    const pruned = pruneScans(scans, new Set(images.map((image) => image.Id)))
    if (pruned.changed) await writeStore(pruned.scans)
    return summariesOf(pruned.scans)
  })
}

/** The stored result of one image, or null when it was never scanned. */
export async function scanResult(imageId: string): Promise<ScanResult | null> {
  const scans = await exclusive(() => loadStore())
  return scans[imageId] ?? null
}
