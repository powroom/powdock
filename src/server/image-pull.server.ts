import { dockerErrorMessage, dockerFetch } from './docker.server'
import { invalidateDockerCache } from './docker-cache.server'
import { createPullLineReader, encodePullEvent } from '@/lib/image-pull'
import type { ImageReference } from '@/lib/image-reference'
import { redactSecrets } from '@/lib/redact'

/**
 * Pulls an image and streams Docker's progress to the browser as NDJSON (one JSON object per line,
 * see src/lib/image-pull.ts). The Docker call stops when `signal` fires (the browser went away).
 * Errors before the stream starts are plain text responses. Errors inside the stream (a denied
 * pull, for example) are sent as lines, because Docker answers those with status 200.
 */

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** Docker's stream, re-sent line by line. Lines that are not JSON objects are dropped. */
function streamResponse(body: ReadableStream<Uint8Array>): Response {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  const lines = createPullLineReader()
  const encoder = new TextEncoder()

  // Reads until some lines are ready (or the stream ends). Errors from the reader go to the caller.
  const pump = async (controller: ReadableStreamDefaultController<Uint8Array>): Promise<void> => {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) {
        // The pull added an image (or a tag): read the image list again next time.
        invalidateDockerCache()
        controller.close()
        return
      }
      const events = lines.push(decoder.decode(value, { stream: true }))
      if (events.length > 0) {
        for (const event of events) controller.enqueue(encoder.encode(encodePullEvent(event)))
        return
      }
    }
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        return pump(controller).catch((err: unknown) => controller.error(err))
      },
      cancel() {
        invalidateDockerCache()
        return reader.cancel()
      },
    }),
    {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store, no-transform',
        'X-Accel-Buffering': 'no',
      },
    },
  )
}

/** The pull as a streamed response. `reference` must already be parsed (see src/lib/image-reference.ts). */
export async function imagePullResponse(reference: ImageReference, signal: AbortSignal): Promise<Response> {
  let upstream: Response
  try {
    upstream = await dockerFetch('POST', '/images/create', {
      query: { fromImage: reference.fromImage, tag: reference.tag },
      signal,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not pull the image.'
    return textResponse(503, redactSecrets(message))
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '')
    return textResponse(upstream.status, redactSecrets(dockerErrorMessage(upstream.status, text)))
  }
  return streamResponse(upstream.body)
}
