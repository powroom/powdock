/**
 * The log bridge: a WebSocket that carries the log stream of a container or a project to the browser.
 *
 * A browser allows six HTTP/1.1 connections per host, and each open log stream holds one, so a seventh
 * tab could not load. WebSockets are not limited that way, so the logs run over one. server.ts sends
 * GET /api/containers/<id>/logs and /api/projects/<name>/logs here when the request asks to upgrade.
 * The checks run before the upgrade, so a refused request gets a plain-text answer. After it, the
 * NDJSON stream of container-logs.server.ts or compose.server.ts goes out as text messages.
 */
import type { Server, ServerWebSocket } from 'bun'
import { CONTAINER_ID } from '@/api/validators'
import { PROJECT_NAME } from '@/lib/compose'
import { closeReason, isSameOrigin } from '@/lib/terminal-protocol'
import { SESSION_COOKIE, verifySession } from '@/server/auth.server'
import { containerLogsResponse } from '@/server/container-logs.server'
import { projectLogsResponse } from '@/server/compose.server'
import { readCookie } from '@/server/http/cookie'

/** The most past lines a logs request can ask for (the viewer offers "All" as this many). */
const MAX_TAIL = 10_000
/** Above this many unsent bytes, reading from Docker waits until the browser has caught up. */
const MAX_BUFFERED_BYTES = 1024 * 1024

export type LogTarget = { kind: 'container'; id: string } | { kind: 'project'; name: string }

export interface LogSocketData {
  kind: 'logs'
  target: LogTarget
  tail: number
  timestamps: boolean
  /** aborted when the browser closes the socket, which stops the Docker or Compose process */
  controller: AbortController | null
  /** resolves the wait for a slow browser (see MAX_BUFFERED_BYTES) */
  onDrain: (() => void) | null
}

function text(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}

/** The target of /api/containers/<id>/logs or /api/projects/<name>/logs, or null for any other path. */
export function logSocketTarget(pathname: string): LogTarget | null {
  const parts = pathname.split('/')
  if (parts.length !== 5 || parts[1] !== 'api' || parts[4] !== 'logs') return null
  const value = parts[3] ?? ''
  if (parts[2] === 'containers') return { kind: 'container', id: value }
  if (parts[2] === 'projects') return { kind: 'project', name: value }
  return null
}

/** Checks the query of a logs request. The error is the message to send back. */
export function parseLogParams(
  target: LogTarget,
  query: URLSearchParams,
): { tail: number; timestamps: boolean } | { error: string } {
  const tailParam = query.get('tail') ?? String(target.kind === 'container' ? 500 : 200)
  const tail = Number(tailParam)
  if (!/^\d+$/.test(tailParam) || tail > MAX_TAIL) {
    return { error: `tail must be a whole number from 0 to ${MAX_TAIL}.` }
  }
  const timestampsParam = query.get('timestamps') ?? '1'
  if (timestampsParam !== '0' && timestampsParam !== '1') return { error: 'timestamps must be 1 or 0.' }
  return { tail, timestamps: timestampsParam === '1' }
}

/**
 * Checks the request, then upgrades it to a WebSocket. Returns undefined when the upgrade happened,
 * and a plain-text error response otherwise.
 */
export async function upgradeLogs(request: Request, server: Server<LogSocketData>): Promise<Response | undefined> {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return text(403, 'Open the logs from pow/dock in your browser.')
  }
  if (!(await verifySession(readCookie(request, SESSION_COOKIE)))) return text(401, 'Sign in first.')

  const url = new URL(request.url)
  const target = logSocketTarget(url.pathname)
  if (!target) return text(404, 'No such log stream.')
  const valid = target.kind === 'container' ? CONTAINER_ID.test(target.id) : PROJECT_NAME.test(target.name)
  if (!valid) return text(400, target.kind === 'container' ? 'Invalid container ID.' : 'Invalid project name.')
  const params = parseLogParams(target, url.searchParams)
  if ('error' in params) return text(400, params.error)

  const data: LogSocketData = { kind: 'logs', target, ...params, controller: null, onDrain: null }
  if (server.upgrade(request, { data })) return undefined
  return text(500, 'Could not open the log stream.')
}

/** Sends the log stream as text messages until it ends, the browser leaves, or the stream fails. */
async function streamLogs(ws: ServerWebSocket<LogSocketData>, signal: AbortSignal): Promise<void> {
  const { target, tail, timestamps } = ws.data
  try {
    const response =
      target.kind === 'container'
        ? await containerLogsResponse(target.id, { tail, timestamps }, signal)
        : await projectLogsResponse(target.name, tail, signal)
    // A refused stream answers with a plain-text reason
    if (!response.ok || !response.body) {
      throw new Error((await response.text().catch(() => '')).trim() || 'Could not read the logs.')
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      const piece = decoder.decode(value, { stream: true })
      if (piece) ws.send(piece)
      // A slow browser: wait for the socket to drain, so unsent lines do not pile up in memory.
      if (ws.getBufferedAmount() > MAX_BUFFERED_BYTES && !signal.aborted) {
        await new Promise<void>((resolve) => {
          ws.data.onDrain = resolve
          signal.addEventListener('abort', () => resolve(), { once: true })
        })
        ws.data.onDrain = null
      }
    }
    const rest = decoder.decode()
    if (rest) ws.send(rest)
    ws.close(1000, 'ended')
  } catch (error) {
    // After the browser has left there is no socket to close
    if (!signal.aborted) {
      ws.close(1011, closeReason(error instanceof Error ? error.message : 'Could not read the logs.'))
    }
  }
}

/** The WebSocket handlers of the log bridge. The browser's messages are ignored. */
export const logSocketHandlers = {
  open(ws: ServerWebSocket<LogSocketData>): void {
    const controller = new AbortController()
    ws.data.controller = controller
    void streamLogs(ws, controller.signal)
  },
  drain(ws: ServerWebSocket<LogSocketData>): void {
    ws.data.onDrain?.()
  },
  close(ws: ServerWebSocket<LogSocketData>): void {
    ws.data.controller?.abort()
  },
}
