import { useQuery } from '@tanstack/react-query'
import { ContainerLinks } from '@/components/app/container-links'
import {
  Copyable,
  DateTimeText,
  Field,
  Fields,
  LabelsSection,
  Section,
  SectionsSkeleton,
  Text,
} from '@/components/app/detail-fields'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '@/components/ui/sheet'
import { volumeDetailsQuery } from '@/lib/queries'
import type { VolumeDetails, VolumeSummary } from '@/lib/types'

/**
 * The details of one volume, in a sheet from the right. The query runs only while the sheet is open.
 */
export function VolumeDetailsSheet({
  volume,
  open,
  onOpenChange,
}: {
  volume: VolumeSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const name = volume?.name ?? ''
  const query = useQuery({ ...volumeDetailsQuery(name), enabled: open && name !== '' })

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="truncate">{name}</SheetTitle>
          <SheetDescription>Volume details</SheetDescription>
        </SheetHeader>
        <SheetPanel>
          {query.isPending || !query.data ? (
            query.error ? (
              <Alert variant="error">
                <AlertTitle>Could not load the details</AlertTitle>
                <AlertDescription>{query.error.message}</AlertDescription>
                <AlertAction>
                  <Button onClick={() => void query.refetch()} size="sm" variant="outline">
                    Retry
                  </Button>
                </AlertAction>
              </Alert>
            ) : (
              <SectionsSkeleton rows={[5, 2, 2, 2]} />
            )
          ) : (
            <Details details={query.data} />
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  )
}

function Details({ details }: { details: VolumeDetails }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Section title="Overview">
        <Fields>
          <Field label="Name">
            <Copyable label="volume name" value={details.name} />
          </Field>
          <Field label="Driver">
            <Text>{details.driver}</Text>
          </Field>
          <Field label="Mountpoint">
            <Copyable label="mountpoint" value={details.mountpoint} />
          </Field>
          <Field label="Created">
            <DateTimeText value={details.createdAt} />
          </Field>
          <Field label="Scope">
            <Text>{details.scope}</Text>
          </Field>
        </Fields>
      </Section>

      <LabelsSection labels={details.labels} />

      <Section title="Options">
        {details.options.length === 0 ? (
          <Text muted>No options</Text>
        ) : (
          <Fields>
            {details.options.map((option) => (
              <Field key={option.key} label={<span className="break-all font-mono">{option.key}</span>}>
                <Copyable label={option.key} value={option.value} />
              </Field>
            ))}
          </Fields>
        )}
      </Section>

      <Section title={`Used by (${details.usedBy.length})`}>
        {details.usedBy.length === 0 ? (
          <Text muted>No container uses this volume</Text>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {details.usedBy.map((mount) => (
              <li
                className="flex min-w-0 flex-col gap-1 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-3"
                key={`${mount.id}|${mount.destination}`}
              >
                <span className="flex min-w-0 flex-wrap items-center gap-2">
                  <ContainerLinks containers={[mount]} shown={1} />
                  <Badge size="sm" variant={mount.running ? 'success' : 'outline'}>
                    {mount.running ? 'Running' : 'Stopped'}
                  </Badge>
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-2 text-muted-foreground">
                  <span className="min-w-0 break-all font-mono text-xs">{mount.destination || '-'}</span>
                  <Badge size="sm" variant="outline">
                    {mount.readOnly ? 'Read-only' : 'Read and write'}
                  </Badge>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
