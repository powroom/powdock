import { useEffect, useState, useSyncExternalStore } from 'react'
import { appendEntries, type LogEntry } from '@/lib/log-lines'
import { logSocketUrl, logSourceKey, type LogSource } from '@/lib/log-source'
import { createNdjsonReader, type LogRecord } from '@/lib/log-wire'

export type StreamStatus = 'connecting' | 'open' | 'ended' | 'error'

/**
 * How long a hidden tab keeps its stream. A browser allows only six HTTP/1.1 connections per host, and
 * each open stream holds one, so streams of tabs nobody looks at would block the tabs in use.
 */
const HIDDEN_GRACE_MS = 15_000

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange)
  return () => document.removeEventListener('visibilitychange', onChange)
}

/** True while the tab is shown. */
function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === 'visible',
    () => true,
  )
}

export interface LogSession {
  /** the stream options this session belongs to: a new key starts a new session */
  key: string
  status: StreamStatus
  error: string | null
  lines: LogEntry[]
  /** every line the stream has sent in this session (the lines held may be fewer, at the cap) */
  received: number
}

function startSession(key: string): LogSession {
  return { key, status: 'connecting', error: null, lines: [], received: 0 }
}

/**
 * Reads the live log stream of a container or a project over a WebSocket. The socket is closed when the
 * source changes or the component goes away, and when the tab stays hidden for HIDDEN_GRACE_MS; it
 * opens again (with a fresh tail) when the tab is shown. Lines are batched into one state update per
 * animation frame, so a busy source does not re-render for every line.
 */
export function useLogStream({ source, tail }: { source: LogSource; tail: number }) {
  const [attempt, setAttempt] = useState(0)
  const visible = usePageVisible()
  const [asleep, setAsleep] = useState(false)

  // Shown again after sleeping: start a new session. Adjusted during render, like the session below.
  if (visible && asleep) {
    setAsleep(false)
    setAttempt((count) => count + 1)
  }
  useEffect(() => {
    if (visible) return
    const timer = window.setTimeout(() => setAsleep(true), HIDDEN_GRACE_MS)
    return () => window.clearTimeout(timer)
  }, [visible])
  // On the server there is no page, and the effect below only runs in the browser.
  const url = typeof location === 'undefined' ? '' : logSocketUrl(source, tail, location)
  const key = `${logSourceKey(source)}|${tail}|${attempt}`
  const [stored, setStored] = useState<LogSession>(() => startSession(key))
  // A new key starts over with no lines. The state is replaced during render, not in an effect.
  const session = stored.key === key ? stored : startSession(key)
  if (stored.key !== key) setStored(session)

  useEffect(() => {
    if (asleep) return
    let active = true
    let pending: LogRecord[] = []
    let frame = 0
    const ndjson = createNdjsonReader()

    const update = (patch: Partial<LogSession>) => {
      setStored((prev) => (prev.key === key ? { ...prev, ...patch } : prev))
    }
    const commit = () => {
      frame = 0
      if (pending.length === 0) return
      const batch = pending
      pending = []
      setStored((prev) =>
        prev.key === key
          ? {
              ...prev,
              lines: appendEntries(prev.lines, batch, prev.received + 1),
              received: prev.received + batch.length,
            }
          : prev,
      )
    }
    const scheduleCommit = () => {
      if (frame === 0) frame = requestAnimationFrame(commit)
    }

    const socket = new WebSocket(url)
    socket.onopen = () => update({ status: 'open' })
    socket.onmessage = (event: MessageEvent<string>) => {
      const records = ndjson.push(event.data)
      if (records.length === 0) return
      pending.push(...records)
      scheduleCommit()
    }
    // A failed connection fires an error event and then a close event, so the close decides the status.
    socket.onclose = (event: CloseEvent) => {
      if (!active) return
      commit()
      if (event.code === 1000) update({ status: 'ended' })
      else update({ status: 'error', error: event.reason || 'Could not open the log stream.' })
    }

    return () => {
      active = false
      socket.close(1000)
      if (frame !== 0) cancelAnimationFrame(frame)
    }
  }, [key, url, asleep])

  const reconnect = () => setAttempt((count) => count + 1)
  /** Empties the lines on screen. The stream keeps running and new lines still arrive. */
  const clear = () => setStored((prev) => (prev.key === key ? { ...prev, lines: [] } : prev))

  return { session, reconnect, clear }
}
