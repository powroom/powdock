// The body of POST /containers/create that recreates a container with the same settings, built from its
// inspect. Pure, so the unit tests use a real inspect (src/lib/__fixtures__). Runtime-only fields are
// left out: the names, IDs and addresses that Docker gives a container when it starts. Settings a user
// set are kept: the environment, ports, restart policy, mounts, labels and the networks with their aliases.

/** The part of GET /containers/{id}/json that the recreate reads. */
export interface RecreateInspect {
  Id: string
  Name: string
  /** the image ID the container runs (sha256:...) */
  Image: string
  State?: { Running?: boolean; Paused?: boolean }
  Config?: Record<string, unknown> & { Image?: string; Hostname?: string }
  HostConfig?: Record<string, unknown> & { Binds?: string[] | null; NetworkMode?: string }
  Mounts?: RecreateMount[] | null
  NetworkSettings?: { Networks?: Record<string, RecreateEndpoint> | null }
}

export interface RecreateMount {
  Type?: string
  /** the volume name, for a volume mount (an anonymous volume has a 64-character name) */
  Name?: string
  /** the path on the host, for a bind mount */
  Source?: string
  Destination?: string
  RW?: boolean
}

/** One network of a container as inspect shows it. Most fields are set by Docker at start and are not kept. */
export interface RecreateEndpoint {
  Aliases?: string[] | null
  Links?: string[] | null
  DriverOpts?: Record<string, string> | null
  IPAMConfig?: Record<string, unknown> | null
  /** runtime-only: read but not kept */
  IPAddress?: string
  NetworkID?: string
  EndpointID?: string
  MacAddress?: string
}

/** The destination of a bind string ("source:destination:mode"). */
function bindDestination(bind: string): string {
  return bind.split(':')[1] ?? ''
}

/**
 * The volume and bind mounts as bind strings. A mount that is already a bind string keeps it. A volume
 * or bind mount that is not (an anonymous volume, for example) is added, so the new container uses the
 * same data instead of an empty new volume. tmpfs and other mount kinds are left to the HostConfig.
 */
export function mountBinds(raw: Pick<RecreateInspect, 'HostConfig' | 'Mounts'>): string[] {
  const binds = [...(raw.HostConfig?.Binds ?? [])]
  const bound = new Set(binds.map(bindDestination))
  // mounts made with --mount stay in HostConfig.Mounts; adding them again as binds would mount twice
  const hostMounts = raw.HostConfig?.Mounts
  if (Array.isArray(hostMounts)) {
    for (const mount of hostMounts as { Target?: unknown }[]) {
      if (typeof mount.Target === 'string') bound.add(mount.Target)
    }
  }
  for (const mount of raw.Mounts ?? []) {
    if (!mount.Destination || bound.has(mount.Destination)) continue
    const source = mount.Type === 'volume' ? mount.Name : mount.Type === 'bind' ? mount.Source : undefined
    if (!source) continue
    binds.push(`${source}:${mount.Destination}:${mount.RW === false ? 'ro' : 'rw'}`)
    bound.add(mount.Destination)
  }
  return binds
}

/** The Docker network modes that take no endpoints (no network entries can be given for them). */
function hasNoEndpoints(networkMode: string): boolean {
  return networkMode === 'host' || networkMode === 'none' || networkMode.startsWith('container:')
}

/**
 * One network entry for the create call. The old short and full container IDs are dropped from the
 * aliases (Docker adds the new container's own ID alias). Static addresses (IPAMConfig) are kept, and
 * the addresses Docker gave at start (IPAddress, EndpointID, NetworkID, MacAddress) are not.
 */
function endpointBody(endpoint: RecreateEndpoint, id: string): Record<string, unknown> {
  const shortId = id.slice(0, 12)
  const aliases = (endpoint.Aliases ?? []).filter((alias) => alias !== shortId && alias !== id)
  const body: Record<string, unknown> = {}
  if (aliases.length > 0) body.Aliases = aliases
  if (endpoint.IPAMConfig) body.IPAMConfig = endpoint.IPAMConfig
  if (endpoint.Links && endpoint.Links.length > 0) body.Links = endpoint.Links
  if (endpoint.DriverOpts && Object.keys(endpoint.DriverOpts).length > 0) body.DriverOpts = endpoint.DriverOpts
  return body
}

/**
 * The body of POST /containers/create for the same container, with the image reference left as it is:
 * the tag now points at the new image, so the new container gets it. Keeping the tag (not the image
 * ID) keeps the container's image name readable and lets the next update check find it.
 */
export function recreateBody(raw: RecreateInspect): Record<string, unknown> {
  const shortId = raw.Id.slice(0, 12)
  const config: Record<string, unknown> = { ...raw.Config }
  // Docker sets the hostname to the short ID when none was given. A new container gets its own.
  if (config.Hostname === shortId) delete config.Hostname

  const networkMode = String(raw.HostConfig?.NetworkMode ?? '')
  const endpoints: Record<string, Record<string, unknown>> = {}
  if (!hasNoEndpoints(networkMode)) {
    for (const [network, endpoint] of Object.entries(raw.NetworkSettings?.Networks ?? {})) {
      endpoints[network] = endpointBody(endpoint, raw.Id)
    }
  }

  return {
    ...config,
    HostConfig: { ...raw.HostConfig, Binds: mountBinds(raw) },
    NetworkingConfig: { EndpointsConfig: endpoints },
  }
}
