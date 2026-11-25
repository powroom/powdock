import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { convertDockerRun } from '@/lib/docker-run'
import { EMPTY_COMPOSE_FILE, newProjectNameProblem } from '@/lib/new-project'
import { listProjects } from './compose.server'
import { rememberCreated } from './projects-store.server'

/**
 * New project: makes a folder with a compose.yaml, and remembers the project. It starts nothing.
 */

export type NewProjectSource = 'empty' | 'docker-run'

export interface NewProjectInput {
  name: string
  folder: string
  source: NewProjectSource
  command: string
}

export type CreateResult = { ok: true; name: string } | { ok: false; error: string }

/** The folder New project suggests: POWDOCK_PROJECTS_DIR (a ~ is the home folder), else ~/powdock-projects. */
export function projectsDir(): string {
  const setting = (process.env.POWDOCK_PROJECTS_DIR ?? '').trim()
  if (!setting) return path.join(os.homedir(), 'powdock-projects')
  return path.resolve(expandHome(setting))
}

function expandHome(value: string): string {
  if (value === '~') return os.homedir()
  if (value.startsWith('~/')) return path.join(os.homedir(), value.slice(2))
  return value
}

/** A full folder path (with ~ expanded), or null when the text is not a full path. */
export function resolveFolder(text: string): string | null {
  const expanded = expandHome(text.trim())
  if (!path.isAbsolute(expanded)) return null
  return path.resolve(expanded)
}

/** Creates the project. The folder must not exist yet, or be empty. The name must be new. */
export async function createProject(input: NewProjectInput): Promise<CreateResult> {
  const fail = (error: string): CreateResult => ({ ok: false, error })
  const problem = newProjectNameProblem(input.name)
  if (problem) return fail(problem)
  const folder = resolveFolder(input.folder)
  if (folder === null) return fail('Use a full folder path, such as ~/projects/web.')

  let yaml = EMPTY_COMPOSE_FILE
  if (input.source === 'docker-run') {
    const conversion = convertDockerRun(input.command)
    if (conversion.error) return fail(conversion.error)
    yaml = conversion.yaml
  }

  const existing = await listProjects()
  if (existing.some((project) => project.name === input.name)) {
    return fail(`A project named ${input.name} already exists.`)
  }

  const info = await stat(folder).catch(() => null)
  if (info) {
    if (!info.isDirectory()) return fail('That path is a file. Choose a folder.')
    if ((await readdir(folder)).length > 0) return fail('The folder is not empty. Choose a new or empty folder.')
  }

  await mkdir(folder, { recursive: true, mode: 0o755 })
  const file = path.join(folder, 'compose.yaml')
  try {
    await writeFile(file, yaml, { flag: 'wx', mode: 0o644 })
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'EEXIST') return fail('The folder already has a compose.yaml file.')
    return fail(`Could not write the file: ${(err as Error).message}`)
  }

  await rememberCreated({
    name: input.name,
    workingDir: folder,
    configFiles: [file],
    createdByPowdock: true,
    lastSeen: new Date().toISOString(),
  })
  return { ok: true, name: input.name }
}
