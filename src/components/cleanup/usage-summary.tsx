import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/ui/frame'
import { formatBytes } from '@/lib/format'
import { shareOf, totalReclaimable, totalUse, usageSegments, type UsageSegment } from '@/lib/cleanup-view'
import type { DiskUsage } from '@/lib/types'
import { pending } from './category-card'

/** The bar colors, one per segment. They are theme tokens defined in src/styles.css. */
const SEGMENT_CLASS: Record<UsageSegment['key'], string> = {
  images: 'bg-cleanup-images',
  containers: 'bg-cleanup-containers',
  volumes: 'bg-cleanup-volumes',
  buildCache: 'bg-cleanup-build-cache',
}

/**
 * Total Docker disk use, what can be freed (about), a bar that splits the total into its four parts, and a legend.
 * Without `usage` (while it loads) it has the same markup, with one-line skeletons where the numbers go, so the
 * height does not change when the data arrives.
 */
export function UsageSummary({ usage }: { usage?: DiskUsage }) {
  const segments = usage ? usageSegments(usage) : []
  const total = usage ? totalUse(usage) : 0

  return (
    <Frame aria-busy={usage === undefined}>
      <FrameHeader className="h-12 flex-row items-center justify-between gap-x-6 px-4">
        <FrameTitle className="whitespace-nowrap">Docker disk use</FrameTitle>
        <div className="flex min-w-0 items-center gap-x-1 whitespace-nowrap text-muted-foreground text-sm">
          <span className="max-sm:hidden">About</span>
          <div className="font-medium whitespace-nowrap text-foreground tabular-nums">
            {pending(usage && formatBytes(totalReclaimable(usage)))}
          </div>
          <span className="max-sm:hidden">can be freed</span>
          <span className="sm:hidden">freeable</span>
        </div>
      </FrameHeader>
      <FramePanel className="flex flex-col gap-4">
        <div className="font-heading font-semibold text-2xl tabular-nums">
          {pending(usage && formatBytes(total), 'block')}
        </div>
        <div
          aria-label={
            usage ? segments.map((segment) => `${segment.label} ${formatBytes(segment.bytes)}`).join(', ') : undefined
          }
          className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
          role={usage ? 'img' : undefined}
        >
          {segments.map((segment) => (
            <div
              className={SEGMENT_CLASS[segment.key]}
              key={segment.key}
              style={{ width: `${shareOf(segment.bytes, total)}%` }}
            />
          ))}
        </div>
        <ul className="grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
          {LEGEND.map((part) => {
            const segment = segments.find((item) => item.key === part.key)
            return (
              <li className="flex min-w-0 items-center gap-2" key={part.key}>
                <span aria-hidden="true" className={`size-2.5 shrink-0 rounded-full ${SEGMENT_CLASS[part.key]}`} />
                <span className="truncate text-muted-foreground">{part.label}</span>
                <div className="ms-auto font-medium whitespace-nowrap tabular-nums">
                  {pending(segment && formatBytes(segment.bytes))}
                </div>
              </li>
            )
          })}
        </ul>
      </FramePanel>
    </Frame>
  )
}

const LEGEND: { key: UsageSegment['key']; label: string }[] = [
  { key: 'images', label: 'Images' },
  { key: 'containers', label: 'Containers' },
  { key: 'volumes', label: 'Volumes' },
  { key: 'buildCache', label: 'Build cache' },
]
