import { useCallback, useId, useState } from 'react'
import type { PointerEvent } from 'react'
import { areaPath, runsOf, smoothPath, type Point } from '@/lib/chart-path'
import { AXIS_MINIMUM, axisScale, nearestSample, timeTicks, timeWindow, type AxisKind } from '@/lib/chart-scale'
import { timeOffsetLabel } from '@/lib/stats-view'

/** One line of the chart. `values[i]` is the value at `times[i]`; null is a gap. */
export interface ChartSeries {
  key: string
  label: string
  /** any CSS color, for example "var(--chart-cpu)" */
  color: string
  values: readonly (number | null)[]
}

/** A dashed line across the chart, for example the memory limit. Pass it only when it is shown. */
export interface ChartLimit {
  value: number
  label: string
}

/** Space around the plot: the value labels on the left, the time labels below. */
const PAD_LEFT = 58
const PAD_RIGHT = 8
const PAD_TOP = 10
const PAD_BOTTOM = 22
/** At most three grid lines, so the chart stays calm. */
const GRID_STEPS = 3
/**
 * A wide line chart that fills its width. Each series is a smooth line over a soft fill. The time window
 * ends at the last sample and is as long as the history (at most five minutes, at least one minute). The
 * pointer shows a crosshair on the nearest sample that has a value, with the values at that time.
 */
export function AreaChart({
  times,
  series,
  height,
  formatValue,
  formatAxis = formatValue,
  axis,
  scale: fixedScale,
  limit,
  label,
}: {
  /** the time of each value in milliseconds, oldest first. The last one is the newest sample. */
  times: readonly number[]
  series: readonly ChartSeries[]
  height: number
  formatValue: (value: number) => string
  /** formats the value labels on the left (the default is formatValue) */
  formatAxis?: (value: number) => string
  /** which unit the value axis uses, and its smallest top */
  axis: AxisKind
  /** a fixed value axis (for example 0 to 100 for CPU). Without it the top follows the values in view. */
  scale?: { top: number; ticks: number[] }
  limit?: ChartLimit
  /** a short summary for screen readers, such as "CPU 12.4% now" */
  label: string
}) {
  const uid = useId().replace(/[^\w-]/g, '')
  const [width, setWidth] = useState(0)
  const [hoverTime, setHoverTime] = useState<number | null>(null)

  // The observer lives as long as the element: it reports the width at once, and again on every resize.
  const measure = useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      setWidth(Math.floor(entries[0]?.contentRect.width ?? 0))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const hasData = times.length > 0
  const range = timeWindow(times[0] ?? 0, times.at(-1) ?? 0)
  const { start, end } = range
  const span = end - start
  const plotWidth = Math.max(0, width - PAD_LEFT - PAD_RIGHT)
  const plotHeight = Math.max(0, height - PAD_TOP - PAD_BOTTOM)
  const baseline = PAD_TOP + plotHeight
  const xAt = (time: number) => PAD_LEFT + ((time - start) / span) * plotWidth

  // The value axis looks only at the values in the window, so an old peak does not flatten the new data.
  const inView = series.flatMap((line) =>
    times.flatMap((time, index) => {
      const value = line.values[index] ?? null
      return value !== null && time >= start ? [value] : []
    }),
  )
  const scale =
    fixedScale ?? axisScale(Math.max(0, limit?.value ?? 0, ...inView), { ...AXIS_MINIMUM[axis], steps: GRID_STEPS })
  const yAt = (value: number) => PAD_TOP + (1 - value / scale.top) * plotHeight

  const lines = series.map((line) => {
    const points = times.map((time, index): Point | null => {
      const value = line.values[index] ?? null
      return value === null ? null : { x: xAt(time), y: yAt(value) }
    })
    const runs = runsOf(points)
    let latest: Point | null = null
    for (const point of points) if (point !== null) latest = point
    return {
      ...line,
      paths: runs.map((run) => ({ line: smoothPath(run), area: areaPath(run, baseline) })),
      latest,
    }
  })

  const ticks = timeTicks(span).map((tick) => ({ ...tick, x: xAt(end - tick.offsetMs) }))
  // A sample counts for the hover when at least one line has a value there.
  const present = times.map((_, index) => series.some((line) => (line.values[index] ?? null) !== null))

  const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!hasData || plotWidth <= 0) return
    const x = event.clientX - event.currentTarget.getBoundingClientRect().left
    const time = start + ((x - PAD_LEFT) / plotWidth) * span
    const index = nearestSample(times, present, time)
    setHoverTime(index < 0 ? null : (times[index] ?? null))
  }

  const hoverIndex = hoverTime === null ? -1 : times.indexOf(hoverTime)
  const hoverX = hoverTime === null || hoverIndex < 0 ? null : xAt(hoverTime)
  const tipOnLeft = hoverX !== null && hoverX > width - 150

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="relative w-full min-w-0" ref={measure} style={{ height }}>
        {width > 0 && (
          <svg
            aria-label={label}
            className="block select-none"
            height={height}
            onPointerLeave={() => setHoverTime(null)}
            onPointerMove={onPointerMove}
            role="img"
            style={{ touchAction: 'pan-y' }}
            viewBox={`0 0 ${width} ${height}`}
            width={width}
          >
            <defs>
              <clipPath id={`${uid}-clip`}>
                <rect height={plotHeight} width={plotWidth} x={PAD_LEFT} y={PAD_TOP} />
              </clipPath>
              {lines.map((line, index) => (
                <linearGradient
                  gradientUnits="userSpaceOnUse"
                  id={`${uid}-fill-${index}`}
                  key={line.key}
                  x1="0"
                  x2="0"
                  y1={PAD_TOP}
                  y2={baseline}
                >
                  <stop offset="0" stopOpacity="0.28" style={{ stopColor: line.color }} />
                  <stop offset="1" stopOpacity="0" style={{ stopColor: line.color }} />
                </linearGradient>
              ))}
            </defs>

            {/* grid: a faint line and a value label per step, and the baseline */}
            {scale.ticks.map((value) => (
              <g key={value}>
                <line
                  className="stroke-border"
                  x1={PAD_LEFT}
                  x2={PAD_LEFT + plotWidth}
                  y1={yAt(value)}
                  y2={yAt(value)}
                />
                <text
                  className="fill-muted-foreground text-[11px] tabular-nums"
                  dominantBaseline="middle"
                  textAnchor="end"
                  x={PAD_LEFT - 8}
                  y={yAt(value)}
                >
                  {formatAxis(value)}
                </text>
              </g>
            ))}
            <line className="stroke-border" x1={PAD_LEFT} x2={PAD_LEFT + plotWidth} y1={baseline} y2={baseline} />

            {/* time axis: a tick per label, "now" at the right */}
            {hasData &&
              ticks.map((tick) => (
                <g key={tick.offsetMs}>
                  <line className="stroke-border" x1={tick.x} x2={tick.x} y1={baseline} y2={baseline + 4} />
                  <text
                    className="fill-muted-foreground text-[11px] tabular-nums"
                    textAnchor={tick.offsetMs === 0 ? 'end' : tick.x < PAD_LEFT + 12 ? 'start' : 'middle'}
                    x={tick.x}
                    y={height - 5}
                  >
                    {tick.label}
                  </text>
                </g>
              ))}

            {limit && (
              <g>
                <line
                  className="stroke-muted-foreground"
                  strokeDasharray="4 4"
                  x1={PAD_LEFT}
                  x2={PAD_LEFT + plotWidth}
                  y1={yAt(limit.value)}
                  y2={yAt(limit.value)}
                />
                <text
                  className="fill-muted-foreground text-[11px] tabular-nums"
                  textAnchor="end"
                  x={PAD_LEFT + plotWidth}
                  y={yAt(limit.value) - 4}
                >
                  {limit.label}
                </text>
              </g>
            )}

            <g clipPath={`url(#${uid}-clip)`}>
              {lines.map((line, index) => (
                <g key={line.key}>
                  {line.paths.map((path, runIndex) => (
                    <path d={path.area} fill={`url(#${uid}-fill-${index})`} key={runIndex} />
                  ))}
                  {line.paths.map((path, runIndex) => (
                    <path
                      d={path.line}
                      fill="none"
                      key={`line-${runIndex}`}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.75}
                      style={{ stroke: line.color }}
                    />
                  ))}
                </g>
              ))}
            </g>

            {/* the newest value of each line, unless the pointer is on the chart */}
            {hoverX === null &&
              lines.map((line) =>
                line.latest ? (
                  <circle
                    className="stroke-card"
                    cx={line.latest.x}
                    cy={line.latest.y}
                    key={`latest-${line.key}`}
                    r={2.75}
                    strokeWidth={1.5}
                    style={{ fill: line.color }}
                  />
                ) : null,
              )}

            {hoverX !== null && hoverIndex >= 0 && (
              <g>
                <line
                  className="stroke-muted-foreground/60"
                  strokeDasharray="3 3"
                  x1={hoverX}
                  x2={hoverX}
                  y1={PAD_TOP}
                  y2={baseline}
                />
                {series.map((line) => {
                  const value = line.values[hoverIndex] ?? null
                  if (value === null) return null
                  return (
                    <circle
                      className="stroke-card"
                      cx={hoverX}
                      cy={yAt(value)}
                      key={`hover-${line.key}`}
                      r={3.5}
                      strokeWidth={1.5}
                      style={{ fill: line.color }}
                    />
                  )
                })}
              </g>
            )}
          </svg>
        )}

        {hoverX !== null && hoverTime !== null && (
          <div
            className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-lg border bg-popover px-2.5 py-2 text-popover-foreground text-xs shadow-lg/5"
            style={{
              left: hoverX,
              transform: tipOnLeft ? 'translateX(calc(-100% - 10px))' : 'translateX(10px)',
            }}
          >
            <div className="mb-1 text-muted-foreground tabular-nums">{timeOffsetLabel(end - hoverTime)}</div>
            {series.map((line) => {
              const value = line.values[hoverIndex] ?? null
              return (
                <div className="flex items-center justify-between gap-4" key={line.key}>
                  <span className="flex items-center gap-1.5">
                    <span aria-hidden="true" className="size-2 rounded-full" style={{ background: line.color }} />
                    {line.label}
                  </span>
                  <span className="font-medium tabular-nums">{value === null ? '-' : formatValue(value)}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
