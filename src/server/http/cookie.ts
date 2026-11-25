/**
 * Reads one cookie from a request. Kept apart from util.server.ts, which reaches into TanStack Start:
 * server.ts imports this (through the terminal bridge) and is bundled on its own with `bun build`.
 */
export function readCookie(request: Request, name: string): string | null {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const index = part.indexOf('=')
    if (index === -1) continue
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim()
  }
  return null
}
