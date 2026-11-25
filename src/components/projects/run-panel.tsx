import { CheckCircle2Icon, ChevronDownIcon, ChevronUpIcon, CircleAlertIcon } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FG_CLASS } from '@/components/containers/detail/log-list'
import { ansiToSegments } from '@/lib/ansi'
import { cn } from '@/lib/utils'
import type { RunState } from './use-project-run'

/**
 * The output of a Compose command, at the bottom of the project page. It is not a modal, so the page
 * stays usable, and it can be collapsed. The output is plain text with the colors of the log viewer.
 */
export function RunPanel({ state }: { state: RunState }) {
  const [open, setOpen] = useState(true)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Keep the newest line in view. Layout effect: it runs before the browser paints.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (open && el) el.scrollTop = el.scrollHeight
  }, [open, state.lines])

  const running = state.phase === 'running'
  const status = running
    ? 'Running'
    : state.phase === 'done'
      ? 'Done'
      : `Failed${state.code === null ? '' : ` (code ${state.code})`}`

  return (
    <section
      aria-label={`Output of ${state.title}`}
      className="sticky bottom-0 z-10 overflow-hidden rounded-lg border bg-card shadow-lg"
    >
      <header className="flex min-w-0 items-center gap-2 border-b bg-muted/40 px-3 py-2">
        {running && <Spinner aria-label="Running" className="size-4 shrink-0" />}
        {state.phase === 'done' && <CheckCircle2Icon aria-hidden="true" className="size-4 shrink-0 text-success" />}
        {state.phase === 'failed' && (
          <CircleAlertIcon aria-hidden="true" className="size-4 shrink-0 text-destructive" />
        )}
        <h2 className="min-w-0 truncate font-mono text-sm">{state.title}</h2>
        <Badge size="sm" variant={state.phase === 'failed' ? 'error' : 'secondary'}>
          {status}
        </Badge>
        <Button
          aria-expanded={open}
          aria-label={open ? 'Collapse the output' : 'Expand the output'}
          className="ms-auto"
          onClick={() => setOpen((value) => !value)}
          size="icon-xs"
          variant="ghost"
        >
          {open ? <ChevronDownIcon aria-hidden="true" /> : <ChevronUpIcon aria-hidden="true" />}
        </Button>
      </header>
      {open && (
        <div
          className="max-h-[min(40svh,20rem)] min-h-16 overflow-auto p-3 font-mono text-xs leading-[18px]"
          ref={scrollRef}
        >
          {state.lines.length === 0 && !running && state.error === null && (
            <p className="font-sans text-muted-foreground">No output.</p>
          )}
          {state.lines.map((line) => (
            <div className="whitespace-pre-wrap break-all" key={line.seq}>
              {ansiToSegments(line.m).map((segment, index) => (
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
            </div>
          ))}
          {state.error !== null && <p className="font-sans text-destructive">{state.error}</p>}
        </div>
      )}
    </section>
  )
}
