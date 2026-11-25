import type { Subprocess } from 'bun'
import { isSameContainer, selfContainerId } from './docker.server'
import { containerRows, invalidateDockerCache } from './docker-cache.server'
import { HEARTBEAT_MS } from './container-logs.server'
import {
  actionSteps,
  createLineSplitter,
  encodeRunEvent,
  firstLines,
  groupProjects,
  isGeneratedConfig,
  logsArgv,
  MAX_CONFIG_BYTES,
  parseComposeLogLine,
  type ComposeEntry,
  type ProjectAction,
  type ProjectBase,
  type RunEvent,
} from '@/lib/compose'
import { encodeLogRecord, type LogRecord } from '@/lib/log-wire'
import { redactSecrets } from '@/lib/redact'
import { syncRemembered } from './projects-store.server'

/**
 * Docker Compose projects, built from the labels of the containers. Commands run as argument lists
 * (no shell), in the project's own folder, with the project's own config files. The client only
 * names the project and the action; every path comes from the labels here.
 */

export interface Project extends ProjectBase {
  /** a config file is in a .generated folder, or says it is generated in its first lines */
  generated: boolean
  /** every config file could be read by pow/dock */
  filesReadable: boolean
}

export const COMPOSE_MISSING = 'Needs the docker compose command on this machine.'
const NO_PROJECT = 'No containers belong to this project now.'
const SELF_PROJECT = 'pow/dock runs in this project, so pow/dock does not run its commands. Use a terminal instead.'
const BUSY = 'This project is already running a command. Wait for it to finish.'
const NO_FOLDER = 'pow/dock does not know the folder of this project.'
const NO_SERVICE = 'That service is not in this project.'

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** A Docker error as an HTTP answer. A missing Engine is 503. */
function errorResponse(err: unknown): Response {
  const status = (err as { status?: unknown }).status
  const message = err instanceof Error ? err.message : 'Could not read the projects.'
  return textResponse(typeof status === 'number' ? status : 503, redactSecrets(message))
}

// ---------------------------------------------------------------------------
// Is Compose here?
// ---------------------------------------------------------------------------

let composeProbe: Promise<boolean> | null = null

/** True when `docker compose` runs on this machine. Checked once per process. False without the binary (for example in the image). */
export function composeAvailable(): Promise<boolean> {
  if (composeProbe === null) composeProbe = probeCompose()
  return composeProbe
}

async function probeCompose(): Promise<boolean> {
  let proc: Subprocess<'ignore', 'ignore', 'ignore'>
  try {
    proc = Bun.spawn(['docker', 'compose', 'version'], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' })
  } catch {
    return false
  }
  return (await proc.exited) === 0
}

// ---------------------------------------------------------------------------
// The projects
// ---------------------------------------------------------------------------

/** The text of a file, or null when it is missing, unreadable or too big. */
export async function readTextFile(path: string): Promise<string | null> {
  try {
    const file = Bun.file(path)
    if (file.size > MAX_CONFIG_BYTES) return null
    return await file.text()
  } catch {
    return null
  }
}

async function withFileFacts(base: ProjectBase): Promise<Project> {
  const texts = await Promise.all(base.configFiles.map((path) => readTextFile(path)))
  const generated = base.configFiles.some((path, index) => {
    const text = texts[index] ?? null
    return isGeneratedConfig(path, text === null ? null : firstLines(text))
  })
  return { ...base, generated, filesReadable: texts.every((text) => text !== null) }
}

/** The Compose projects that have containers now. */
async function activeProjects(): Promise<ProjectBase[]> {
  const raw = await containerRows()
  const self = selfContainerId()
  const entries: ComposeEntry[] = raw.map((container) => ({
    labels: container.Labels ?? {},
    running: container.State === 'running',
    isSelf: isSameContainer(container.Id, self),
  }))
  return groupProjects(entries)
}

/**
 * Every Compose project: the ones with containers, with the state of their files, and the remembered
 * ones with no containers now (see projects-store.server.ts). Remembers the active ones as it goes.
 */
export async function listProjects(): Promise<Project[]> {
  const active = await activeProjects()
  const idle = await syncRemembered(active)
  const all = [...active, ...idle].sort((a, b) => a.name.localeCompare(b.name))
  return Promise.all(all.map(withFileFacts))
}

/** The remembered projects that have no containers now. Their state is not read (the list needs only the names). */
export async function listIdleProjects(): Promise<ProjectBase[]> {
  return syncRemembered(await activeProjects())
}

/** One project by name, or null when no container has its label. */
export async function findProject(name: string): Promise<Project | null> {
  const projects = await listProjects()
  return projects.find((project) => project.name === name) ?? null
}

// ---------------------------------------------------------------------------
// Running commands
// ---------------------------------------------------------------------------

/** Projects with a command running now. One at a time per project. */
const runningProjects = new Set<string>()

function spawnDocker(argv: readonly string[], cwd: string): Subprocess<'ignore', 'pipe', 'pipe'> {
  return Bun.spawn([...argv], { cwd, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
}

/** Calls `onLine` for each line of a process stream, as the bytes come. */
async function readLines(stream: ReadableStream<Uint8Array>, onLine: (line: string) => void): Promise<void> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  const splitter = createLineSplitter()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (const line of splitter.push(decoder.decode(value, { stream: true }))) onLine(line)
  }
  for (const line of [...splitter.push(decoder.decode()), ...splitter.flush()]) onLine(line)
}

/**
 * Runs an action on a project and streams its output as NDJSON (see src/lib/compose.ts). The steps
 * run in order, and a failed step stops the rest. The process is killed when the browser goes away.
 */
export async function projectRunResponse(
  name: string,
  run: { action: ProjectAction; volumes: boolean; service: string | null },
  signal: AbortSignal,
): Promise<Response> {
  if (!(await composeAvailable())) return textResponse(503, COMPOSE_MISSING)
  let project: Project | null
  try {
    project = await findProject(name)
  } catch (err) {
    return errorResponse(err)
  }
  if (!project) return textResponse(404, NO_PROJECT)
  if (project.containsSelf) return textResponse(403, SELF_PROJECT)
  if (!project.workingDir) return textResponse(422, NO_FOLDER)
  // the service must be one of this project's services: the client names it, the server checks it
  if (run.action === 'update-service' && (run.service === null || !project.services.includes(run.service))) {
    return textResponse(400, NO_SERVICE)
  }
  if (runningProjects.has(name)) return textResponse(409, BUSY)
  runningProjects.add(name)

  const steps = actionSteps(project.name, project.configFiles, run.action, run.volumes, run.service)
  const cwd = project.workingDir
  const encoder = new TextEncoder()
  let current: Subprocess<'ignore', 'pipe', 'pipe'> | null = null
  let closed = false
  const stop = () => {
    closed = true
    current?.kill()
  }
  signal.addEventListener('abort', stop, { once: true })

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        if (!closed) controller.enqueue(encoder.encode(encodeRunEvent(event)))
      }
      void (async () => {
        let code = 1
        try {
          for (const argv of steps) {
            if (closed) break
            current = spawnDocker(argv, cwd)
            const proc = current
            await Promise.all([
              readLines(proc.stdout, (line) => send({ s: 'out', m: line })),
              readLines(proc.stderr, (line) => send({ s: 'err', m: line })),
            ])
            code = await proc.exited
            if (code !== 0) break
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Could not start docker compose.'
          send({ s: 'err', m: redactSecrets(message) })
          code = 1
        } finally {
          runningProjects.delete(name)
          // The run may have started, stopped or removed containers: read the lists again next time.
          invalidateDockerCache()
        }
        send({ done: true, code })
        if (!closed) {
          closed = true
          controller.close()
        }
      })()
    },
    cancel() {
      stop()
      runningProjects.delete(name)
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}

// ---------------------------------------------------------------------------
// The merged logs
// ---------------------------------------------------------------------------

/**
 * The logs of every service of a project, followed, as NDJSON records with the service name split
 * off. Heartbeats keep the connection open. The process is killed when the browser goes away.
 */
export async function projectLogsResponse(name: string, tail: number, signal: AbortSignal): Promise<Response> {
  if (!(await composeAvailable())) return textResponse(503, COMPOSE_MISSING)
  let project: Project | null
  try {
    project = await findProject(name)
  } catch (err) {
    return errorResponse(err)
  }
  if (!project) return textResponse(404, NO_PROJECT)
  if (!project.workingDir) return textResponse(422, NO_FOLDER)

  const argv = logsArgv(project.name, project.configFiles, tail)
  const cwd = project.workingDir
  const encoder = new TextEncoder()
  let current: Subprocess<'ignore', 'pipe', 'pipe'> | null = null
  let closed = false
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const stop = () => {
    closed = true
    clearInterval(heartbeat)
    current?.kill()
  }
  signal.addEventListener('abort', stop, { once: true })

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (text: string) => {
        if (!closed) controller.enqueue(encoder.encode(text))
      }
      // a blank line at once, so the browser gets the response before the first log line
      write('\n')
      heartbeat = setInterval(() => write('\n'), HEARTBEAT_MS)
      void (async () => {
        try {
          current = spawnDocker(argv, cwd)
          const proc = current
          await Promise.all([
            readLines(proc.stdout, (line) => {
              const parsed = parseComposeLogLine(line)
              const record: LogRecord = { s: 'out', t: parsed.t, m: parsed.m, service: parsed.service }
              write(encodeLogRecord(record))
            }),
            readLines(proc.stderr, (line) => write(encodeLogRecord({ s: 'err', t: null, m: line, service: null }))),
          ])
          await proc.exited
        } catch (err) {
          const message = err instanceof Error ? err.message : 'Could not start docker compose.'
          write(encodeLogRecord({ s: 'err', t: null, m: redactSecrets(message), service: null }))
        } finally {
          clearInterval(heartbeat)
        }
        if (!closed) {
          closed = true
          controller.close()
        }
      })()
    },
    cancel() {
      stop()
    },
  })
  return new Response(body, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-store, no-transform',
      'X-Accel-Buffering': 'no',
    },
  })
}
