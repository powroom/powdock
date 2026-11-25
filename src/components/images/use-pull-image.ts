import { useRef, useState } from 'react'
import {
  applyPullEvent,
  createPullLineReader,
  EMPTY_PROGRESS,
  type PullEvent,
  type PullProgress,
} from '@/lib/image-pull'

export type PullPhase = 'idle' | 'pulling' | 'done' | 'failed' | 'cancelled'

export interface PullState {
  phase: PullPhase
  progress: PullProgress
  /** why the pull failed, when it did */
  failure: string | null
}

const IDLE: PullState = { phase: 'idle', progress: EMPTY_PROGRESS, failure: null }
const PULL_URL = '/api/images/pull'

/** The text of a failed answer. The server sends plain text for those. */
async function errorText(response: Response): Promise<string> {
  return response
    .text()
    .then((text) => text.trim() || `Could not pull the image (HTTP ${response.status}).`)
    .catch(() => `Could not pull the image (HTTP ${response.status}).`)
}

/**
 * Asks the server to pull the image and hands each progress event to `onEvent` as it arrives.
 * It is a plain function (not in the component), so the read loop is not compiled by React Compiler.
 */
async function requestPull(reference: string, signal: AbortSignal, onEvent: (event: PullEvent) => void) {
  const response = await fetch(PULL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reference }),
    signal,
  })
  if (!response.ok) throw new Error(await errorText(response))
  if (!response.body) throw new Error('The pull stream is empty.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const lines = createPullLineReader()
  let done = false
  while (!done) {
    const read = await reader.read()
    done = read.done
    if (!read.done) {
      for (const event of lines.push(decoder.decode(read.value, { stream: true }))) onEvent(event)
    }
  }
}

/**
 * One pull at a time. `start` begins a pull, `cancel` aborts it, `reset` clears the last result.
 * `onFinished` runs once Docker reports a successful pull. Events that arrive after a cancel are ignored.
 */
export function usePullImage(onFinished: () => void) {
  const [state, setState] = useState<PullState>(IDLE)
  const controllerRef = useRef<AbortController | null>(null)

  const start = (reference: string) => {
    const controller = new AbortController()
    controllerRef.current = controller
    setState({ phase: 'pulling', progress: EMPTY_PROGRESS, failure: null })

    const onEvent = (event: PullEvent) => {
      if (controller.signal.aborted) return
      setState((prev) => ({ ...prev, progress: applyPullEvent(prev.progress, event) }))
    }
    const finish = (progress: PullProgress) => {
      if (controller.signal.aborted) return
      if (progress.error) {
        setState({ phase: 'failed', progress, failure: progress.error })
      } else if (progress.outcome) {
        setState({ phase: 'done', progress, failure: null })
        onFinished()
      } else {
        setState({ phase: 'failed', progress, failure: 'Docker ended the pull without a result.' })
      }
    }
    const fail = (err: unknown) => {
      if (controller.signal.aborted) return
      const message = err instanceof Error ? err.message : 'The pull failed.'
      setState((prev) => ({ phase: 'failed', progress: prev.progress, failure: message }))
    }

    // The progress is kept here, as the events arrive, so the final check sees all of them.
    let progress = EMPTY_PROGRESS
    requestPull(reference, controller.signal, (event) => {
      progress = applyPullEvent(progress, event)
      onEvent(event)
    })
      .then(() => finish(progress))
      .catch(fail)
  }

  const cancel = () => {
    controllerRef.current?.abort()
    setState((prev) => (prev.phase === 'pulling' ? { ...prev, phase: 'cancelled' } : prev))
  }

  const reset = () => {
    setState(IDLE)
  }

  return { state, start, cancel, reset }
}
