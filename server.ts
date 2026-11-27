/**
 * Production server for pow/dock (run `bun run build` first, then `bun run start`).
 *
 * - Serves the built client assets from memory (dist/client, read once at startup)
 * - Upgrades GET /api/containers/<id>/terminal to a WebSocket (src/server/terminal.server.ts)
 * - Upgrades the log streams of containers and projects to WebSockets (src/server/log-socket.server.ts)
 * - Forwards everything else to the TanStack Start handler
 * - Binds to 127.0.0.1 by default and rejects unknown Host headers. pow/dock can start and stop
 *   containers on this machine, so expose it on a network only behind your own authentication.
 *
 * Env: PORT (3434), HOST (127.0.0.1), POWDOCK_ALLOWED_HOSTS (comma separated),
 *      POWDOCK_DATA_DIR (./.data), POWDOCK_ADMIN_USER, POWDOCK_ADMIN_PASSWORD, POWDOCK_SESSION_DAYS,
 *      POWDOCK_SECURE_COOKIES, POWDOCK_TRUST_PROXY
 */
import path from 'node:path'
import type { Server, ServerWebSocket, WebSocketHandler } from 'bun'
import { acceptsEncoding, isSmallBody, mayCompress, shouldCompress } from '#/lib/compression'
import { IDLE_TIMEOUT_SECONDS, MAX_REQUEST_BODY_BYTES } from '#/lib/server-options'
import {
  assetKey,
  decodeRequestPath,
  isStaticRequestPath,
  loadAssetTable,
  notFoundResponse,
  serveAsset,
} from '#/lib/static-assets'
import { parsePort } from '#/lib/port'
import { logSocketHandlers, logSocketTarget, upgradeLogs, type LogSocketData } from '#/server/log-socket.server'
import { terminalContainerId, terminalWebSocket, upgradeTerminal, type TerminalData } from '#/server/terminal.server'
import { scheduleUpdateChecks } from '#/server/updates.server'

if (process.platform === 'win32') {
  console.error('[powdock] pow/dock does not run directly on Windows. Run it inside WSL 2: see docs/install.md#windows')
  process.exit(1)
}

const port = parsePort(process.env.PORT)
if (port === null) {
  console.error(`[powdock] PORT must be a whole number from 1 to 65535, not "${process.env.PORT}". Fix it or unset it.`)
  process.exit(1)
}
const hostname = process.env.HOST ?? '127.0.0.1'
const clientDir = path.join(import.meta.dir, 'dist', 'client')

const allowedHosts = new Set([
  'localhost',
  '127.0.0.1',
  '[::1]',
  ...(process.env.POWDOCK_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
])
if (hostname !== '127.0.0.1' && hostname !== 'localhost' && hostname !== '0.0.0.0') {
  allowedHosts.add(hostname.toLowerCase())
}

// built by `bun run build` (path kept in a variable so type-checking does not require the build)
const serverEntry = './dist/server/server.js'
const { default: app } = (await import(serverEntry)) as {
  default: { fetch: (request: Request) => Response | Promise<Response> }
}

// Held in memory for the life of the process.
const assets = await loadAssetTable(clientDir)

function hostAllowed(request: Request): boolean {
  const host = (request.headers.get('host') ?? '').toLowerCase().replace(/:\d+$/, '')
  return allowedHosts.has(host)
}

function forbidden(): Response {
  return new Response('Forbidden: unknown host. Add it to POWDOCK_ALLOWED_HOSTS.', { status: 403 })
}

/** Gzips a dynamic response when the client accepts it, the type is text-like and the body is not small. */
function compressResponse(request: Request, response: Response): Response {
  if (!response.body || response.status === 204 || response.status === 304) return response
  if (response.headers.has('content-encoding')) return response
  if (!mayCompress(response.headers.get('cache-control'))) return response
  if (!acceptsEncoding(request.headers.get('accept-encoding'), 'gzip')) return response
  if (!shouldCompress(response.headers.get('content-type'))) return response
  if (isSmallBody(response.headers.get('content-length'))) return response
  const headers = new Headers(response.headers)
  headers.set('Content-Encoding', 'gzip')
  headers.append('Vary', 'Accept-Encoding')
  headers.delete('Content-Length')
  return new Response(response.body.pipeThrough(new CompressionStream('gzip')), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

async function forward(request: Request): Promise<Response> {
  return compressResponse(request, await app.fetch(request))
}

/**
 * Requests that no exact asset route took: asset paths that need decoding, static paths that are
 * not in the table (fast 404), and everything else for the app.
 */
async function handle(request: Request, instance: Server<SocketData>): Promise<Response | undefined> {
  if (!hostAllowed(request)) return forbidden()
  const url = new URL(request.url)
  // The terminal and the logs check their own Origin and session, then upgrade to a WebSocket (undefined on success).
  if (request.method === 'GET' && terminalContainerId(url.pathname) !== null) {
    return upgradeTerminal(request, instance)
  }
  if (
    request.method === 'GET' &&
    request.headers.get('upgrade')?.toLowerCase() === 'websocket' &&
    logSocketTarget(url.pathname) !== null
  ) {
    return upgradeLogs(request, instance)
  }
  if (request.method === 'GET' || request.method === 'HEAD') {
    const decoded = decodeRequestPath(url.pathname)
    if (decoded !== null) {
      const key = assetKey(decoded)
      const asset = key === null ? undefined : assets.get(key)
      if (asset) return serveAsset(request, asset)
      if (isStaticRequestPath(decoded)) return notFoundResponse()
    }
  }
  return forward(request)
}

// One exact route per client file: Bun matches these before fetch, which is the fastest path for
// the assets the browser asks for. Route patterns treat ":" "*" "{" "}" as syntax, so names with
// those characters are left to handle(), which finds them in the table too.
const routes: Record<string, (request: Request) => Response | Promise<Response>> = {}
for (const [key, asset] of assets) {
  const routePath = `/${key}`
  if (/[:*{}]/.test(routePath)) continue
  routes[routePath] = (request) => {
    if (!hostAllowed(request)) return forbidden()
    if (request.method === 'GET' || request.method === 'HEAD') return serveAsset(request, asset)
    return forward(request)
  }
}

type SocketData = TerminalData | LogSocketData

function isTerminal(ws: ServerWebSocket<SocketData>): ws is ServerWebSocket<TerminalData> {
  return ws.data.kind === 'terminal'
}

function isLogs(ws: ServerWebSocket<SocketData>): ws is ServerWebSocket<LogSocketData> {
  return ws.data.kind === 'logs'
}

/** One WebSocket handler for both bridges: each socket goes to the bridge its data names. */
const websocket: WebSocketHandler<SocketData> = {
  open(ws) {
    if (isTerminal(ws)) terminalWebSocket.open?.(ws)
    else if (isLogs(ws)) logSocketHandlers.open(ws)
  },
  message(ws, message) {
    if (isTerminal(ws)) terminalWebSocket.message?.(ws, message)
  },
  drain(ws) {
    if (isLogs(ws)) logSocketHandlers.drain(ws)
  },
  close(ws, code, reason) {
    if (isTerminal(ws)) terminalWebSocket.close?.(ws, code, reason)
    else if (isLogs(ws)) logSocketHandlers.close(ws)
  },
}

const server = Bun.serve<SocketData>({
  port,
  hostname,
  development: false,
  idleTimeout: IDLE_TIMEOUT_SECONDS,
  maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  routes,
  fetch: handle,
  websocket,
})

console.log(`pow/dock running at http://${server.hostname}:${server.port}`)
// Image update checks run while the server runs: the first one two minutes from now, then every six hours.
scheduleUpdateChecks()
