// The progress stream of POST /images/create, as the browser sees it. The server passes each JSON
// object of Docker's stream on as one NDJSON line. This module reads those lines, and folds them into
// the state the pull dialog shows (one row per layer, plus the overall state). Pure, so it is unit tested.

/** One JSON object of Docker's pull stream. Docker leaves out the fields it has no value for. */
export interface PullEvent {
  /** "Pulling fs layer", "Downloading", "Download complete", "Extracting", "Pull complete", ... or a whole line such as "Status: Image is up to date for nginx:1.27" */
  status?: string
  /** the layer id, when the line is about one layer */
  id?: string
  progressDetail?: { current?: number; total?: number }
  /** Docker's text progress bar, for people. Not used by the UI. */
  progress?: string
  error?: string
  errorDetail?: { message?: string }
}

/** Reads one stream line. Returns null for a blank line or one that is not a JSON object. */
export function parsePullLine(line: string): PullEvent | null {
  const trimmed = line.trim()
  if (!trimmed) return null
  try {
    const parsed: unknown = JSON.parse(trimmed)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? (parsed as PullEvent) : null
  } catch {
    return null
  }
}

/** Splits text that arrives in pieces into whole lines. The text after the last newline waits for the next piece. */
export function createPullLineReader(): { push(text: string): PullEvent[] } {
  let rest = ''
  return {
    push(text) {
      const combined = rest + text
      const lastNewline = combined.lastIndexOf('\n')
      if (lastNewline === -1) {
        rest = combined
        return []
      }
      rest = combined.slice(lastNewline + 1)
      const events: PullEvent[] = []
      for (const line of combined.slice(0, lastNewline).split('\n')) {
        const event = parsePullLine(line)
        if (event) events.push(event)
      }
      return events
    },
  }
}

/** One event as one NDJSON line. */
export function encodePullEvent(event: PullEvent): string {
  return `${JSON.stringify(event)}\n`
}

/** The state of one layer. `total` is 0 when Docker has not sent a size yet. */
export interface PullLayer {
  id: string
  status: string
  current: number
  total: number
  done: boolean
}

export interface PullProgress {
  layers: PullLayer[]
  /** the newest status line that is not about one layer */
  message: string
  /** Docker's error text, when the pull failed */
  error: string | null
  /** set when Docker reports the outcome of the pull */
  outcome: 'downloaded' | 'up-to-date' | null
}

export const EMPTY_PROGRESS: PullProgress = { layers: [], message: '', error: null, outcome: null }

/** Statuses that mean a layer needs no more work. */
const DONE_STATUSES = new Set(['Pull complete', 'Already exists'])

/** Folds one event into the progress. Events are applied in the order they arrive. */
export function applyPullEvent(progress: PullProgress, event: PullEvent): PullProgress {
  const errorText = event.errorDetail?.message || event.error
  if (errorText) return { ...progress, error: errorText }

  const status = event.status ?? ''
  // Docker puts the tag in "id" on its "Pulling from" line, so that line is a message, not a layer.
  if (event.id === undefined || status.includes('Pulling from ')) {
    const outcome = outcomeOf(status) ?? progress.outcome
    return { ...progress, message: status || progress.message, outcome }
  }

  const index = progress.layers.findIndex((layer) => layer.id === event.id)
  const previous = index === -1 ? undefined : progress.layers[index]
  const layer: PullLayer = {
    id: event.id,
    status,
    current: event.progressDetail?.current ?? previous?.current ?? 0,
    total: event.progressDetail?.total ?? previous?.total ?? 0,
    done: DONE_STATUSES.has(status),
  }
  const layers =
    index === -1 ? [...progress.layers, layer] : progress.layers.map((item, i) => (i === index ? layer : item))
  return { ...progress, layers }
}

/** The outcome named by a status line, or null. */
export function outcomeOf(status: string): PullProgress['outcome'] {
  if (status.includes('Downloaded newer image')) return 'downloaded'
  if (status.includes('Image is up to date')) return 'up-to-date'
  return null
}

/** Layers that are finished, out of all the layers seen so far. */
export function layerCounts(progress: PullProgress): { done: number; total: number } {
  return { done: progress.layers.filter((layer) => layer.done).length, total: progress.layers.length }
}
