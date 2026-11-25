import { ArrowDownIcon, ClockIcon, DownloadIcon, EraserIcon, SearchIcon, WrapTextIcon } from 'lucide-react'
import { type ReactElement, useState } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toggle } from '@/components/ui/toggle'
import { Toolbar, ToolbarButton, ToolbarGroup, ToolbarSeparator } from '@/components/ui/toolbar'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { downloadText, filterEntries, logFileName, tailLabel, TAIL_CHOICES, type LogEntry } from '@/lib/log-lines'
import type { LogSource } from '@/lib/log-source'
import { readLogPrefs, writeLogPrefs, type LogPrefs } from './log-prefs'
import { LogList } from './log-list'
import { useLogStream } from './use-log-stream'

/**
 * A button that floats over the log lines. It needs an opaque background: in dark mode the secondary and
 * outline backgrounds are see-through, and the lines would show through the button.
 */
const FLOATING = 'absolute right-6 bottom-6 bg-popover shadow-lg hover:bg-popover dark:bg-popover dark:hover:bg-popover'

/** The lines on screen while paused: the list as it was, and how many lines came in since. */
interface Snapshot {
  lines: LogEntry[]
  received: number
}

const TAIL_ITEMS = TAIL_CHOICES.map((count) => ({ value: String(count), label: tailLabel(count) }))

/** An icon-only toolbar item. The tooltip shows its name; the control keeps its aria-label. */
function IconTip({ label, control }: { label: string; control: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger render={<ToolbarButton render={control} />} />
      <TooltipPopup>{label}</TooltipPopup>
    </Tooltip>
  )
}

/**
 * The log list with its toolbar. A container shows the full toolbar. A project (its merged logs) shows
 * search, follow and clear only, and its lines start with the service name. Leaving the tab unmounts
 * it, which ends the stream.
 */
export function LogViewer({ source, name, running }: { source: LogSource; name: string; running: boolean }) {
  const minimal = source.kind === 'project'
  const [tail, setTail] = useState<number>(TAIL_CHOICES[1] ?? 500)
  const [prefs, setPrefs] = useState<LogPrefs>(() => readLogPrefs())
  const [query, setQuery] = useState('')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [following, setFollowing] = useState(true)
  const { session, reconnect, clear } = useLogStream({ source, tail })

  // While paused, the view keeps the lines it had and counts the new ones. Otherwise it shows the live lines.
  const shown = snapshot ? snapshot.lines : session.lines
  const newCount = snapshot ? session.received - snapshot.received : 0
  const visible = query.trim() ? filterEntries(shown, query) : shown
  const paused = snapshot !== null
  // The project view has no timestamp or wrap toggle, so it shows the plain lines.
  const timestamps = minimal ? false : prefs.timestamps
  const wrap = minimal ? false : prefs.wrap

  const updatePrefs = (next: LogPrefs) => {
    setPrefs(next)
    writeLogPrefs(next)
  }

  const pause = () => setSnapshot({ lines: session.lines, received: session.received })
  const resume = () => {
    setSnapshot(null)
    setFollowing(true)
  }

  const changeTail = (value: string | null) => {
    if (!value) return
    setTail(Number(value))
    setSnapshot(null)
    setFollowing(true)
  }

  const clearView = () => {
    clear()
    setSnapshot((prev) => (prev ? { lines: [], received: session.received } : null))
  }

  const reconnectStream = () => {
    reconnect()
    setSnapshot(null)
    setFollowing(true)
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([downloadText(shown)], { type: 'text/plain;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = logFileName(name)
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {session.status === 'error' && (
        <Alert variant="error">
          <AlertTitle>Could not follow the logs</AlertTitle>
          <AlertDescription>{session.error}</AlertDescription>
          <AlertAction>
            <Button onClick={reconnectStream} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      <Frame>
        {/* One row from sm; on a phone the filter takes row one and the controls row two. */}
        <Toolbar className="flex-wrap items-center border-0 bg-transparent p-1.5">
          <InputGroup className="w-full sm:w-64">
            <InputGroupAddon>
              <SearchIcon aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              aria-label="Filter log lines"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('')
              }}
              placeholder="Filter lines"
              spellCheck={false}
              type="search"
              value={query}
            />
          </InputGroup>
          <p className="hidden text-muted-foreground text-xs tabular-nums sm:block">
            {query.trim() ? `${visible.length} of ${shown.length} lines` : `${shown.length} lines`}
          </p>
          <ToolbarGroup className="ms-auto gap-0 sm:gap-0.5">
            {!minimal && (
              <Select items={TAIL_ITEMS} onValueChange={changeTail} value={String(tail)}>
                <SelectTrigger aria-label="Lines to load" className="w-auto min-w-0" size="sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectPopup>
                  {TAIL_ITEMS.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectPopup>
              </Select>
            )}
            {/* Fixed minimum width so "Follow" and "Paused" do not move the row. */}
            <ToolbarButton
              render={
                <Toggle
                  aria-label={paused ? 'Resume following the logs' : 'Pause the logs'}
                  className="min-w-18"
                  onPressedChange={(on) => (on ? resume() : pause())}
                  pressed={!paused}
                  size="sm"
                  variant="default"
                >
                  {paused ? 'Paused' : 'Follow'}
                </Toggle>
              }
            />
            <ToolbarSeparator className="max-sm:hidden" orientation="vertical" />
            {!minimal && (
              <>
                <IconTip
                  label="Timestamps"
                  control={
                    <Toggle
                      aria-label="Timestamps"
                      onPressedChange={(on) => updatePrefs({ ...prefs, timestamps: on })}
                      pressed={prefs.timestamps}
                      size="sm"
                      variant="default"
                    >
                      <ClockIcon aria-hidden="true" />
                    </Toggle>
                  }
                />
                <IconTip
                  label="Wrap lines"
                  control={
                    <Toggle
                      aria-label="Wrap lines"
                      onPressedChange={(on) => updatePrefs({ ...prefs, wrap: on })}
                      pressed={prefs.wrap}
                      size="sm"
                      variant="default"
                    >
                      <WrapTextIcon aria-hidden="true" />
                    </Toggle>
                  }
                />
              </>
            )}
            <IconTip
              label="Clear"
              control={
                <Button aria-label="Clear" onClick={clearView} size="icon-sm" variant="ghost">
                  <EraserIcon aria-hidden="true" />
                </Button>
              }
            />
            {!minimal && (
              <IconTip
                label="Download"
                control={
                  <Button aria-label="Download" onClick={download} size="icon-sm" variant="ghost">
                    <DownloadIcon aria-hidden="true" />
                  </Button>
                }
              />
            )}
          </ToolbarGroup>
        </Toolbar>

        <FramePanel className="overflow-hidden p-0">
          <div className="relative flex h-[min(60svh,40rem)] min-h-64 min-w-0 flex-col">
            <LogList
              entries={visible}
              follow={following && !paused}
              onAtBottomChange={setFollowing}
              onReconnect={reconnectStream}
              running={running}
              status={session.status}
              timestamps={timestamps}
              wrap={wrap}
            />
            {paused && newCount > 0 && (
              <Button className={FLOATING} onClick={resume} size="sm" variant="outline">
                <ArrowDownIcon aria-hidden="true" />
                {newCount} new {newCount === 1 ? 'line' : 'lines'}
              </Button>
            )}
            {!paused && !following && (
              <Button className={FLOATING} onClick={() => setFollowing(true)} size="sm" variant="outline">
                <ArrowDownIcon aria-hidden="true" />
                Jump to latest
              </Button>
            )}
          </div>
        </FramePanel>
      </Frame>
    </div>
  )
}
