import { useState } from 'react'
import type { ReactNode } from 'react'
import { copyWithToast } from '@/components/app/copy-feedback'
import { Button } from '@/components/ui/button'
import { isSecretKey } from '@/lib/container-details'
import { formatDateTime, timeAgo } from '@/lib/format'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Frame, FrameHeader, FramePanel, FrameTitle } from '@/components/ui/frame'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ChevronDownIcon, EyeIcon, EyeOffIcon, CopyIcon } from 'lucide-react'

/**
 * The key and value layout of the detail pages (containers and images): sections, label and value
 * rows, copy buttons, and an environment list whose secret values are hidden until revealed.
 */

const MASK = '••••••••'

export function EnvironmentList({ variables }: { variables: readonly { key: string; value: string }[] }) {
  const [revealed, setRevealed] = useState<ReadonlySet<number>>(() => new Set())
  if (variables.length === 0) return <Text>No environment variables</Text>

  const toggle = (index: number) => {
    setRevealed((prev) => {
      const next = new Set(prev)
      if (next.has(index)) next.delete(index)
      else next.add(index)
      return next
    })
  }

  return (
    <Fields>
      {variables.map((variable, index) => {
        const secret = isSecretKey(variable.key)
        const shown = secret && !revealed.has(index) ? MASK : variable.value || '(empty)'
        return (
          <Field key={`${variable.key}|${index}`} label={<span className="break-all font-mono">{variable.key}</span>}>
            <span className="flex min-w-0 items-start gap-1.5">
              <span className={cn('min-w-0 break-all font-mono', !variable.value && 'text-muted-foreground')}>
                {shown}
              </span>
              {secret && (
                <Button
                  aria-label={revealed.has(index) ? `Hide ${variable.key}` : `Reveal ${variable.key}`}
                  className="shrink-0"
                  onClick={() => toggle(index)}
                  size="icon-xs"
                  variant="ghost"
                >
                  {revealed.has(index) ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
                </Button>
              )}
              {variable.value && <CopyIconButton label={variable.key} value={variable.value} />}
            </span>
          </Field>
        )
      })}
    </Fields>
  )
}

/** One titled block of a detail page: a header strip with the title, and the fields in a panel. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="min-w-0">
      <Frame>
        <FrameHeader className="h-12 flex-row items-center px-4">
          <FrameTitle>{title}</FrameTitle>
        </FrameHeader>
        <FramePanel className="min-w-0 p-4">{children}</FramePanel>
      </Frame>
    </section>
  )
}

/** Label and value pairs: a column of label and value on a phone, two columns from sm up. */
export function Fields({ children }: { children: ReactNode }) {
  return (
    <dl className="grid min-w-0 gap-y-3 sm:grid-cols-[minmax(7rem,max-content)_minmax(0,1fr)] sm:items-baseline sm:gap-x-6 sm:gap-y-2.5">
      {children}
    </dl>
  )
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="contents">
      <dt className="min-w-0 text-muted-foreground text-sm leading-5">{label}</dt>
      <dd className="min-w-0 text-sm leading-5">{children}</dd>
    </div>
  )
}

export function Text({ children, muted = false }: { children: ReactNode; muted?: boolean }) {
  return <span className={cn('min-w-0 break-all text-sm leading-5', muted && 'text-muted-foreground')}>{children}</span>
}

/** The date and time, then the muted relative age ("Apr 17, 2026, 6:53 AM · 3h ago"). A missing value is "-". */
export function DateTimeText({ value }: { value: string | null | undefined }) {
  if (!value) return <Text>-</Text>
  return (
    <Text>
      {formatDateTime(value)} <span className="text-muted-foreground">· {timeAgo(value)}</span>
    </Text>
  )
}

/** A value in mono text with a copy button. The button shows on hover and focus, and always on a phone. */
export function Copyable({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  if (!value) return <Text>-</Text>
  return (
    <span className="group flex min-w-0 items-start gap-1.5">
      {multiline ? (
        <pre className="min-w-0 flex-1 break-all whitespace-pre-wrap rounded-md bg-muted/50 p-2 font-mono text-xs">
          {value}
        </pre>
      ) : (
        <span className="min-w-0 break-all font-mono text-[0.8125rem] leading-5">{value}</span>
      )}
      <CopyIconButton label={label} value={value} />
    </span>
  )
}

export function CopyIconButton({ label, value }: { label: string; value: string }) {
  return (
    <Button
      aria-label={`Copy ${label}`}
      className="-my-1 shrink-0 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      onClick={() => void copyWithToast(value, 'Copied', label)}
      size="icon-xs"
      variant="ghost"
    >
      <CopyIcon aria-hidden="true" />
    </Button>
  )
}

/** The labels of a detail page, in a collapsible section whose header shows the count. */
export function LabelsSection({ labels }: { labels: readonly { key: string; value: string }[] }) {
  return (
    <Collapsible>
      <Frame>
        <FrameHeader className="h-12 p-0">
          <CollapsibleTrigger className="group flex h-full w-full cursor-pointer items-center justify-between gap-2 px-4 text-left font-semibold text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Labels ({labels.length})
            <ChevronDownIcon
              aria-hidden="true"
              className="size-4 transition-transform group-data-[panel-open]:rotate-180"
            />
          </CollapsibleTrigger>
        </FrameHeader>
        <CollapsibleContent>
          <FramePanel className="min-w-0 p-4">
            {labels.length === 0 ? (
              <Text muted>No labels</Text>
            ) : (
              <Fields>
                {labels.map((label) => (
                  <Field key={label.key} label={<span className="break-all font-mono">{label.key}</span>}>
                    <Copyable label={label.key} value={label.value} />
                  </Field>
                ))}
              </Fields>
            )}
          </FramePanel>
        </CollapsibleContent>
      </Frame>
    </Collapsible>
  )
}

/** Shapes like the loaded sections, one frame per section, so the page does not jump when the data arrives. */
export function SectionsSkeleton({ rows }: { rows: readonly number[] }) {
  return (
    <div aria-busy="true" aria-label="Loading details" className="flex min-w-0 flex-col gap-4">
      {rows.map((count, sectionIndex) => (
        <Frame key={sectionIndex}>
          <FrameHeader className="h-12 flex-row items-center px-4">
            <Skeleton className="h-3 w-24" />
          </FrameHeader>
          <FramePanel className="flex min-w-0 flex-col gap-3 p-4">
            {Array.from({ length: count }, (_, index) => (
              <div className="flex items-center gap-6" key={index}>
                <Skeleton className="h-3 w-20 shrink-0" />
                <Skeleton className="h-3 w-full max-w-72" />
              </div>
            ))}
          </FramePanel>
        </Frame>
      ))}
    </div>
  )
}
