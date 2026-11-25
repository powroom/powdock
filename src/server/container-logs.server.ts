import { dockerErrorMessage, dockerFetch, dockerRequest } from './docker.server'
import { createLogDemuxer, type LogDemuxer, type LogLine } from './log-demux'
import type { RawInspect } from '@/lib/container-details'
import { redactSecrets } from '@/lib/redact'
import { encodeLogRecord, type LogRecord } from '@/lib/log-wire'

/**
 * The live log stream of one container: Docker's multiplexed logs, turned into NDJSON lines
 * (see src/lib/log-wire.ts). The stream stays open while the container runs, and ends when it stops.
 */

/** A quiet container sends nothing for a long time. A blank line goes out this often, so the connection is not idle. */
export const HEARTBEAT_MS = 20_000

export interface ContainerLogsOptions {
  /** how many lines from the end of the log to send first */
  tail: number
  timestamps: boolean
}

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** A Docker error as an HTTP answer. A missing container is 404, an unreachable Engine is 503. */
function errorResponse(err: unknown): Response {
  const status = (err as { status?: unknown }).status
  if (status === 404) return textResponse(404, 'This container no longer exists.')
  const message = err instanceof Error ? err.message : 'Could not read the logs.'
  return textResponse(typeof status === 'number' ? status : 503, redactSecrets(message))
}

function toRecord(line: LogLine): LogRecord {
  return { s: line.stream, t: line.timestamp, m: line.text }
}

/** Turns the Docker body into the NDJSON body. Each chunk is sent as soon as it has a whole line. */
function streamResponse(body: ReadableStream<Uint8Array>, demux: LogDemuxer): Response {
  const reader = body.getReader()
  const encoder = new TextEncoder()
  let heartbeat: ReturnType<typeof setInterval> | undefined
  const stopHeartbeat = () => clearInterval(heartbeat)

  const send = (controller: ReadableStreamDefaultController<Uint8Array>, lines: LogLine[]) => {
    for (const line of lines) controller.enqueue(encoder.encode(encodeLogRecord(toRecord(line))))
  }

  // Reads until some lines are ready (or the stream ends). Errors from the reader go to the caller.
  const pump = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        send(controller, demux.flush())
        stopHeartbeat()
        controller.close()
        return
      }
      const lines = demux.push(value)
      if (lines.length > 0) {
        send(controller, lines)
        return
      }
    }
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        // A blank line at once: the response (and its headers) reaches the browser right away, so a
        // container with no output shows "No output yet." instead of waiting for the first line.
        controller.enqueue(encoder.encode('\n'))
        heartbeat = setInterval(() => controller.enqueue(encoder.encode('\n')), HEARTBEAT_MS)
      },
      pull(controller) {
        return pump(controller).catch((err: unknown) => {
          stopHeartbeat()
          controller.error(err)
        })
      },
      cancel() {
        stopHeartbeat()
        return reader.cancel()
      },
    }),
    {
      headers: {
        'Content-Type': 'application/x-ndjson',
        // no-transform: gzip would hold the lines back until it has enough to write a block
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    },
  )
}

/**
 * The logs of a container as a streamed response. `signal` (the request's) stops the Docker call
 * when the browser goes away. Errors before the stream starts are plain text responses.
 */
export async function containerLogsResponse(
  id: string,
  options: ContainerLogsOptions,
  signal: AbortSignal,
): Promise<Response> {
  const base = `/containers/${encodeURIComponent(id)}`
  let tty = false
  try {
    const raw = await dockerRequest<RawInspect | null>('GET', `${base}/json`)
    tty = raw?.Config?.Tty === true
  } catch (err) {
    return errorResponse(err)
  }

  let upstream: Response
  try {
    upstream = await dockerFetch('GET', `${base}/logs`, {
      query: { follow: 1, stdout: 1, stderr: 1, tail: options.tail, timestamps: options.timestamps ? 1 : 0 },
      signal,
    })
  } catch (err) {
    return errorResponse(err)
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    return errorResponse(
      Object.assign(new Error(dockerErrorMessage(upstream.status, text)), { status: upstream.status }),
    )
  }
  return streamResponse(upstream.body, createLogDemuxer({ tty, timestamps: options.timestamps }))
}
