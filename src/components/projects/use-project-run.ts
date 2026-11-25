import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import { checkUpdatesFn } from '@/api/updates.functions'
import { actionTitle, createRunReader, type ProjectAction, type RunEvent } from '@/lib/compose'
import { keys } from '@/lib/queries'

export type RunPhase = 'idle' | 'running' | 'done' | 'failed'

export interface RunLine {
  /** counts every line of the run, so each one has a key that stays the same */
  seq: number
  s: 'out' | 'err'
  m: string
}

export interface RunState {
  phase: RunPhase
  /** the command the panel shows as its title */
  title: string
  lines: RunLine[]
  /** the exit code, once the command has finished */
  code: number | null
  /** why the command could not run at all (a refusal from the server, for example) */
  error: string | null
}

const IDLE: RunState = { phase: 'idle', title: '', lines: [], code: null, error: null }
/** The lines the panel keeps. The oldest go first. */
const MAX_RUN_LINES = 2000

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'The command failed.'
}

/** The text of a refused request. The server sends plain text for those. */
async function errorText(response: Response): Promise<string> {
  return response
    .text()
    .then((text) => text.trim() || `The command could not run (HTTP ${response.status}).`)
    .catch(() => `The command could not run (HTTP ${response.status}).`)
}

/**
 * Sends the command and hands each batch of events to `onEvents` as it arrives. Resolves to the exit
 * code. It is a plain function (not in the component), so the read loop is not compiled.
 */
async function requestRun(url: string, body: unknown, onEvents: (events: RunEvent[]) => void): Promise<number> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(await errorText(response))
  if (!response.body) throw new Error('The command output is empty.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const events = createRunReader()
  let code: number | null = null
  let done = false
  while (!done) {
    const read = await reader.read()
    done = read.done
    if (!read.done) {
      const batch = events.push(decoder.decode(read.value, { stream: true }))
      for (const event of batch) {
        if ('done' in event) code = event.code
      }
      if (batch.length > 0) onEvents(batch)
    }
  }
  if (code === null) throw new Error('The command ended without a result.')
  return code
}

/**
 * Runs one command at a time on any page that uses it: a Compose action, or the update of a standalone
 * container. The output is kept in `state` for the run panel. Leaving the page does not stop the command
 * (only closing the browser does, on the server, for Compose commands). The lists are refreshed when the
 * command ends. After an update, the update checks run again.
 */
export function useProjectRun() {
  const queryClient = useQueryClient()
  const [state, setState] = useState<RunState>(IDLE)
  const runningRef = useRef(false)
  const seqRef = useRef(0)

  const runUrl = (url: string, title: string, body: unknown, isUpdate: boolean) => {
    if (runningRef.current) return
    runningRef.current = true
    setState({ phase: 'running', title, lines: [], code: null, error: null })

    const onEvents = (events: RunEvent[]) => {
      const fresh: RunLine[] = []
      for (const event of events) {
        if ('done' in event) continue
        seqRef.current += 1
        fresh.push({ seq: seqRef.current, s: event.s, m: event.m })
      }
      if (fresh.length === 0) return
      setState((prev) => ({ ...prev, lines: [...prev.lines, ...fresh].slice(-MAX_RUN_LINES) }))
    }

    requestRun(url, body, onEvents)
      .then((code) => {
        setState((prev) => ({ ...prev, phase: code === 0 ? 'done' : 'failed', code }))
      })
      .catch((err: unknown) => {
        setState((prev) => ({ ...prev, phase: 'failed', error: messageOf(err) }))
      })
      .finally(() => {
        runningRef.current = false
        void queryClient.invalidateQueries({ queryKey: keys.containers })
        void queryClient.invalidateQueries({ queryKey: keys.projects })
        void queryClient.invalidateQueries({ queryKey: keys.images })
        if (isUpdate) {
          // The new image may fix the update badge: check again (a check that runs is joined).
          checkUpdatesFn()
            .then((next) => queryClient.setQueryData(keys.updates, next))
            .catch(() => undefined)
            .finally(() => queryClient.invalidateQueries({ queryKey: keys.updates }))
        }
      })
  }

  /** A Compose action on a project. `service` is set only for update-service. */
  const start = (name: string, action: ProjectAction, volumes: boolean, service: string | null = null) => {
    const url = `/api/projects/${encodeURIComponent(name)}/run`
    const body = service === null ? { action, volumes } : { action, volumes, service }
    runUrl(url, `${name}: ${actionTitle(action, volumes, service)}`, body, action === 'update-service')
  }

  /** The update of a container that is not a Compose service (see container-update.server.ts). */
  const startContainerUpdate = (id: string, name: string) => {
    runUrl(`/api/containers/${encodeURIComponent(id)}/update`, `Update ${name}`, {}, true)
  }

  return { state, start, startContainerUpdate, running: state.phase === 'running' }
}
