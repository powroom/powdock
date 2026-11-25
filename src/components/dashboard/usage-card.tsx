import type { ReactNode } from 'react'
import { AreaChart } from '@/components/charts/area-chart'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/ui/frame'
import { Skeleton } from '@/components/ui/skeleton'
import { machineCpuPercent, machineCpuSeries } from '@/lib/dashboard-view'
import { formatBytes, formatPercent } from '@/lib/format'
import type { EngineInfo, TotalsSample } from '@/lib/types'

/** The height of each chart. The skeleton has the same height, so nothing moves when the data arrives. */
const CHART_HEIGHT = 128

/**
 * CPU and memory of all containers together, as two small area charts. The CPU is a share of the whole machine
 * (0 to 100%) and the memory is against the memory of the host. While the data loads, it has the same shape.
 */
export function UsageCard({
  totals,
  engine,
  loading,
}: {
  totals: readonly TotalsSample[] | undefined
  engine: EngineInfo | undefined
  loading: boolean
}) {
  if (loading || !totals) {
    return (
      <UsageFrame busy>
        <ChartFrame title="CPU" now={<Skeleton className="h-4 w-14" />}>
          <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
        </ChartFrame>
        <ChartFrame title="Memory" now={<Skeleton className="h-4 w-32" />}>
          <Skeleton className="w-full" style={{ height: CHART_HEIGHT }} />
        </ChartFrame>
      </UsageFrame>
    )
  }

  const cpus = engine?.cpus ?? 0
  const memTotal = engine && engine.memTotal > 0 ? engine.memTotal : null
  const times = totals.map((total) => total.t)
  const latest = totals.at(-1)
  const cpuNow = latest ? machineCpuPercent(latest.cpu, cpus) : null
  const memNow = latest ? formatBytes(latest.mem) : '-'

  return (
    <UsageFrame>
      <ChartFrame title="CPU" now={formatPercent(cpuNow)}>
        <AreaChart
          axis="percent"
          formatAxis={(value) => `${value}%`}
          formatValue={formatPercent}
          height={CHART_HEIGHT}
          label={`CPU ${formatPercent(cpuNow)} now, of the whole machine`}
          scale={{ top: 100, ticks: [50, 100] }}
          series={[{ key: 'cpu', label: 'CPU', color: 'var(--chart-cpu)', values: machineCpuSeries(totals, cpus) }]}
          times={times}
        />
      </ChartFrame>
      <ChartFrame title="Memory" now={memTotal ? `${memNow} of ${formatBytes(memTotal)}` : memNow}>
        <AreaChart
          axis="memory"
          formatAxis={formatBytes}
          formatValue={formatBytes}
          height={CHART_HEIGHT}
          label={`Memory ${memNow} now`}
          scale={memTotal ? { top: memTotal, ticks: [memTotal / 2, memTotal] } : undefined}
          series={[
            {
              key: 'memory',
              label: 'Memory',
              color: 'var(--chart-memory)',
              values: totals.map((total) => total.mem),
            },
          ]}
          times={times}
        />
      </ChartFrame>
    </UsageFrame>
  )
}

/** The frame with its title, and the two charts side by side from the md breakpoint. */
function UsageFrame({ busy, children }: { busy?: boolean; children: ReactNode }) {
  return (
    <Frame aria-label="Usage now" role="region">
      <FrameHeader className="h-12 flex-row items-center px-4">
        <FrameTitle>Usage now</FrameTitle>
      </FrameHeader>
      <FramePanel aria-busy={busy || undefined} className="grid gap-6 md:grid-cols-2">
        {children}
      </FramePanel>
    </Frame>
  )
}

/** A chart with its title on the left and its current value on the right. */
function ChartFrame({ title, now, children }: { title: string; now: ReactNode; children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex h-5 items-center justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{title}</span>
        <span className="font-medium tabular-nums">{now}</span>
      </div>
      {children}
    </div>
  )
}
