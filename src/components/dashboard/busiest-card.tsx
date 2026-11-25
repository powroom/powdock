import { Link } from '@tanstack/react-router'
import { ImageIcon } from '@/components/app/image-icon'
import { Button } from '@/components/ui/button'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/ui/frame'
import { Skeleton } from '@/components/ui/skeleton'
import { Sparkline } from '@/components/charts/sparkline'
import { BUSIEST_ROWS, machineCpuPercent, type BusyRow } from '@/lib/dashboard-view'
import { formatBytes, formatPercent } from '@/lib/format'
import type { IconKey } from '@/lib/image-icon'

const SKELETON_KEYS = Array.from({ length: BUSIEST_ROWS }, (_, index) => `row-${index}`)

const ROW =
  'grid grid-cols-[minmax(0,1fr)_3rem_4rem_4.5rem] items-center gap-x-3 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1fr)_4rem_5rem_6rem]'

/**
 * The running containers with the highest CPU: name, a sparkline, CPU and memory. The frame has a link to the
 * containers page. While the data loads, it has as many rows as the list can show.
 *
 * `cpus` turns the per-core CPU of each container into a share of the whole machine, the same unit as
 * "Usage now", so the numbers on the dashboard add up. Its sparkline is converted the same way.
 */
export function BusiestCard({
  rows,
  stacks,
  loading,
  cpus,
}: {
  rows: readonly BusyRow[]
  /** the icon of each image, by image id (see useImageStacks) */
  stacks: Readonly<Record<string, IconKey | null>>
  loading: boolean
  cpus: number
}) {
  return (
    <Frame aria-busy={loading || undefined} aria-label="Busiest containers" role="region">
      <FrameHeader className="h-12 flex-row items-center justify-between px-4">
        <FrameTitle>Busiest containers</FrameTitle>
        <Button render={<Link to="/containers" />} size="sm" variant="ghost">
          View all
        </Button>
      </FrameHeader>
      <FramePanel className="p-0">
        {loading ? (
          <ul className="divide-y">
            {SKELETON_KEYS.map((key) => (
              <li className={ROW} key={key}>
                <span className="flex min-w-0 items-center gap-2">
                  <Skeleton className="size-5 shrink-0 rounded-md" />
                  <Skeleton className="h-4 w-32" />
                </span>
                <Skeleton className="h-4 w-12" />
                <Skeleton className="h-4 w-10 justify-self-end" />
                <Skeleton className="h-4 w-14 justify-self-end" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p className="px-4 py-2.5 text-muted-foreground text-sm">No container is running.</p>
        ) : (
          <ul className="divide-y">
            {rows.map(({ container, stat }) => (
              <li className={ROW} key={container.id}>
                <span className="flex min-w-0 items-center gap-2">
                  <ImageIcon
                    image={container.image}
                    name={container.name}
                    size={20}
                    stack={stacks[container.imageId] ?? null}
                  />
                  <Link
                    className="min-w-0 truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
                    params={{ id: container.id }}
                    search={{}}
                    title={container.name}
                    to="/containers/$id"
                  >
                    {container.name}
                  </Link>
                </span>
                {stat ? (
                  <Sparkline
                    className="justify-self-start"
                    values={stat.spark.map((value) => machineCpuPercent(value, cpus))}
                    width={48}
                  />
                ) : (
                  <Skeleton className="h-4 w-12" />
                )}
                <span className="text-right tabular-nums">
                  {stat ? formatPercent(machineCpuPercent(stat.cpuPercent, cpus)) : '-'}
                </span>
                <span className="text-right text-muted-foreground tabular-nums">
                  {stat ? formatBytes(stat.memUsage) : '-'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </FramePanel>
    </Frame>
  )
}
