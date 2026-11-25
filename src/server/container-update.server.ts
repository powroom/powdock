import { recreateBody, type RecreateInspect } from '@/lib/container-recreate'
import { createPullLineReader, type PullEvent } from '@/lib/image-pull'
import { parseImageReference } from '@/lib/image-reference'
import { encodeRunEvent, type RunEvent } from '@/lib/compose'
import { redactSecrets } from '@/lib/redact'
import { normalizeReference } from '@/lib/updates'
import { invalidateDockerCache } from './docker-cache.server'
import { dockerErrorMessage, dockerFetch, dockerRequest, isSameContainer, selfContainerId } from './docker.server'

/**
 * Updates a container that is not a Compose service: pulls its image tag, creates a new container with the
 * same settings, swaps the names and removes the old container. Its volumes stay. The steps are streamed
 * as NDJSON run events (see src/lib/compose.ts), so the run panel shows them as they happen.
 *
 * The update is not stopped when the browser goes away: a half-done swap would leave the container missing.
 */

type Say = (message: string) => void

/** The containers being updated now. One update per container at a time. */
const runningUpdates = new Set<string>()

const SELF = 'pow/dock runs in this container. Update it from a terminal instead.'
const BUSY = 'This container is already being updated.'

function textResponse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

function messageOf(err: unknown, fallback: string): string {
  return redactSecrets(err instanceof Error ? err.message : fallback)
}

/** Pulls a tag. Each new status line goes to `say`. A failed pull throws with Docker's message. */
async function pullTag(reference: string, say: Say): Promise<void> {
  const parsed = parseImageReference(reference)
  const response = await dockerFetch('POST', '/images/create', {
    query: { fromImage: parsed.fromImage, tag: parsed.tag },
  })
  if (!response.ok || !response.body) {
    const text = await response.text().catch(() => '')
    throw new Error(redactSecrets(dockerErrorMessage(response.status, text)))
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const lines = createPullLineReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    for (const event of lines.push(decoder.decode(value, { stream: true }))) reportPull(event, say)
  }
}

/** One line of the pull stream. Progress bars are left out; errors throw. */
function reportPull(event: PullEvent, say: Say): void {
  const failure = event.error ?? event.errorDetail?.message
  if (failure) throw new Error(redactSecrets(failure))
  if (!event.status || event.progress !== undefined) return
  say(event.id ? `${event.id}: ${event.status}` : event.status)
}

/** Runs one cleanup step. A failure is reported as a line, and the rest still runs. */
async function attempt(say: Say, what: string, step: () => Promise<unknown>): Promise<void> {
  try {
    await step()
  } catch (err) {
    say(`${what} failed: ${messageOf(err, 'Docker did not answer.')}`)
  }
}

/**
 * The swap. Returns 0 when the container runs the new image, 1 when it was put back as it was.
 * The old container keeps its name until the new one is started, so a failed start can be undone.
 */
async function recreate(raw: RecreateInspect, say: Say): Promise<number> {
  const name = raw.Name.replace(/^\//, '')
  const oldId = raw.Id
  const shortOld = oldId.slice(0, 12)
  const oldName = `${name}-old-${shortOld}`
  const tempName = `${name}-next-${shortOld}`
  const wasRunning = raw.State?.Running === true
  const reference = raw.Config?.Image ?? ''

  say(`Pulling ${reference}`)
  await pullTag(reference, say)
  const fresh = await dockerRequest<{ Id?: string } | null>('GET', `/images/${encodeURIComponent(reference)}/json`)
  if (!fresh?.Id) throw new Error(`Docker has no image named ${reference} after the pull.`)
  if (fresh.Id === raw.Image) {
    say(`${name} already runs the newest image.`)
    return 0
  }

  say(`Creating ${tempName} from the new image`)
  const created = await dockerRequest<{ Id: string }>('POST', '/containers/create', {
    query: { name: tempName },
    body: recreateBody(raw),
  })
  const newId = created.Id
  let renamedOld = false
  try {
    if (wasRunning) {
      say(`Stopping ${name}`)
      await dockerRequest('POST', `/containers/${oldId}/stop`, { query: { t: 10 } })
    }
    say(`Renaming ${name} to ${oldName}`)
    await dockerRequest('POST', `/containers/${oldId}/rename`, { query: { name: oldName } })
    renamedOld = true
    say(`Renaming ${tempName} to ${name}`)
    await dockerRequest('POST', `/containers/${newId}/rename`, { query: { name } })
    if (wasRunning) {
      say(`Starting ${name}`)
      await dockerRequest('POST', `/containers/${newId}/start`)
    }
  } catch (err) {
    say(`The update failed: ${messageOf(err, 'Docker did not answer.')}. Putting the old container back.`)
    await attempt(say, `Removing ${tempName}`, () =>
      dockerRequest('DELETE', `/containers/${newId}`, { query: { force: true, v: false } }),
    )
    if (renamedOld) {
      await attempt(say, `Renaming ${oldName} back to ${name}`, () =>
        dockerRequest('POST', `/containers/${oldId}/rename`, { query: { name } }),
      )
    }
    if (wasRunning) await attempt(say, `Starting ${name}`, () => dockerRequest('POST', `/containers/${oldId}/start`))
    return 1
  }

  say(`Removing ${oldName}. Its volumes stay.`)
  await attempt(say, `Removing ${oldName}. Remove it yourself`, () =>
    dockerRequest('DELETE', `/containers/${oldId}`, { query: { force: false, v: false } }),
  )
  say(`${name} runs the new image now.`)
  return 0
}

/** The container's settings for the update, or a plain-text response that says why it cannot be updated. */
async function inspectOrResponse(id: string): Promise<RecreateInspect | Response> {
  try {
    return await dockerRequest<RecreateInspect>('GET', `/containers/${encodeURIComponent(id)}/json`)
  } catch (err) {
    const status = (err as { status?: unknown }).status
    return textResponse(typeof status === 'number' ? status : 503, messageOf(err, 'Could not read the container.'))
  }
}

/**
 * The update of one container, as an NDJSON stream of run events. Refusals (pow/dock itself, a paused
 * container, an image with no tag) are answered before the stream starts, with a status code.
 */
export async function containerUpdateResponse(id: string): Promise<Response> {
  if (isSameContainer(id, selfContainerId())) return textResponse(403, SELF)
  const found = await inspectOrResponse(id)
  if (found instanceof Response) return found
  const raw = found
  if (isSameContainer(raw.Id, selfContainerId())) return textResponse(403, SELF)
  if (runningUpdates.has(raw.Id)) return textResponse(409, BUSY)
  if (raw.State?.Paused === true) return textResponse(409, 'Unpause the container first.')
  if (normalizeReference(raw.Config?.Image ?? '') === null) {
    return textResponse(422, 'This container has no tag to pull. Its image was built here or pinned by a digest.')
  }

  runningUpdates.add(raw.Id)
  const encoder = new TextEncoder()
  let closed = false
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: RunEvent) => {
        if (!closed) controller.enqueue(encoder.encode(encodeRunEvent(event)))
      }
      void (async () => {
        let code = 1
        try {
          code = await recreate(raw, (m) => send({ s: 'out', m }))
        } catch (err) {
          send({ s: 'err', m: messageOf(err, 'The update failed.') })
          code = 1
        } finally {
          runningUpdates.delete(raw.Id)
          // The lists changed (the container is new, and maybe its image): read them again next time.
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
      // The browser left. The update still finishes (see the note at the top of this file).
      closed = true
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
