import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode, UIEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ansiToSegments, type AnsiSegment } from '@/lib/ansi'
import { estimateRows, formatClock, type LogEntry } from '@/lib/log-lines'
import { SERVICE_TONE_CLASSES, serviceToneIndex } from '@/lib/log-source'
import { buildOffsets, visibleRows } from '@/lib/log-window'
import { cn } from '@/lib/utils'
import type { StreamStatus } from './use-log-stream'

/** One unwrapped line is this tall: text-xs (12px) with an 18px line height. */
const ROW_HEIGHT = 18
/** Rows drawn above and below the viewport, so a fast scroll does not show gaps. */
const OVERSCAN = 20
/** Advance width of the monospace font at text-xs. Used to estimate wrapped rows before they are measured. */
const CHAR_WIDTH = 7.2
/** The clock column: "HH:mm:ss.SSS" (12 characters) plus a 12px gap. */
const CLOCK_WIDTH = 12 * CHAR_WIDTH + 12
/** Horizontal padding and the stderr border of a row. */
const ROW_GUTTER = 16
/** Within this many pixels of the bottom counts as "at the bottom". */
const BOTTOM_SLACK = 8

/** The 16 standard colors (0 to 7, then the bright ones). Theme tokens where the theme has one. */
export const FG_CLASS: Record<number, string> = {
  0: 'text-muted-foreground',
  1: 'text-destructive',
  2: 'text-success',
  3: 'text-warning',
  4: 'text-info',
  5: 'text-fuchsia-600 dark:text-fuchsia-400',
  6: 'text-cyan-600 dark:text-cyan-400',
  7: 'text-foreground/70',
  8: 'text-muted-foreground',
  9: 'text-destructive',
  10: 'text-success',
  11: 'text-warning',
  12: 'text-info',
  13: 'text-fuchsia-600 dark:text-fuchsia-400',
  14: 'text-cyan-600 dark:text-cyan-400',
  15: 'text-foreground',
}

// A line is drawn again on every scroll, so its segments are parsed once.
const segmentCache = new WeakMap<LogEntry, AnsiSegment[]>()

function segmentsOf(entry: LogEntry): AnsiSegment[] {
  const cached = segmentCache.get(entry)
  if (cached) return cached
  const segments = ansiToSegments(entry.m)
  segmentCache.set(entry, segments)
  return segments
}

interface View {
  top: number
  height: number
  width: number
}

function readView(el: HTMLElement): View {
  return { top: el.scrollTop, height: el.clientHeight, width: el.clientWidth }
}

function sameView(a: View, b: View): boolean {
  return a.top === b.top && a.height === b.height && a.width === b.width
}

/**
 * The log lines in a scroll box. Only the rows in view are drawn, and two spacers keep the place of
 * the others. Unwrapped lines are all ROW_HEIGHT tall. A wrapped line is estimated until it is drawn,
 * then its real height is used.
 */
export function LogList({
  entries,
  wrap,
  timestamps,
  follow,
  status,
  running,
  onAtBottomChange,
  onReconnect,
}: {
  entries: readonly LogEntry[]
  wrap: boolean
  timestamps: boolean
  /** scroll to the newest line as lines arrive */
  follow: boolean
  status: StreamStatus
  running: boolean
  /** told when the view is at the bottom (true) or has been scrolled up (false) */
  onAtBottomChange: (atBottom: boolean) => void
  onReconnect: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<View>({ top: 0, height: 0, width: 0 })
  /** real heights of the wrapped lines drawn so far, by seq */
  const [measured, setMeasured] = useState<ReadonlyMap<number, number>>(() => new Map())

  // The viewport size, from the scroll box itself. The box is always rendered, so this attaches once.
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      const next = readView(el)
      setView((prev) => (sameView(prev, next) ? prev : next))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Keep the newest line in view while following. Layout effect: it runs before the browser paints.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (follow && el) el.scrollTop = el.scrollHeight
  }, [follow, entries, wrap])

  // After each draw, read the heights of the wrapped lines on screen. The state update is deferred
  // to the next frame, so nothing changes during the effect itself.
  useEffect(() => {
    if (!wrap) return
    const frame = requestAnimationFrame(() => {
      const el = scrollRef.current
      if (!el) return
      const rows = [...el.querySelectorAll<HTMLElement>('[data-seq]')]
      setMeasured((prev) => {
        let changed = false
        const next = new Map(prev)
        for (const row of rows) {
          const seq = Number(row.dataset.seq)
          if (next.get(seq) !== row.offsetHeight) {
            next.set(seq, row.offsetHeight)
            changed = true
          }
        }
        // Heights of lines long gone from the buffer are dropped now and then.
        if (next.size > entries.length * 2) return new Map()
        return changed ? next : prev
      })
    })
    return () => cancelAnimationFrame(frame)
  })

  const columns = Math.floor((view.width - ROW_GUTTER - (timestamps ? CLOCK_WIDTH : 0)) / CHAR_WIDTH)
  const heightOf = (entry: LogEntry): number => {
    if (!wrap) return ROW_HEIGHT
    return measured.get(entry.seq) ?? estimateRows(entry.m, columns) * ROW_HEIGHT
  }
  const offsets = buildOffsets(entries.length, (index) => heightOf(entries[index] as LogEntry))
  const { start, end } = visibleRows(offsets, view.top, view.height, OVERSCAN)

  const onScroll = (event: UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget
    const next = readView(el)
    setView((prev) => (sameView(prev, next) ? prev : next))
    onAtBottomChange(el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_SLACK)
  }

  const rows: ReactNode[] = []
  for (let index = start; index < end; index++) {
    const entry = entries[index] as LogEntry
    rows.push(<LogRow entry={entry} key={entry.seq} timestamps={timestamps} wrap={wrap} />)
  }

  return (
    <div
      className="min-h-0 flex-1 overflow-auto overscroll-contain font-mono text-xs"
      data-slot="log-scroll"
      onScroll={onScroll}
      ref={scrollRef}
    >
      {entries.length === 0 ? (
        <EmptyLog onReconnect={onReconnect} running={running} status={status} />
      ) : (
        <div className={wrap ? 'w-full' : 'w-max min-w-full'}>
          <div style={{ height: offsets[start] ?? 0 }} />
          {rows}
          <div style={{ height: (offsets[entries.length] ?? 0) - (offsets[end] ?? 0) }} />
        </div>
      )}
      {status === 'ended' && entries.length > 0 && <EndMark onReconnect={onReconnect} running={running} />}
    </div>
  )
}

function LogRow({ entry, wrap, timestamps }: { entry: LogEntry; wrap: boolean; timestamps: boolean }) {
  return (
    <div
      className={cn(
        'flex min-h-[18px] border-l-2 pr-3 pl-2 leading-[18px]',
        entry.s === 'err' ? 'border-destructive/70 bg-destructive/5' : 'border-transparent',
        !wrap && 'h-[18px]',
      )}
      data-seq={entry.seq}
    >
      {timestamps && (
        <span className="w-[calc(12ch+0.75rem)] shrink-0 select-none pr-3 text-muted-foreground tabular-nums">
          {formatClock(entry.t)}
        </span>
      )}
      {entry.service && (
        <span className="shrink-0 select-none pe-2 font-medium">
          <span className={SERVICE_TONE_CLASSES[serviceToneIndex(entry.service)]}>{entry.service}</span>
          <span className="text-muted-foreground"> |</span>
        </span>
      )}
      <span className={cn('min-w-0 flex-1', wrap ? 'whitespace-pre-wrap break-all' : 'whitespace-pre')}>
        {segmentsOf(entry).map((segment, index) => (
          <span
            className={cn(
              segment.fg !== null && FG_CLASS[segment.fg],
              segment.bold && 'font-semibold',
              segment.dim && 'opacity-60',
            )}
            // segments of one line never reorder, so their index is a stable key
            key={index}
          >
            {segment.text}
          </span>
        ))}
      </span>
    </div>
  )
}

/** The view before any line: skeleton lines while connecting, a short note when there is no output. */
function EmptyLog({
  status,
  running,
  onReconnect,
}: {
  status: StreamStatus
  running: boolean
  onReconnect: () => void
}) {
  if (status === 'connecting') {
    return (
      <div aria-busy="true" aria-label="Loading logs" className="flex flex-col gap-2.5 p-3 font-sans">
        {[60, 40, 75, 52, 33, 66, 48].map((percent, index) => (
          <Skeleton className="h-2.5" key={index} style={{ width: `${percent}%` }} />
        ))}
      </div>
    )
  }
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center font-sans text-muted-foreground text-sm">
      <p>No output yet.</p>
      {status === 'ended' && <EndMark onReconnect={onReconnect} running={running} />}
    </div>
  )
}

/** Shown after the last line when the stream has ended. */
function EndMark({ running, onReconnect }: { running: boolean; onReconnect: () => void }) {
  return (
    <div className="sticky left-0 flex w-full flex-wrap items-center justify-between gap-2 border-t px-3 py-2 font-sans text-muted-foreground text-xs">
      <span>{running ? 'The log stream ended. Logs end here.' : 'The container stopped. Logs end here.'}</span>
      <Button onClick={onReconnect} size="xs" variant="outline">
        Reconnect
      </Button>
    </div>
  )
}
