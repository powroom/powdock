import { Badge } from '@/components/ui/badge'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * The small "Update" mark next to an image that has a newer version. With `onClick` it is a button
 * (it starts the update of a container). Without it, it is only a mark with a tooltip.
 */
export function UpdateBadge({
  label,
  tip,
  onClick,
  disabled = false,
}: {
  /** the accessible name of the button, for example "Update web" (a button only) */
  label?: string
  /** the tooltip text */
  tip: string
  onClick?: () => void
  disabled?: boolean
}) {
  if (onClick === undefined) {
    return (
      <Tooltip>
        <TooltipTrigger render={<Badge className="shrink-0" size="sm" variant="outline" />}>Update</TooltipTrigger>
        <TooltipPopup>{tip}</TooltipPopup>
      </Tooltip>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex shrink-0" />}>
        <Badge
          render={<button aria-label={label} disabled={disabled} onClick={onClick} type="button" />}
          size="sm"
          variant="outline"
        >
          Update
        </Badge>
      </TooltipTrigger>
      <TooltipPopup>{disabled ? 'A command is running.' : tip}</TooltipPopup>
    </Tooltip>
  )
}
