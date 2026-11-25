import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty'
import { cn } from '@/lib/utils'

/**
 * A list with nothing to show: the page's icon in a soft circle, one short title, one short muted line and,
 * when the page has one, its main action. It sits in the same bordered card as the lists.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon
  title: string
  description: string
  action?: ReactNode
  className?: string
}) {
  return (
    <Empty className={cn('rounded-lg border bg-card py-10', className)}>
      <EmptyHeader>
        <EmptyMedia className="mb-4">
          <span className="flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Icon aria-hidden="true" className="size-6" />
          </span>
        </EmptyMedia>
        <EmptyTitle className="text-base">{title}</EmptyTitle>
        <EmptyDescription>{description}</EmptyDescription>
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  )
}
