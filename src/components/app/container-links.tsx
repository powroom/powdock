import { Link } from '@tanstack/react-router'
import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Container names as links to their pages. Only the first `shown` names are visible; the rest count
 * as "+N", and a tooltip lists them.
 */
export function ContainerLinks({
  containers,
  shown,
}: {
  containers: readonly { id: string; name: string }[]
  shown: number
}) {
  const visible = containers.slice(0, shown)
  const hidden = containers.slice(shown)
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {visible.map((container) => (
        <Link
          className="max-w-full truncate rounded-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          key={container.id}
          params={{ id: container.id }}
          search={{}}
          title={container.name}
          to="/containers/$id"
        >
          {container.name}
        </Link>
      ))}
      {hidden.length > 0 && (
        <Tooltip>
          <TooltipTrigger render={<Badge size="sm" variant="outline" />}>+{hidden.length}</TooltipTrigger>
          <TooltipPopup>{hidden.map((container) => container.name).join(', ')}</TooltipPopup>
        </Tooltip>
      )}
    </span>
  )
}
