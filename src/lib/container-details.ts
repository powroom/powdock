// The Details tab's data: Docker's inspect output (GET /containers/{id}/json) trimmed to the fields
// the page shows. Only the mapping is here, so it is unit tested with fixtures.

/** The fields of GET /containers/{id}/json that the mapping reads. Docker can leave any of them out. */
export interface RawInspect {
  Id?: string
  Name?: string
  Created?: string
  Image?: string
  State?: {
    Status?: string
    ExitCode?: number
    StartedAt?: string
    Health?: {
      Status?: string
      FailingStreak?: number
      Log?: { Start?: string; End?: string; ExitCode?: number; Output?: string }[] | null
    }
  }
  RestartCount?: number
  Config?: {
    Hostname?: string
    User?: string
    Env?: string[] | null
    Cmd?: string[] | null
    Entrypoint?: string[] | null
    WorkingDir?: string
    Labels?: Record<string, string> | null
    ExposedPorts?: Record<string, unknown> | null
    Image?: string
    /** true when the container has a pseudo-terminal: its logs are not framed */
    Tty?: boolean
  }
  HostConfig?: { RestartPolicy?: { Name?: string; MaximumRetryCount?: number } }
  NetworkSettings?: {
    Ports?: Record<string, { HostIp?: string; HostPort?: string }[] | null> | null
    Networks?: Record<string, { IPAddress?: string; Gateway?: string; Aliases?: string[] | null } | null> | null
  }
  Mounts?: { Type?: string; Source?: string; Destination?: string; RW?: boolean }[] | null
}

export interface ContainerDetails {
  overview: {
    id: string
    name: string
    image: string
    imageId: string
    created: string
    /** null when the container never started */
    started: string | null
    status: string
    running: boolean
    exitCode: number | null
    restartPolicy: string
    restartCount: number
    command: string
    entrypoint: string
    workingDir: string
    user: string
    hostname: string
  }
  ports: {
    published: PublishedPort[]
    /** ports the image declares (EXPOSE), such as "80/tcp" */
    exposed: string[]
  }
  environment: EnvVar[]
  mounts: MountInfo[]
  networks: NetworkInfo[]
  labels: KeyValue[]
  /** null when the image has no healthcheck */
  health: HealthInfo | null
}

export interface PublishedPort {
  containerPort: number
  protocol: string
  /** the address on the host, "0.0.0.0" for all interfaces */
  hostIp: string
  hostPort: number
}

export interface EnvVar {
  key: string
  value: string
}

export interface KeyValue {
  key: string
  value: string
}

export interface MountInfo {
  type: string
  source: string
  destination: string
  readOnly: boolean
}

export interface NetworkInfo {
  name: string
  ipAddress: string
  gateway: string
  aliases: string[]
}

export interface HealthInfo {
  /** starting, healthy, unhealthy or none */
  status: string
  failingStreak: number
  /** the newest check, or null when none ran yet */
  lastCheck: { startedAt: string; exitCode: number | null; output: string } | null
}

/** Docker reports this time for a container that never started. */
const NEVER_STARTED_PREFIX = '0001-01-01'
const SECRET_KEY = /pass|secret|token|key|auth|credential/i

/** True for an environment key whose value is shown masked (for example PASSWORD or API_KEY). */
export function isSecretKey(key: string): boolean {
  return SECRET_KEY.test(key)
}

/** The short image id: "sha256:" is dropped and 12 characters kept. */
export function shortImageId(id: string): string {
  return id.replace(/^sha256:/, '').slice(0, 12)
}

/** "KEY=value" to a pair. A value may hold "="; a line without one has an empty value. */
export function parseEnvLine(line: string): EnvVar {
  const index = line.indexOf('=')
  if (index === -1) return { key: line, value: '' }
  return { key: line.slice(0, index), value: line.slice(index + 1) }
}

function restartPolicyText(name: string | undefined, maxRetries: number | undefined): string {
  if (!name) return 'no'
  if (name === 'on-failure' && maxRetries) return `on-failure (max ${maxRetries})`
  return name
}

function publishedPorts(ports: NonNullable<RawInspect['NetworkSettings']>['Ports']): PublishedPort[] {
  const out: PublishedPort[] = []
  for (const [key, bindings] of Object.entries(ports ?? {})) {
    const [port = '', protocol = 'tcp'] = key.split('/')
    const containerPort = Number(port)
    for (const binding of bindings ?? []) {
      const hostPort = Number(binding.HostPort)
      if (!Number.isFinite(hostPort) || hostPort === 0) continue
      out.push({ containerPort, protocol, hostIp: binding.HostIp || '0.0.0.0', hostPort })
    }
  }
  return out.sort((a, b) => a.hostPort - b.hostPort || a.containerPort - b.containerPort)
}

function healthOf(health: NonNullable<RawInspect['State']>['Health']): HealthInfo | null {
  if (!health) return null
  const last = health.Log?.[health.Log.length - 1]
  return {
    status: health.Status || 'none',
    failingStreak: health.FailingStreak ?? 0,
    lastCheck: last
      ? { startedAt: last.Start ?? '', exitCode: last.ExitCode ?? null, output: (last.Output ?? '').trim() }
      : null,
  }
}

/** Maps Docker's inspect output to the page's details. Missing fields become empty values. */
export function toContainerDetails(raw: RawInspect): ContainerDetails {
  const config = raw.Config ?? {}
  const state = raw.State ?? {}
  const startedAt = state.StartedAt ?? ''
  const exposed = Object.keys(config.ExposedPorts ?? {}).sort()
  return {
    overview: {
      id: raw.Id ?? '',
      name: (raw.Name ?? '').replace(/^\//, ''),
      image: config.Image ?? raw.Image ?? '',
      imageId: shortImageId(raw.Image ?? ''),
      created: raw.Created ?? '',
      started: startedAt && !startedAt.startsWith(NEVER_STARTED_PREFIX) ? startedAt : null,
      status: state.Status ?? '',
      running: state.Status === 'running',
      exitCode: state.ExitCode ?? null,
      restartPolicy: restartPolicyText(
        raw.HostConfig?.RestartPolicy?.Name,
        raw.HostConfig?.RestartPolicy?.MaximumRetryCount,
      ),
      restartCount: raw.RestartCount ?? 0,
      command: (config.Cmd ?? []).join(' '),
      entrypoint: (config.Entrypoint ?? []).join(' '),
      workingDir: config.WorkingDir ?? '',
      user: config.User ?? '',
      hostname: config.Hostname ?? '',
    },
    ports: { published: publishedPorts(raw.NetworkSettings?.Ports), exposed },
    environment: (config.Env ?? []).map(parseEnvLine),
    mounts: (raw.Mounts ?? []).map((mount) => ({
      type: mount.Type ?? '',
      source: mount.Source ?? '',
      destination: mount.Destination ?? '',
      readOnly: mount.RW === false,
    })),
    networks: Object.entries(raw.NetworkSettings?.Networks ?? {}).map(([name, network]) => ({
      name,
      ipAddress: network?.IPAddress ?? '',
      gateway: network?.Gateway ?? '',
      aliases: network?.Aliases ?? [],
    })),
    labels: Object.entries(config.Labels ?? {})
      .map(([key, value]) => ({ key, value }))
      .sort((a, b) => a.key.localeCompare(b.key)),
    health: healthOf(state.Health),
  }
}
