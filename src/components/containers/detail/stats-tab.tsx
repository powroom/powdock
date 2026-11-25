import { useQuery } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { AreaChart, type ChartLimit, type ChartSeries } from '@/components/charts/area-chart'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/ui/frame'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Skeleton } from '@/components/ui/skeleton'
import type { AxisKind } from '@/lib/chart-scale'
import { formatBytes, formatPercent, formatRate } from '@/lib/format'
import { containerHistoryQuery } from '@/lib/queries'
import { peakOf } from '@/lib/stats-view'
import type { StatsSample } from '@/lib/types'

/** How often the history refreshes while the tab is open. The sampler takes a sample every 2 seconds. */
const POLL_MS = 2000
const CHART_HEIGHT = 168

/**
 * The Stats tab: four cards with the live CPU, memory, network and disk I/O of the container, each with
 * its last five minutes. The query runs only while this tab is mounted (the tab panel unmounts it otherwise).
 */
export function StatsTab({ id, running }: { id: string; running: boolean }) {
  const query = useQuery({
    ...containerHistoryQuery(id),
    enabled: running,
    refetchInterval: POLL_MS,
    refetchIntervalInBackground: false,
  })

  if (!running) {
    return (
      <Empty className="rounded-lg border bg-card">
        <EmptyHeader>
          <EmptyTitle>Start the container to see live stats.</EmptyTitle>
        </EmptyHeader>
      </Empty>
    )
  }

  if (query.error && !query.data) {
    return (
      <Alert variant="error">
        <AlertTitle>Could not load the stats</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
      </Alert>
    )
  }

  const samples = query.data?.samples ?? []
  if (samples.length === 0) return <StatCards loading samples={[]} hostMemory={null} />
  return <StatCards loading={false} samples={samples} hostMemory={query.data?.hostMemory ?? null} />
}

/** The four cards. While loading, each card has the same boxes as the real one, so nothing moves. */
function StatCards({
  loading,
  samples,
  hostMemory,
}: {
  loading: boolean
  samples: StatsSample[]
  hostMemory: number | null
}) {
  const latest = samples.at(-1)
  const times = samples.map((sample) => sample.t)
  const pick = (read: (sample: StatsSample) => number | null) => samples.map(read)
  const cpu = pick((sample) => sample.cpu)
  const mem = pick((sample) => sample.mem)
  const rx = pick((sample) => sample.netRx)
  const tx = pick((sample) => sample.netTx)
  const read = pick((sample) => sample.blkRead)
  const write = pick((sample) => sample.blkWrite)

  // A limit equal to the host memory means the container has none, so no line is drawn.
  const limit: ChartLimit | undefined =
    latest && hostMemory !== null && latest.memLimit > 0 && latest.memLimit < hostMemory
      ? { value: latest.memLimit, label: `Limit ${shortBytes(latest.memLimit)}` }
      : undefined

  const chart = (options: {
    series: ChartSeries[]
    format: (value: number) => string
    axis: AxisKind
    label: string
    limit?: ChartLimit
  }) => (
    <AreaChart
      axis={options.axis}
      formatAxis={options.axis === 'percent' ? axisPercent : options.axis === 'rate' ? axisRate : shortBytes}
      formatValue={options.format}
      height={CHART_HEIGHT}
      label={options.label}
      limit={options.limit}
      series={options.series}
      times={times}
    />
  )
  const skeleton = <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <StatCard
        chart={
          loading
            ? skeleton
            : chart({
                series: [{ key: 'cpu', label: 'CPU', color: 'var(--chart-cpu)', values: cpu }],
                format: formatPercent,
                axis: 'percent',
                label: `CPU ${formatPercent(latest?.cpu)} now`,
              })
        }
        detail={loading ? undefined : `Peak ${formatPercent(peakOf(cpu))}`}
        loading={loading}
        title="CPU"
        value={formatPercent(latest?.cpu)}
      />
      <StatCard
        chart={
          loading
            ? skeleton
            : chart({
                series: [{ key: 'memory', label: 'Memory', color: 'var(--chart-memory)', values: mem }],
                format: formatBytes,
                axis: 'memory',
                label: `Memory ${formatBytes(latest?.mem)} now`,
                limit,
              })
        }
        detail={loading ? undefined : `Peak ${shortBytes(peakOf(mem))}`}
        loading={loading}
        title="Memory"
        value={formatBytes(latest?.mem)}
      />
      <StatCard
        chart={
          loading
            ? skeleton
            : chart({
                series: [
                  { key: 'rx', label: 'Received', color: 'var(--chart-in)', values: rx },
                  { key: 'tx', label: 'Sent', color: 'var(--chart-out)', values: tx },
                ],
                format: formatRate,
                axis: 'rate',
                label: `Network received ${formatRate(latest?.netRx)}, sent ${formatRate(latest?.netTx)}`,
              })
        }
        detail={loading ? undefined : arrowPeaks(rx, tx)}
        loading={loading}
        title="Network"
        value={loading ? undefined : arrowValues(latest?.netRx, latest?.netTx)}
      />
      <StatCard
        chart={
          loading
            ? skeleton
            : chart({
                series: [
                  { key: 'read', label: 'Read', color: 'var(--chart-in)', values: read },
                  { key: 'write', label: 'Write', color: 'var(--chart-out)', values: write },
                ],
                format: formatRate,
                axis: 'rate',
                label: `Disk read ${formatRate(latest?.blkRead)}, write ${formatRate(latest?.blkWrite)}`,
              })
        }
        detail={loading ? undefined : arrowPeaks(read, write)}
        loading={loading}
        title="Disk I/O"
        value={loading ? undefined : arrowValues(latest?.blkRead, latest?.blkWrite)}
      />
    </div>
  )
}

function StatCard({
  title,
  value,
  detail,
  chart,
  loading,
}: {
  title: string
  value: ReactNode
  detail: ReactNode
  chart: ReactNode
  loading: boolean
}) {
  return (
    <Frame>
      <FrameHeader className="min-h-12 flex-row flex-wrap items-center justify-between gap-x-4 gap-y-1 px-4 py-3">
        <FrameTitle>{title}</FrameTitle>
        {loading ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <Skeleton className="h-6 w-28" />
            <Skeleton className="h-3 w-20" />
          </div>
        ) : (
          <div className="flex flex-wrap items-baseline justify-end gap-x-4 gap-y-1">
            <div className="font-heading font-semibold text-2xl tabular-nums leading-6">{value}</div>
            <div className="text-muted-foreground text-xs tabular-nums">{detail}</div>
          </div>
        )}
      </FrameHeader>
      <FramePanel>{chart}</FramePanel>
    </Frame>
  )
}

/** The two rates as the big value, with the arrows that also explain the two lines: "↓ 1.2 MB/s  ↑ 300 KB/s". */
function arrowValues(first: number | null | undefined, second: number | null | undefined): ReactNode {
  return (
    <span className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
      <span>
        <span aria-hidden="true" className="text-chart-in">
          ↓{' '}
        </span>
        {formatRate(first)}
      </span>
      <span>
        <span aria-hidden="true" className="text-chart-out">
          ↑{' '}
        </span>
        {formatRate(second)}
      </span>
    </span>
  )
}

/** The peaks of the two rates, as a short muted line: "Peak ↓ 99 KB/s · ↑ 22 KB/s". */
function arrowPeaks(first: (number | null)[], second: (number | null)[]): string {
  return `Peak ↓ ${formatRate(peakOf(first))} · ↑ ${formatRate(peakOf(second))}`
}

/** A byte count with no ".0" in it: "1 MB", "76 MB". A missing value is "-". */
function shortBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '-'
  return formatBytes(bytes).replace(/\.0(?= )/, '')
}

/** Axis labels for CPU: whole numbers, and up to two decimals for the small steps of an idle line. */
function axisPercent(value: number): string {
  return `${Number.isInteger(value) ? value : Number(value.toFixed(2))}%`
}

/** Axis labels for rates: "1 KB/s", not "1.0 KB/s". */
function axisRate(value: number): string {
  return formatRate(value).replace(/\.0(?= )/, '')
}
