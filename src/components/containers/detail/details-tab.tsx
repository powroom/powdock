import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { shortImageId, type ContainerDetails } from '@/lib/container-details'
import { formatContainerStatus } from '@/lib/container-status'
import { containerDetailsQuery, scanSummariesQuery } from '@/lib/queries'
import { countsText } from '@/lib/scan'
import type { ScanSummary } from '@/lib/types'
import {
  Copyable,
  EnvironmentList,
  DateTimeText,
  Field,
  Fields,
  LabelsSection,
  Section,
  SectionsSkeleton,
  Text,
} from '@/components/app/detail-fields'

/** How often the details refresh while the tab is open: restart counts and health change. */
const DETAILS_POLL_MS = 5000

/** The Details tab: the container's inspect data as sections of key and value rows. */
export function DetailsTab({ id }: { id: string }) {
  const query = useQuery({
    ...containerDetailsQuery(id),
    refetchInterval: DETAILS_POLL_MS,
    refetchIntervalInBackground: false,
  })
  const scans = useQuery(scanSummariesQuery())

  if (query.isPending) return <SectionsSkeleton rows={[6, 2, 3, 2]} />
  if (query.error) {
    return (
      <Alert variant="error">
        <AlertTitle>Could not load the details</AlertTitle>
        <AlertDescription>{query.error.message}</AlertDescription>
        <AlertAction>
          <Button onClick={() => void query.refetch()} size="sm" variant="outline">
            Retry
          </Button>
        </AlertAction>
      </Alert>
    )
  }
  return <Details details={query.data} scans={scans.data} />
}

function Details({
  details,
  scans,
}: {
  details: ContainerDetails
  scans: Readonly<Record<string, ScanSummary>> | undefined
}) {
  const { overview, ports, mounts, networks, environment, labels, health } = details
  // The overview has the short image id. The scan results are keyed by the full id.
  const scanned = Object.values(scans ?? {}).find((summary) => summary.imageId.startsWith(`sha256:${overview.imageId}`))
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Section title="Overview">
        <Fields>
          <Field label="ID">
            <Copyable label="container ID" value={overview.id} />
          </Field>
          <Field label="Image">
            <Copyable label="image" value={overview.image} />
          </Field>
          <Field label="Image ID">
            <Copyable label="image ID" value={overview.imageId} />
          </Field>
          {scanned && (
            <Field label="Vulnerabilities">
              <Link
                className="text-sm underline underline-offset-4"
                params={{ id: shortImageId(scanned.imageId) }}
                to="/images/$id"
              >
                {countsText(scanned.counts)}
              </Link>
            </Field>
          )}
          <Field label="Created">
            <DateTimeText value={overview.created} />
          </Field>
          <Field label="Started">
            <DateTimeText value={overview.started} />
          </Field>
          <Field label="State">
            <Text>
              {formatContainerStatus(overview.status)}
              {overview.running ? '' : ` (exit code ${overview.exitCode ?? '-'})`}
            </Text>
          </Field>
          <Field label="Restart policy">
            <Text>{overview.restartPolicy}</Text>
          </Field>
          <Field label="Restart count">
            <Text>{overview.restartCount}</Text>
          </Field>
          <Field label="Command">
            <Copyable label="command" value={overview.command} />
          </Field>
          <Field label="Entrypoint">
            <Copyable label="entrypoint" value={overview.entrypoint} />
          </Field>
          <Field label="Working dir">
            <Copyable label="working directory" value={overview.workingDir} />
          </Field>
          <Field label="User">
            <Text>{overview.user || 'default'}</Text>
          </Field>
          <Field label="Hostname">
            <Copyable label="hostname" value={overview.hostname} />
          </Field>
        </Fields>
      </Section>

      <Section title="Ports">
        <Fields>
          <Field label="Published">
            {ports.published.length === 0 ? (
              <Text>None</Text>
            ) : (
              <ul className="flex flex-col gap-1">
                {ports.published.map((port) => {
                  const text = `${port.hostIp}:${port.hostPort} → ${port.containerPort}/${port.protocol}`
                  return (
                    <li className="flex min-w-0 items-center gap-1.5" key={text}>
                      <Copyable label="port" value={text} />
                    </li>
                  )
                })}
              </ul>
            )}
          </Field>
          <Field label="Exposed">
            <Text>{ports.exposed.length === 0 ? 'None' : ports.exposed.join(', ')}</Text>
          </Field>
        </Fields>
      </Section>

      <Section title="Environment">
        <EnvironmentList variables={environment} />
      </Section>

      <Section title="Mounts">
        {mounts.length === 0 ? (
          <Text>No mounts</Text>
        ) : (
          <Fields>
            {mounts.map((mount) => (
              <Field key={`${mount.destination}|${mount.source}`} label={mount.type || 'mount'}>
                <div className="flex min-w-0 flex-col gap-1">
                  <Copyable label="mount source" value={mount.source} />
                  <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground text-xs">
                    <span className="min-w-0 break-all font-mono">{mount.destination}</span>
                    <Badge size="sm" variant={mount.readOnly ? 'secondary' : 'outline'}>
                      {mount.readOnly ? 'read-only' : 'read-write'}
                    </Badge>
                  </span>
                </div>
              </Field>
            ))}
          </Fields>
        )}
      </Section>

      <Section title="Networks">
        {networks.length === 0 ? (
          <Text>No networks</Text>
        ) : (
          <Fields>
            {networks.map((network) => (
              <Field key={network.name} label={network.name}>
                <div className="flex min-w-0 flex-col gap-1">
                  <Text>
                    {network.ipAddress || 'no address'}
                    {network.gateway ? ` · gateway ${network.gateway}` : ''}
                  </Text>
                  {network.aliases.length > 0 && <Text muted>aliases: {network.aliases.join(', ')}</Text>}
                </div>
              </Field>
            ))}
          </Fields>
        )}
      </Section>

      {health && (
        <Section title="Health">
          <Fields>
            <Field label="Status">
              <Badge size="sm" variant={health.status === 'unhealthy' ? 'error' : 'outline'}>
                {health.status}
              </Badge>
            </Field>
            <Field label="Failing streak">
              <Text>{health.failingStreak}</Text>
            </Field>
            <Field label="Last check">
              {health.lastCheck ? (
                <div className="flex min-w-0 flex-col gap-1">
                  <Text>
                    <DateTimeText value={health.lastCheck.startedAt} /> · exit code {health.lastCheck.exitCode ?? '-'}
                  </Text>
                  {health.lastCheck.output && (
                    <Copyable label="health output" value={health.lastCheck.output} multiline />
                  )}
                </div>
              ) : (
                <Text>No check has run yet</Text>
              )}
            </Field>
          </Fields>
        </Section>
      )}

      <LabelsSection labels={labels} />
    </div>
  )
}
