// Where a log stream comes from: one container, or the merged logs of a Compose project. Pure, so the
// unit tests can check the URL each source uses.

import { PROJECT_LOG_TAIL } from './compose'

export type LogSource = { kind: 'container'; id: string } | { kind: 'project'; name: string }

/**
 * The WebSocket URL of a source's log stream, on the page's own host (`page` is the page's location).
 * The project stream always starts with PROJECT_LOG_TAIL lines.
 */
export function logSocketUrl(source: LogSource, tail: number, page: Pick<Location, 'protocol' | 'host'>): string {
  const scheme = page.protocol === 'https:' ? 'wss:' : 'ws:'
  const path =
    source.kind === 'project'
      ? `/api/projects/${encodeURIComponent(source.name)}/logs?tail=${PROJECT_LOG_TAIL}`
      : `/api/containers/${encodeURIComponent(source.id)}/logs?tail=${tail}&timestamps=1`
  return `${scheme}//${page.host}${path}`
}

/** A stable text for a source, so a new source starts a new stream. */
export function logSourceKey(source: LogSource): string {
  return source.kind === 'project' ? `project:${source.name}` : `container:${source.id}`
}

/** The colors of the service names in merged logs. Stable: the same name always gets the same class. */
export const SERVICE_TONE_CLASSES: readonly string[] = [
  'text-info',
  'text-success',
  'text-warning',
  'text-fuchsia-600 dark:text-fuchsia-400',
  'text-cyan-600 dark:text-cyan-400',
]

/** The index into SERVICE_TONE_CLASSES for a service name (a small hash of its characters). */
export function serviceToneIndex(service: string, count: number = SERVICE_TONE_CLASSES.length): number {
  let hash = 0
  for (let i = 0; i < service.length; i++) hash = (hash * 31 + service.charCodeAt(i)) >>> 0
  return hash % count
}
