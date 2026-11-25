import { useId } from 'react'
import { sparkPaths, SPARK_PAD } from '@/lib/spark-path'

/**
 * A tiny line chart with no axes: a smooth line over a soft fill. The values start at 0 at the bottom.
 * Its box has a fixed size, so it never moves the text next to it. The values sit at their place in the
 * series, so a series that starts later (leading nulls) keeps its right edge. A null draws nothing: the
 * line breaks there and nothing is read as 0. No values at all draws a flat muted line.
 */
export function Sparkline({
  values,
  width = 48,
  height = 16,
  color = 'var(--chart-cpu)',
  className,
}: {
  /** oldest first. A null is a gap: nothing is drawn there, and no value is read as 0. */
  values: readonly (number | null)[]
  width?: number
  height?: number
  /** any CSS color; the default is the CPU series color */
  color?: string
  className?: string
}) {
  const uid = useId().replace(/[^\w-]/g, '')
  const gradientId = `spark-${uid}`

  if (values.length === 0) {
    const bottom = height - SPARK_PAD
    return (
      <svg aria-hidden="true" className={className} height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
        <path
          className="stroke-muted-foreground/40"
          d={`M0 ${bottom}L${width} ${bottom}`}
          fill="none"
          strokeWidth={1}
        />
      </svg>
    )
  }

  const paths = sparkPaths(values, width, height)
  return (
    <svg aria-hidden="true" className={className} height={height} viewBox={`0 0 ${width} ${height}`} width={width}>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopOpacity="0.3" style={{ stopColor: color }} />
          <stop offset="1" stopOpacity="0" style={{ stopColor: color }} />
        </linearGradient>
      </defs>
      {paths.map((path, index) => (
        <path d={path.area} fill={`url(#${gradientId})`} key={`area-${index}`} />
      ))}
      {paths.map((path, index) => (
        <path
          d={path.line}
          fill="none"
          key={`line-${index}`}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.25}
          style={{ stroke: color }}
        />
      ))}
    </svg>
  )
}
