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
import { Button } from '@/components/ui/button'
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from '@/components/ui/sheet'
import { networkDetailsQuery } from '@/lib/queries'
import type { NetworkDetails, NetworkSummary } from '@/lib/types'

/**
 * The details of one network, in a sheet from the right. The query runs only while the sheet is open.
 */
export function NetworkDetailsSheet({
  network,
  open,
  onOpenChange,
}: {
  network: NetworkSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const id = network?.id ?? ''
  const query = useQuery({ ...networkDetailsQuery(id), enabled: open && id !== '' })

  return (
    <Sheet onOpenChange={onOpenChange} open={open}>
      <SheetPopup className="sm:max-w-lg">
        <SheetHeader>
          <SheetTitle className="truncate">{network?.name ?? ''}</SheetTitle>
          <SheetDescription>Network details</SheetDescription>
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
              <SectionsSkeleton rows={[7, 2, 3]} />
            )
          ) : (
            <Details details={query.data} />
          )}
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  )
}

function Details({ details }: { details: NetworkDetails }) {
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Section title="Overview">
        <Fields>
          <Field label="ID">
            <Copyable label="network ID" value={details.id} />
          </Field>
          <Field label="Driver">
            <Text>{details.driver}</Text>
          </Field>
          <Field label="Scope">
            <Text>{details.scope}</Text>
          </Field>
          <Field label="Internal">
            <Text>{details.internal ? 'Yes, no access to the outside' : 'No'}</Text>
          </Field>
          <Field label="Attachable">
            <Text>{details.attachable ? 'Yes' : 'No'}</Text>
          </Field>
          <Field label="IPv6">
            <Text>{details.ipv6 ? 'On' : 'Off'}</Text>
          </Field>
          <Field label="Subnets">
            {details.subnets.length === 0 ? (
              <Text muted>None</Text>
            ) : (
              <Copyable label="subnets" value={details.subnets.join(', ')} />
            )}
          </Field>
          <Field label="Gateways">
            {details.gateways.length === 0 ? (
              <Text muted>None</Text>
            ) : (
              <Copyable label="gateways" value={details.gateways.join(', ')} />
            )}
          </Field>
          <Field label="Created">
            <DateTimeText value={details.createdAt} />
          </Field>
        </Fields>
      </Section>

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

      <LabelsSection labels={details.labels} />

      <Section title={`Containers (${details.containers.length})`}>
        {details.containers.length === 0 ? (
          <Text muted>No container is attached</Text>
        ) : (
          <ul className="flex min-w-0 flex-col gap-3">
            {details.containers.map((container) => (
              <li
                className="flex min-w-0 flex-col gap-1 text-sm sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-x-3"
                key={container.id}
              >
                <span className="min-w-0">
                  <ContainerLinks containers={[container]} shown={1} />
                </span>
                <span className="flex min-w-0 flex-wrap gap-x-4 gap-y-1 font-mono text-muted-foreground text-xs">
                  <span className="break-all">{container.ipv4 || 'No IPv4'}</span>
                  <span className="break-all">{container.mac || 'No MAC'}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  )
}
