import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Frame, FrameFooter, FrameHeader, FramePanel, FrameTitle } from '@/components/ui/frame'
import { Meter, MeterIndicator, MeterTrack } from '@/components/ui/meter'
import { Skeleton } from '@/components/ui/skeleton'
import { shareOf } from '@/lib/cleanup-view'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * A number on the page. While the usage is loading (`text` is undefined) it is a skeleton one text line high,
 * so the card keeps the height of the real text.
 */
export function pending(text: string | undefined, className = 'block'): ReactNode {
  if (text === undefined) return <Skeleton className={`${className} h-[1lh] w-20 align-middle`} />
  return text
}

/**
 * One category of the Cleanup page: what it uses, what can be freed, a short explanation, and its actions.
 * It is the same shell while loading and after, so the card has the same height in both states.
 */
export function CategoryCard({
  title,
  icon: Icon,
  uses,
  usedBytes,
  freeable,
  freeBytes,
  withMeter = true,
  explanation,
  options,
  children,
}: {
  title: string
  icon: LucideIcon
  uses: ReactNode
  /** The size in use, for the meter. Undefined while it loads. */
  usedBytes?: number
  freeable: ReactNode
  /** The size that can be freed, for the meter. Undefined while it loads. */
  freeBytes?: number
  /** Show the meter of what can be freed. Networks have no sizes, so they have none. */
  withMeter?: boolean
  explanation: ReactNode
  /** A choice that changes what the action removes, such as the build cache age */
  options?: ReactNode
  children: ReactNode
}) {
  return (
    <Frame className="h-full min-w-0">
      <FrameHeader className="h-12 flex-row items-center gap-3 px-4">
        <FrameTitle className="flex min-w-0 items-center gap-2">
          <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          {title}
        </FrameTitle>
      </FrameHeader>
      <FramePanel className="flex flex-1 flex-col gap-3">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Uses</dt>
          <dd className="font-medium tabular-nums">{uses}</dd>
          <dt className="text-muted-foreground">Can free</dt>
          <dd className="font-medium tabular-nums">{freeable}</dd>
        </dl>
        {withMeter ? (
          <Meter aria-label="Share of the usage that can be freed" value={shareOf(freeBytes ?? 0, usedBytes ?? 0)}>
            <MeterTrack className="h-1">
              <MeterIndicator className="bg-foreground/80" />
            </MeterTrack>
          </Meter>
        ) : (
          <div className="h-1" />
        )}
        <div className="text-muted-foreground text-sm">{explanation}</div>
        {options}
      </FramePanel>
      <FrameFooter className="flex flex-wrap items-center gap-2">{children}</FrameFooter>
    </Frame>
  )
}

/**
 * An action button. While the usage loads, it is off with no tooltip. When `reason` is set, there is nothing to
 * remove: the button is off and a tooltip says why. The tooltip trigger is the wrapper, because a disabled button
 * takes no pointer events.
 */
export function ActionButton({
  loading = false,
  reason,
  onClick,
  variant,
  children,
}: {
  loading?: boolean
  reason?: string | null
  onClick: () => void
  variant: 'outline' | 'destructive'
  children: ReactNode
}) {
  if (loading || !reason) {
    return (
      <Button disabled={loading} onClick={() => onClick()} size="sm" variant={variant}>
        {children}
      </Button>
    )
  }
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex" />}>
        <Button disabled size="sm" variant={variant}>
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipPopup>{reason}</TooltipPopup>
    </Tooltip>
  )
}
