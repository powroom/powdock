/**
 * The terminal bridge: a WebSocket from the browser to a shell in a running container.
 *
 * server.ts sends GET /api/containers/<id>/terminal here before its normal fetch path. The checks
 * (Origin, session, container ID, shell and size, running state) run before the upgrade, so a refused
 * request gets a plain JSON answer. After the upgrade, the bridge creates an exec with a TTY, starts
 * it on a raw Unix socket connection (Docker's hijacked stream), and passes bytes both ways.
 * The protocol is in src/lib/terminal-protocol.ts.
 */
import type { Server, ServerWebSocket, Socket, WebSocketHandler } from 'bun'
import { CONTAINER_ID } from '@/api/validators'
import {
  dockerErrorMessage,
  dockerRequest,
  socketPathFrom,
  unreachableMessage,
  API_VERSION,
} from '@/server/docker.server'
import { SESSION_COOKIE, verifySession } from '@/server/auth.server'
import { readCookie } from '@/server/http/cookie'
import { concatBytes, parseHttpHead, type HttpHead } from '@/server/terminal-http'
import {
  closeReason,
  errorEvent,
  execCommand,
  exitEvent,
  isSameOrigin,
  parseControlMessage,
  parseTerminalParams,
  readyEvent,
  type TerminalParams,
} from '@/lib/terminal-protocol'

/** At most this many terminals are open at once, across all browsers. */
export const MAX_TERMINALS = 20
const LIMIT_REASON = `Too many open terminals (${MAX_TERMINALS}). Close one and try again.`
/** After the shell exits, Docker can take a moment to mark the exec as finished. */
const EXIT_CODE_TRIES = 5
const EXIT_CODE_WAIT_MS = 100

export interface TerminalData {
  kind: 'terminal'
  containerId: string
  params: TerminalParams
  session: TerminalSession | null
}

type Phase = 'starting' | 'streaming' | 'ended' | 'failed'

interface TerminalSession {
  ws: ServerWebSocket<TerminalData>
  phase: Phase
  closed: boolean
  execId: string | null
  socket: Socket | null
  /** bytes of the Docker response that are not used yet */
  buffer: Uint8Array
  /** the parsed response head, once it has arrived */
  head: HttpHead | null
  /** the latest size, sent to Docker when the stream starts */
  size: { cols: number; rows: number }
  /** input typed before the stream started */
  pending: Uint8Array[]
}

const terminals = new Set<TerminalSession>()

function json(status: number, error: string): Response {
  return Response.json({ error }, { status })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error.'
}

/** The container ID of /api/containers/<id>/terminal, or null for any other path. */
export function terminalContainerId(pathname: string): string | null {
  const parts = pathname.split('/')
  if (parts.length !== 5 || parts[1] !== 'api' || parts[2] !== 'containers' || parts[4] !== 'terminal') return null
  return parts[3] ?? null
}

/** Asks Docker whether the container runs. 'missing' is a 404 from Docker. */
async function containerState(id: string): Promise<'running' | 'stopped' | 'missing'> {
  try {
    const raw = await dockerRequest<{ State?: { Status?: string } } | null>(
      'GET',
      `/containers/${encodeURIComponent(id)}/json`,
    )
    return raw?.State?.Status === 'running' ? 'running' : 'stopped'
  } catch (error) {
    if ((error as { status?: number }).status === 404) return 'missing'
    throw error
  }
}

/**
 * Checks the request, then upgrades it to a WebSocket. Returns undefined when the upgrade happened,
 * and a JSON error response otherwise.
 */
export async function upgradeTerminal(request: Request, server: Server<TerminalData>): Promise<Response | undefined> {
  if (!isSameOrigin(request.headers.get('origin'), request.headers.get('host'))) {
    return json(403, 'Open the terminal from pow/dock in your browser.')
  }
  if (!(await verifySession(readCookie(request, SESSION_COOKIE)))) return json(401, 'Sign in first.')

  const url = new URL(request.url)
  const id = terminalContainerId(url.pathname) ?? ''
  if (!CONTAINER_ID.test(id)) return json(400, 'Invalid container ID.')
  const params = parseTerminalParams(url.searchParams)
  if ('error' in params) return json(400, params.error)

  let state: 'running' | 'stopped' | 'missing'
  try {
    state = await containerState(id)
  } catch (error) {
    return json(503, messageOf(error))
  }
  if (state === 'missing') return json(404, 'No container has this ID.')
  if (state === 'stopped') return json(409, 'The container is not running. Start it to open a terminal.')

  const data: TerminalData = { kind: 'terminal', containerId: id, params, session: null }
  if (server.upgrade(request, { data })) return undefined
  return json(500, 'Could not open the terminal connection.')
}

export const terminalWebSocket: WebSocketHandler<TerminalData> = {
  open(ws) {
    void startSession(ws)
  },
  message(ws, message) {
    handleMessage(ws.data.session, message)
  },
  close(ws) {
    if (ws.data.session) endSession(ws.data.session)
  },
}

/** Creates the exec and opens the stream. The session is registered before the first await. */
async function startSession(ws: ServerWebSocket<TerminalData>): Promise<void> {
  if (terminals.size >= MAX_TERMINALS) {
    ws.close(1013, LIMIT_REASON)
    return
  }
  const { containerId, params } = ws.data
  const session: TerminalSession = {
    ws,
    phase: 'starting',
    closed: false,
    execId: null,
    socket: null,
    buffer: new Uint8Array(0),
    head: null,
    size: { cols: params.cols, rows: params.rows },
    pending: [],
  }
  ws.data.session = session
  terminals.add(session)
  try {
    const exec = await dockerRequest<{ Id: string }>('POST', `/containers/${encodeURIComponent(containerId)}/exec`, {
      body: {
        AttachStdin: true,
        AttachStdout: true,
        AttachStderr: true,
        Tty: true,
        Cmd: execCommand(params.shell),
        Env: ['TERM=xterm-256color'],
      },
    })
    session.execId = exec.Id
    await openStream(session, exec.Id)
  } catch (error) {
    failSession(session, messageOf(error))
  }
}

/** Connects to the Docker socket and starts the exec over the connection. */
async function openStream(session: TerminalSession, execId: string): Promise<void> {
  const socketPath = socketPathFrom(process.env)
  const socket = await Bun.connect({
    unix: socketPath,
    socket: {
      data: (_socket, bytes) => onBytes(session, bytes),
      end: () => void streamEnded(session),
      close: () => void streamEnded(session),
      error: (_socket, error) => failSession(session, `Lost the connection to Docker: ${error.message}`),
    },
  }).catch(() => {
    throw new Error(unreachableMessage(socketPath))
  })
  session.socket = socket
  if (session.closed) {
    socket.end()
    return
  }
  const body = JSON.stringify({ Detach: false, Tty: true })
  socket.write(
    `POST /${API_VERSION}/exec/${execId}/start HTTP/1.1\r\n` +
      'Host: docker\r\n' +
      'Content-Type: application/json\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: tcp\r\n' +
      `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  )
}

/** Bytes from Docker: the response head first, then terminal output (or an error body). */
function onBytes(session: TerminalSession, bytes: Uint8Array): void {
  if (session.closed || session.phase === 'failed' || session.phase === 'ended') return
  if (session.phase === 'streaming') {
    session.ws.send(bytes)
    return
  }
  session.buffer = concatBytes(session.buffer, bytes)
  if (session.head === null) {
    let head: HttpHead | null
    try {
      head = parseHttpHead(session.buffer)
    } catch (error) {
      failSession(session, messageOf(error))
      return
    }
    if (head === null) return
    session.head = head
    session.buffer = head.rest
  }
  const head = session.head
  if (head.status === 101 || head.status === 200) {
    startStreaming(session)
    return
  }
  // Docker answered with an error. Its JSON body says why, and Content-Length says when it is complete.
  if (head.contentLength === null || session.buffer.length >= head.contentLength) {
    failSession(session, startFailure(session))
  }
}

function startStreaming(session: TerminalSession): void {
  session.phase = 'streaming'
  const rest = session.buffer
  session.buffer = new Uint8Array(0)
  session.ws.send(readyEvent())
  if (rest.length > 0) session.ws.send(rest)
  if (session.execId) void resizeExec(session.execId, session.size.cols, session.size.rows)
  for (const chunk of session.pending) session.socket?.write(chunk)
  session.pending = []
}

/** The message for a stream that could not start, from Docker's error body when there is one. */
function startFailure(session: TerminalSession): string {
  const head = session.head
  if (!head) return 'Docker closed the connection before the shell started.'
  const length = head.contentLength ?? session.buffer.length
  const text = new TextDecoder().decode(session.buffer.subarray(0, length))
  return dockerErrorMessage(head.status, text)
}

/** The Docker stream ended: the shell exited. Reports the exit code and closes the WebSocket. */
async function streamEnded(session: TerminalSession): Promise<void> {
  if (session.closed || session.phase === 'ended' || session.phase === 'failed') return
  if (session.phase === 'starting') {
    failSession(session, startFailure(session))
    return
  }
  session.phase = 'ended'
  const code = session.execId ? await exitCodeOf(session.execId) : null
  if (session.closed) return
  session.ws.send(exitEvent(code))
  session.ws.close(1000, 'The shell exited.')
  endSession(session)
}

async function exitCodeOf(execId: string): Promise<number | null> {
  for (let attempt = 0; attempt < EXIT_CODE_TRIES; attempt += 1) {
    const info = await dockerRequest<{ ExitCode: number | null; Running: boolean } | null>(
      'GET',
      `/exec/${encodeURIComponent(execId)}/json`,
    ).catch(() => null)
    if (!info) return null
    if (!info.Running) return info.ExitCode
    await Bun.sleep(EXIT_CODE_WAIT_MS)
  }
  return null
}

async function resizeExec(execId: string, cols: number, rows: number): Promise<void> {
  // The exec can end at any moment, and a failed resize is harmless, so errors are ignored.
  await dockerRequest('POST', `/exec/${encodeURIComponent(execId)}/resize`, { query: { h: rows, w: cols } }).catch(
    () => undefined,
  )
}

/** A browser message: a JSON control message (text) or keyboard input (binary). */
function handleMessage(session: TerminalSession | null, message: string | Buffer): void {
  if (!session || session.closed || session.phase === 'ended' || session.phase === 'failed') return
  if (typeof message === 'string') {
    const control = parseControlMessage(message)
    if (!control) return
    session.size = { cols: control.cols, rows: control.rows }
    if (session.phase === 'streaming' && session.execId) {
      void resizeExec(session.execId, control.cols, control.rows)
    }
    return
  }
  const bytes = new Uint8Array(message)
  if (session.phase === 'streaming') session.socket?.write(bytes)
  else session.pending.push(bytes)
}

/** Sends the error to the browser and closes the WebSocket with a short reason. */
function failSession(session: TerminalSession, message: string): void {
  if (session.closed) return
  session.phase = 'failed'
  session.ws.send(errorEvent(message))
  session.ws.close(1011, closeReason(message))
  endSession(session)
}

/** Releases the session: the Docker socket is ended, and the session leaves the open count. */
function endSession(session: TerminalSession): void {
  if (session.closed) return
  session.closed = true
  terminals.delete(session)
  session.socket?.end()
}
