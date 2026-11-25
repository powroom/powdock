import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import type { ProjectBase } from '@/lib/compose'
import {
  idleProjects,
  keepExisting,
  observeProjects,
  PROJECTS_FILE_NAME,
  projectsFileSchema,
  rememberProject,
  type RememberedProject,
} from '@/lib/projects-memory'
import { dataDir } from './data-dir.server'
import { parseDataFile, writeJsonFile } from './json-file.server'

/**
 * The projects pow/dock remembers, in projects.json in the data folder. Every read and write of the
 * file runs one at a time (see exclusive), so two requests never lose each other's change.
 */

function storeFile(): string {
  return path.join(dataDir(), PROJECTS_FILE_NAME)
}

let chain: Promise<unknown> = Promise.resolve()

/** Runs a task after the ones before it. A failed task does not stop the ones after it. */
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task)
  chain = next.catch(() => undefined)
  return next
}

/**
 * The remembered projects. A missing file is an empty list. A file that cannot be read or parsed is
 * also an empty list (with a warning), so the lists keep working. The next change rewrites the file.
 */
async function readRemembered(): Promise<RememberedProject[]> {
  const file = storeFile()
  let raw: string
  try {
    raw = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      console.warn(`[powdock] could not read ${PROJECTS_FILE_NAME}: ${(err as Error).message}`)
    }
    return []
  }
  try {
    return parseDataFile(raw, file, projectsFileSchema).projects
  } catch (err) {
    console.warn(`[powdock] ${(err as Error).message}. The remembered projects start over.`)
    return []
  }
}

async function writeRemembered(projects: RememberedProject[]): Promise<void> {
  await writeJsonFile(storeFile(), { projects })
}

/** The paths that are regular files now. Only the paths asked for are checked. */
async function existingFiles(paths: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(paths)]
  const found = await Promise.all(
    unique.map(async (file) => {
      const info = await stat(file).catch(() => null)
      return info?.isFile() ? file : null
    }),
  )
  return new Set(found.filter((file): file is string => file !== null))
}

/**
 * Remembers the projects that have containers now, drops the remembered ones whose config files are
 * gone, and returns the remembered projects with no containers (the idle ones). The file is written
 * only when something changed.
 */
export function syncRemembered(active: readonly ProjectBase[]): Promise<ProjectBase[]> {
  return exclusive(async () => {
    const known = await readRemembered()
    const seen = observeProjects(known, active, new Date())
    const activeNames = new Set(active.map((project) => project.name))
    const candidates = seen.projects.filter((entry) => !activeNames.has(entry.name))
    const present = await existingFiles(candidates.flatMap((entry) => entry.configFiles))
    const alive = new Set(keepExisting(candidates, (file) => present.has(file)).map((entry) => entry.name))
    const next = seen.projects.filter((entry) => activeNames.has(entry.name) || alive.has(entry.name))
    if (seen.changed || next.length !== known.length) await writeRemembered(next)
    return idleProjects(next, activeNames)
  })
}

/** Remembers a project that New project has just created. */
export function rememberCreated(entry: RememberedProject): Promise<void> {
  return exclusive(async () => {
    const known = await readRemembered()
    await writeRemembered(rememberProject(known, entry))
  })
}
