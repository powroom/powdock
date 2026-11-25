import { useQuery } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { Section } from '@/components/app/detail-fields'
import { RelativeTime } from '@/components/app/relative-time'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { scanResultQuery, scanStatusQuery } from '@/lib/queries'
import { visibleItems } from '@/lib/scan'
import type { ScanItem, ScanPhase, ScanResult, ScanSeverity } from '@/lib/types'
import { useScanImage } from './use-scan-image'

/** How many findings are listed before "Show N more". */
const FIRST_ROWS = 50

const PHASE_TEXT: Record<ScanPhase, string> = {
  queued: 'Waiting for another scan to finish…',
  downloading: 'Downloading the vulnerability database (first scan only)',
  scanning: 'Scanning…',
}

const CHIPS: { severity: ScanSeverity; label: string; variant: BadgeVariant }[] = [
  { severity: 'critical', label: 'Critical', variant: 'error' },
  { severity: 'high', label: 'High', variant: 'warning' },
  { severity: 'medium', label: 'Medium', variant: 'secondary' },
  { severity: 'low', label: 'Low', variant: 'outline' },
]

const SEVERITY_LABEL: Record<ScanSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Unknown',
}

type BadgeVariant = 'error' | 'warning' | 'secondary' | 'outline'

const SEVERITY_VARIANT: Record<ScanSeverity, BadgeVariant> = {
  critical: 'error',
  high: 'warning',
  medium: 'secondary',
  low: 'outline',
  unknown: 'outline',
}

/**
 * The Vulnerabilities section of the image page. It shows one of four states: a scan runs (its phase),
 * the image was never scanned, the scan failed to load, or the last result. The scan starts from here or
 * from the Images list. While a scan runs, the status is read once a second.
 */
export function VulnerabilitySection({ imageId }: { imageId: string }) {
  const status = useQuery({
    ...scanStatusQuery(),
    refetchInterval: (query) => (query.state.data?.scans.length ? 1000 : false),
  })
  const result = useQuery(scanResultQuery(imageId))
  const scan = useScanImage()
  const available = status.data?.available ?? true
  const entry = status.data?.scans.find((item) => item.imageId === imageId)
  const scanning = scan.isPending || entry !== undefined
  const start = () => scan.mutate(imageId)

  let body: ReactNode
  if (scanning) {
    body = <Scanning phase={entry?.phase ?? 'scanning'} />
  } else if (result.error) {
    body = <p className="text-destructive-foreground text-sm">{result.error.message}</p>
  } else if (result.isPending) {
    body = <Skeleton className="h-6 w-48" />
  } else if (result.data) {
    body = <Report onScan={start} scan={result.data} />
  } else {
    body = <NotScanned available={available} onScan={start} />
  }
  return <Section title="Vulnerabilities">{body}</Section>
}

function Scanning({ phase }: { phase: ScanPhase }) {
  return (
    <div className="flex min-h-7 items-center gap-2 text-sm">
      <Spinner className="size-4 shrink-0" />
      <span>{PHASE_TEXT[phase]}</span>
    </div>
  )
}

function NotScanned({ available, onScan }: { available: boolean; onScan: () => void }) {
  const button = (
    <Button disabled={!available} onClick={onScan} size="sm" variant="outline">
      Scan
    </Button>
  )
  return (
    <div className="flex flex-col gap-3">
      <div className="flex min-h-7 flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">Not scanned yet.</span>
        {available ? (
          button
        ) : (
          <Tooltip>
            <TooltipTrigger render={<span className="inline-flex" />}>{button}</TooltipTrigger>
            <TooltipPopup>Install Trivy to scan images.</TooltipPopup>
          </Tooltip>
        )}
      </div>
      {!available && (
        <p className="text-muted-foreground text-sm">
          Install Trivy to scan images. Get it from{' '}
          <a className="underline underline-offset-4" href="https://trivy.dev" rel="noreferrer" target="_blank">
            trivy.dev
          </a>
          .
        </p>
      )}
    </div>
  )
}

function Report({ scan, onScan }: { scan: ScanResult; onScan: () => void }) {
  const [showAll, setShowAll] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const shown = visibleItems(scan.items, showAll)
  const rows = expanded ? shown : shown.slice(0, FIRST_ROWS)

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-1.5">
        {CHIPS.map((chip) => (
          <Badge
            className="tabular-nums"
            key={chip.severity}
            size="sm"
            variant={scan.counts[chip.severity] > 0 ? chip.variant : 'outline'}
          >
            {chip.label} {scan.counts[chip.severity]}
          </Badge>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
        <span className="text-muted-foreground">
          Scanned <RelativeTime value={scan.scannedAt} /> · {scan.fixable} have a fix
        </span>
        <Button onClick={onScan} size="sm" variant="link">
          Scan again
        </Button>
      </div>

      {scan.items.length === 0 ? (
        <p className="text-sm">No known issues.</p>
      ) : (
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="text-muted-foreground">
              {showAll ? `All ${scan.items.length} findings` : `${shown.length} Critical or High with a fix`}
            </span>
            <label className="flex cursor-pointer items-center gap-2">
              <span>Show all</span>
              <Switch checked={showAll} onCheckedChange={(checked) => setShowAll(checked)} />
            </label>
          </div>

          {shown.length === 0 ? (
            <p className="text-muted-foreground text-sm">No Critical or High findings with a fix.</p>
          ) : (
            <>
              <ul className="divide-y rounded-md border">
                {rows.map((item, index) => (
                  <Finding item={item} key={`${item.id}|${item.pkg}|${index}`} />
                ))}
              </ul>
              {rows.length < shown.length && (
                <Button className="self-start" onClick={() => setExpanded(true)} size="sm" variant="outline">
                  Show {shown.length - rows.length} more
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}

function Finding({ item }: { item: ScanItem }) {
  const link = 'font-mono text-xs font-medium'
  return (
    <li className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm">
      {item.url ? (
        <a className={`${link} underline underline-offset-4`} href={item.url} rel="noreferrer" target="_blank">
          {item.id}
        </a>
      ) : (
        <span className={link}>{item.id}</span>
      )}
      <span className="min-w-0 truncate">{item.pkg}</span>
      <span className="min-w-0 break-all font-mono text-muted-foreground text-xs">
        {item.installed} → {item.fixed ?? 'no fix'}
      </span>
      <Badge className="ms-auto" size="sm" variant={SEVERITY_VARIANT[item.severity]}>
        {SEVERITY_LABEL[item.severity]}
      </Badge>
    </li>
  )
}
