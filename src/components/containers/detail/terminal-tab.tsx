import '@xterm/xterm/css/xterm.css'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal, type ITheme } from '@xterm/xterm'
import { EraserIcon, InfoIcon, PlayIcon, RotateCwIcon } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { type ReactNode, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toolbar } from '@/components/ui/toolbar'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { containerShellsQuery } from '@/lib/queries'
import { isShell, parseServerEvent, preferredShell, startErrorText, type TerminalShell } from '@/lib/terminal-protocol'

/**
 * The Terminal tab: a shell in the running container, shown in xterm.js. This file is loaded with
 * React lazy (see container-detail-page.tsx), so xterm and its CSS only load when the tab opens.
 * The WebSocket protocol is documented in src/lib/terminal-protocol.ts.
 */

type Status =
  { kind: 'connecting' } | { kind: 'connected' } | { kind: 'exited'; code: number | null } | { kind: 'disconnected' }

/** The size is sent this long after the last change, so a window drag sends one message, not dozens. */
const RESIZE_DELAY_MS = 100
const SCROLLBACK_LINES = 5000
/** The same box height as the logs panel, so switching tabs does not move the page. The frame panel has the border and background. */
const BOX_CLASS = 'flex h-[min(60svh,40rem)] min-h-64 min-w-0 flex-col overflow-hidden'

/**
 * The tab body. A running container gets the live terminal. Otherwise the box says how to start it.
 * In dev mode (bun run dev) the page is not served by server.ts, so the terminal cannot connect.
 */
export function TerminalTab({
  id,
  running,
  starting,
  onStart,
}: {
  id: string
  running: boolean
  starting: boolean
  onStart: () => void
}) {
  if (import.meta.env.DEV) {
    return (
      <Box className="items-center justify-center p-4 text-center">
        <p className="text-muted-foreground text-sm">
          The terminal works in the built app. Run bun run build and bun run start.
        </p>
      </Box>
    )
  }
  if (!running) {
    return (
      <Box className="items-center justify-center gap-3 p-4 text-center">
        <p className="text-muted-foreground text-sm">Start the container to open a terminal.</p>
        <Button disabled={starting} loading={starting} onClick={onStart} size="sm" variant="outline">
          <PlayIcon aria-hidden="true" />
          Start
        </Button>
      </Box>
    )
  }
  return <LiveTerminal id={id} />
}

/** A box with the tool's height, in the same frame and panel as the logs and the compose file. */
function Box({ className, children }: { className: string; children: ReactNode }) {
  return (
    <Frame>
      <FramePanel className="overflow-hidden p-0">
        <div className={`${BOX_CLASS} ${className}`}>{children}</div>
      </FramePanel>
    </Frame>
  )
}

function LiveTerminal({ id }: { id: string }) {
  const shellsQuery = useQuery(containerShellsQuery(id))
  // The shells the container has. A failed check counts as no shells. Undefined while they load.
  const shells = shellsQuery.data ?? (shellsQuery.isError ? [] : undefined)
  // The shell the user picked. Until then the tab uses the preferred shell, and it does not connect before there is one.
  const [picked, setPicked] = useState<TerminalShell | null>(null)
  const shell = picked ?? (shells ? preferredShell(shells) : null)
  // Each new value starts a new WebSocket: Reconnect bumps it, and so does a shell change.
  const [attempt, setAttempt] = useState(0)
  const [status, setStatus] = useState<Status>({ kind: 'connecting' })
  const [reason, setReason] = useState('')
  const wrapperRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const socketRef = useRef<WebSocket | null>(null)

  // The terminal is made once, when the tab opens. The size follows the box, and the theme follows the page.
  useEffect(() => {
    const wrapper = wrapperRef.current
    const host = hostRef.current
    if (!wrapper || !host) return
    const term = new Terminal({
      cursorBlink: true,
      fontFamily: monoFontFamily(),
      fontSize: 13,
      minimumContrastRatio: 4.5,
      scrollback: SCROLLBACK_LINES,
      theme: readTheme(wrapper),
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    term.open(host)
    fit.fit()
    termRef.current = term

    let active = true
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    term.onData((data) => sendInput(socketRef.current, data))
    term.onResize(({ cols, rows }) => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => sendResize(socketRef.current, cols, rows), RESIZE_DELAY_MS)
    })
    const resizeObserver = new ResizeObserver(() => fit.fit())
    resizeObserver.observe(host)
    // The theme is a class on <html>. Reading the colors again is cheap, and only happens on a change.
    const themeObserver = new MutationObserver(() => {
      term.options.theme = readTheme(wrapper)
    })
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    // The font may load after the first fit, so the size is checked again once fonts are ready.
    void document.fonts.ready.then(() => {
      if (active) fit.fit()
    })

    return () => {
      active = false
      clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      themeObserver.disconnect()
      termRef.current = null
      term.dispose()
    }
  }, [])

  // One WebSocket per shell and attempt. Leaving the tab unmounts this component, which closes it.
  useEffect(() => {
    const term = termRef.current
    if (!term || !shell) return
    const socket = new WebSocket(terminalUrl(id, shell, term.cols, term.rows))
    socket.binaryType = 'arraybuffer'
    socketRef.current = socket
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (typeof event.data === 'string') {
        const message = parseServerEvent(event.data)
        if (message?.type === 'ready') setStatus({ kind: 'connected' })
        else if (message?.type === 'exit') setStatus({ kind: 'exited', code: message.code })
        else if (message?.type === 'error') setReason(startErrorText(message.message, shell))
        return
      }
      if (event.data instanceof ArrayBuffer) term.write(new Uint8Array(event.data))
    }
    socket.onclose = (event) => {
      if (socketRef.current !== socket) return
      socketRef.current = null
      setStatus((prev) => (prev.kind === 'exited' ? prev : { kind: 'disconnected' }))
      if (event.code !== 1000) setReason((prev) => prev || event.reason)
    }
    return () => {
      socket.onmessage = null
      socket.onclose = null
      socket.close()
      if (socketRef.current === socket) socketRef.current = null
    }
  }, [id, shell, attempt])

  // A new shell or a reconnect starts with a clear screen and the Connecting status.
  const restart = (nextShell: TerminalShell) => {
    termRef.current?.reset()
    setReason('')
    setStatus({ kind: 'connecting' })
    setPicked(nextShell)
    setAttempt((count) => count + 1)
  }

  const changeShell = (value: string | null) => {
    if (value && isShell(value) && value !== shell) restart(value)
  }

  // The picker lists only the shells the container has. Its width is fixed, so the toolbar does not move while they load.
  const shellItems = (shells ?? []).map((name) => ({ value: name, label: name }))

  return (
    <Frame>
      <Toolbar className="flex-wrap items-center border-0 bg-transparent p-1.5">
        <Select disabled={!shellItems.length} items={shellItems} onValueChange={changeShell} value={shell}>
          <SelectTrigger aria-label="Shell" className="w-24" size="sm">
            <SelectValue placeholder={shells ? 'No shell' : 'Loading…'} />
          </SelectTrigger>
          <SelectPopup>
            {shellItems.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectPopup>
        </Select>
        <Button
          disabled={!shell}
          onClick={() => {
            if (shell) restart(shell)
          }}
          size="sm"
          variant="outline"
        >
          <RotateCwIcon aria-hidden="true" />
          Reconnect
        </Button>
        <Tooltip>
          <TooltipTrigger
            render={
              <Button aria-label="Clear" onClick={() => termRef.current?.clear()} size="icon-sm" variant="ghost" />
            }
          >
            <EraserIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup>Clear</TooltipPopup>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger render={<Button aria-label="Copy and paste tips" size="icon-sm" variant="ghost" />}>
            <InfoIcon aria-hidden="true" />
          </TooltipTrigger>
          <TooltipPopup>Select to copy. Ctrl+Shift+V to paste.</TooltipPopup>
        </Tooltip>
        {/* the status and, when there is one, the reason sit on the toolbar line, so no row is kept empty */}
        <p aria-live="polite" className="ml-auto flex min-w-0 items-center gap-2 text-xs tabular-nums">
          {reason && (
            <span className="min-w-0 truncate text-destructive" title={reason}>
              {reason}
            </span>
          )}
          <span className="shrink-0 text-muted-foreground">{statusText(status)}</span>
        </p>
      </Toolbar>

      {/* the panel is read for the theme; data-terminal stops app shortcuts (Ctrl+K and the others) while the terminal has focus */}
      <FramePanel className="overflow-hidden p-0" ref={wrapperRef}>
        <div className={`${BOX_CLASS} relative p-2`} data-terminal="">
          {/* hidden, not removed, until a shell is picked: xterm keeps its element and its size */}
          <div className={`min-h-0 min-w-0 flex-1 ${shell ? '' : 'invisible'}`} ref={hostRef} />
          {shells?.length === 0 && (
            <p className="absolute inset-0 flex items-center justify-center p-4 text-center text-muted-foreground text-sm">
              This container has no shell, so a terminal cannot open.
            </p>
          )}
        </div>
      </FramePanel>
    </Frame>
  )
}

function statusText(status: Status): string {
  switch (status.kind) {
    case 'connecting':
      return 'Connecting…'
    case 'connected':
      return 'Connected'
    case 'exited':
      return status.code === null ? 'Exited' : `Exited with code ${status.code}`
    case 'disconnected':
      return 'Disconnected'
  }
}

function terminalUrl(id: string, shell: TerminalShell, cols: number, rows: number): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  const query = new URLSearchParams({ shell, cols: String(cols), rows: String(rows) })
  return `${protocol}//${location.host}/api/containers/${encodeURIComponent(id)}/terminal?${query.toString()}`
}

const encoder = new TextEncoder()

/** Keyboard input goes as binary frames. Nothing is sent before the socket is open. */
function sendInput(socket: WebSocket | null, data: string): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(encoder.encode(data))
}

function sendResize(socket: WebSocket | null, cols: number, rows: number): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'resize', cols, rows }))
}

function monoFontFamily(): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim()
  return value || 'ui-monospace, monospace'
}

/** Background and text colors from the box, which uses the app's theme tokens. */
function readTheme(element: HTMLElement): ITheme {
  const style = getComputedStyle(element)
  const background = normalizeColor(style.backgroundColor, '#000000')
  const foreground = normalizeColor(style.color, '#ffffff')
  return {
    background,
    foreground,
    cursor: foreground,
    cursorAccent: background,
    selectionBackground: withAlpha(foreground, 0.3),
  }
}

let colorContext: CanvasRenderingContext2D | null = null

/**
 * Turns any CSS color (including color-mix and oklch) into the form the terminal reads. The canvas
 * does the conversion: it returns #rrggbb for an opaque color, and rgba() for a translucent one.
 */
function normalizeColor(value: string, fallback: string): string {
  if (!colorContext) colorContext = document.createElement('canvas').getContext('2d')
  if (!colorContext) return fallback
  colorContext.fillStyle = fallback
  colorContext.fillStyle = value
  return colorContext.fillStyle
}

/** An opaque #rrggbb color with an alpha. Other forms are returned unchanged. */
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  if (!match) return color
  const [red, green, blue] = [match[1], match[2], match[3]].map((part) => parseInt(part ?? '00', 16))
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`
}
