import { createHash } from 'node:crypto'
import { access, chmod, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { constants as fsConstants } from 'node:fs'
import path from 'node:path'
import { composeErrorLine, configCheckArgv, MAX_CONFIG_BYTES } from '@/lib/compose'
import { redactSecrets } from '@/lib/redact'
import { composeAvailable, COMPOSE_MISSING, readTextFile, type Project } from './compose.server'

/**
 * The files of a Compose project that the Compose file tab shows and saves: its config files, and
 * the .env file of its folder when there is one. Nothing else. A save names a file by its exact path,
 * and only a path from this list is accepted.
 */

/** `docker compose config` is killed after this long, so a stuck check cannot hold the request forever. */
const CHECK_TIMEOUT_MS = 60_000
const MESSAGE_MAX_CHARS = 2000
const CHANGED = 'This file changed on disk. Reload it to see the new version.'

export interface ProjectFile {
  path: string
  /** the text, or null when pow/dock cannot read the file */
  text: string | null
  /** the SHA-256 of the text (null when text is null). The editor sends it back with a save. */
  hash: string | null
  /** true when pow/dock may write the file */
  writable: boolean
}

export type SaveResult =
  | { ok: true; text: string; hash: string }
  | { ok: false; reason: 'conflict' | 'invalid' | 'refused'; message: string; line: number | null }

/** The version of a text, as the editor compares it. */
export function textHash(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/** The paths of a project's files: the config files, then .env in the working folder when it exists. */
export async function projectFilePaths(project: Project): Promise<string[]> {
  const paths = [...project.configFiles]
  if (project.workingDir) {
    const env = path.join(project.workingDir, '.env')
    const info = await stat(env).catch(() => null)
    if (info?.isFile() && !paths.includes(env)) paths.push(env)
  }
  return paths
}

async function isWritable(file: string): Promise<boolean> {
  return access(file, fsConstants.W_OK).then(
    () => true,
    () => false,
  )
}

/** The files of a project with their text and version, for the Compose file tab. */
export async function readProjectFiles(project: Project): Promise<ProjectFile[]> {
  const paths = await projectFilePaths(project)
  return Promise.all(
    paths.map(async (file) => {
      const text = await readTextFile(file)
      return {
        path: file,
        text,
        hash: text === null ? null : textHash(text),
        writable: await isWritable(file),
      }
    }),
  )
}

/**
 * Checks new text with `docker compose config --quiet`, the way Compose reads the project: the file is
 * replaced by a hidden copy next to it, and the other config files stay as they are. Nothing is started.
 * Returns null when Compose accepts the text, or Docker's message (and the line, when it gives one).
 */
async function checkCompose(
  project: Project,
  target: string,
  content: string,
): Promise<{ message: string; line: number | null } | null> {
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.powdock-check.yaml`)
  await writeFile(temp, content, { flag: 'wx', mode: 0o600 })
  try {
    const argv = configCheckArgv(
      project.name,
      project.configFiles.map((file) => (file === target ? temp : file)),
    )
    const proc = Bun.spawn(argv, { cwd: project.workingDir, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    const timer = setTimeout(() => proc.kill(), CHECK_TIMEOUT_MS)
    const [out, err, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    clearTimeout(timer)
    if (code === 0) return null
    const raw = err.trim() || out.trim() || 'Docker Compose did not accept the file.'
    const message = redactSecrets(raw.split(temp).join(path.basename(target))).slice(0, MESSAGE_MAX_CHARS)
    return { message, line: composeErrorLine(message) }
  } finally {
    await unlink(temp).catch(() => undefined)
  }
}

/** Writes the text to a temporary file next to the target, keeps the mode, then renames it over the target. */
async function replaceFile(file: string, content: string): Promise<void> {
  const target = await realpath(file)
  const mode = (await stat(target)).mode & 0o777
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.powdock-save`)
  try {
    await writeFile(temp, content, { flag: 'w', mode: 0o600 })
    await chmod(temp, mode)
    await rename(temp, target)
  } catch (err) {
    await unlink(temp).catch(() => undefined)
    throw err
  }
}

/**
 * Saves one file of a project. The file must be one of the project's own (an exact match). A compose
 * file is checked before it is written. The save is refused when the file changed since the editor
 * read it (baseHash).
 */
export async function saveProjectFile(
  project: Project,
  file: string,
  content: string,
  baseHash: string,
): Promise<SaveResult> {
  const refused = (message: string): SaveResult => ({ ok: false, reason: 'refused', message, line: null })
  const known = await projectFilePaths(project)
  if (!known.includes(file)) return refused('This file is not part of the project.')
  if (Buffer.byteLength(content, 'utf8') > MAX_CONFIG_BYTES) return refused('The file is too big to save.')
  if (!(await composeAvailable())) return refused(COMPOSE_MISSING)
  if (!(await isWritable(file))) return refused('pow/dock cannot write this file.')

  const current = await readTextFile(file)
  if (current === null) return refused('pow/dock cannot read this file from here.')
  if (textHash(current) !== baseHash) return { ok: false, reason: 'conflict', message: CHANGED, line: null }
  if (content === current) return { ok: true, text: content, hash: baseHash }

  if (path.basename(file) !== '.env') {
    let failure: { message: string; line: number | null } | null
    try {
      failure = await checkCompose(project, file, content)
    } catch (err) {
      return refused(redactSecrets(`Could not check the file: ${(err as Error).message}`))
    }
    if (failure) return { ok: false, reason: 'invalid', message: failure.message, line: failure.line }
  }

  try {
    await replaceFile(file, content)
  } catch (err) {
    return refused(redactSecrets(`pow/dock could not save the file: ${(err as Error).message}`))
  }
  return { ok: true, text: content, hash: textHash(content) }
}
