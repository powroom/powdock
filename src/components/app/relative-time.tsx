import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { formatDateTime, timeAgo } from '@/lib/format'

/** A relative time ("3h ago") whose tooltip shows the full date and time. A missing value is "-". */
export function RelativeTime({ value }: { value: string | number | null | undefined }) {
  if (!value) return '-'
  return (
    <Tooltip>
      <TooltipTrigger render={<span />}>{timeAgo(value)}</TooltipTrigger>
      <TooltipPopup>{formatDateTime(value)}</TooltipPopup>
    </Tooltip>
  )
}
