import type { NetworkAttachment, NetworkContainer, NetworkDetails, NetworkSummary } from '@/lib/types'
import { isValidResourceName, networkAddressProblem } from '@/lib/resource-names'
import { dockerRequest, mapLimit } from './docker.server'

/**
 * The Networks page's calls to the Docker Engine: list, inspect, create and remove. The mapping is pure
 * and unit tested with fixtures (the tests never touch the socket).
 */

/** One entry of GET /networks and GET /networks/{id} (only the fields pow/dock reads). */
export interface RawNetwork {
  Name: string
  Id: string
  /** ISO 8601 time */
  Created?: string
  Scope?: string
  Driver?: string
  EnableIPv6?: boolean
  IPAM?: { Driver?: string; Config?: { Subnet?: string; Gateway?: string; IPRange?: string }[] | null } | null
  Internal?: boolean
  Attachable?: boolean
  Options?: Record<string, string> | null
  Labels?: Record<string, string> | null
  /** the attached containers, keyed by container ID. GET /networks does not fill it; GET /networks/{id} does. */
  Containers?: Record<string, RawNetworkContainer> | null
}

/** One attached container in a network (GET /networks/{id}). Addresses carry a prefix, such as "172.18.0.2/16". */
export interface RawNetworkContainer {
  Name?: string
  MacAddress?: string
  IPv4Address?: string
  IPv6Address?: string
}

/** The networks Docker creates itself. They cannot be removed. */
const BUILT_IN = new Set(['bridge', 'host', 'none'])
const COMPOSE_PROJECT_LABEL = 'com.docker.compose.project'
/** At most this many network inspections run at the same time. */
const INSPECT_CONCURRENCY = 8

/** A timestamp as ISO text, or null when it is missing or cannot be read. */
function isoOrNull(value: string | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : new Date(time).toISOString()
}

/** "172.18.0.2/16" becomes "172.18.0.2". An empty value stays empty. */
function addressOf(value: string | undefined): string {
  return (value ?? '').split('/')[0] ?? ''
}

function sortedPairs(values: Record<string, string> | null | undefined): { key: string; value: string }[] {
  return Object.entries(values ?? {})
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => ({ key, value }))
}

/** The attached containers of a network, by name. */
export function toNetworkAttachments(raw: RawNetwork): NetworkAttachment[] {
  return Object.entries(raw.Containers ?? {})
    .map(([id, container]) => ({
      id,
      name: container.Name ?? id.slice(0, 12),
      ipv4: addressOf(container.IPv4Address),
      mac: container.MacAddress ?? '',
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

function subnetsOf(raw: RawNetwork): string[] {
  return (raw.IPAM?.Config ?? []).map((config) => config.Subnet ?? '').filter(Boolean)
}

function gatewaysOf(raw: RawNetwork): string[] {
  return (raw.IPAM?.Config ?? []).map((config) => config.Gateway ?? '').filter(Boolean)
}

/** One row of the Networks page. `raw` should come from GET /networks/{id}, which lists the containers. */
export function toNetworkSummary(raw: RawNetwork): NetworkSummary {
  const attachments = toNetworkAttachments(raw)
  const containers: NetworkContainer[] = attachments.map(({ id, name, ipv4 }) => ({ id, name, ipv4 }))
  return {
    id: raw.Id,
    shortId: raw.Id.slice(0, 12),
    name: raw.Name,
    driver: raw.Driver || 'bridge',
    scope: raw.Scope || 'local',
    internal: raw.Internal === true,
    attachable: raw.Attachable === true,
    ipv6: raw.EnableIPv6 === true,
    subnets: subnetsOf(raw),
    gateways: gatewaysOf(raw),
    project: raw.Labels?.[COMPOSE_PROJECT_LABEL] || null,
    builtIn: BUILT_IN.has(raw.Name),
    createdAt: isoOrNull(raw.Created),
    containers,
  }
}

/** The details of one network, with the attached containers and their MAC addresses. */
export function toNetworkDetails(raw: RawNetwork): NetworkDetails {
  return {
    id: raw.Id,
    shortId: raw.Id.slice(0, 12),
    name: raw.Name,
    driver: raw.Driver || 'bridge',
    scope: raw.Scope || 'local',
    internal: raw.Internal === true,
    attachable: raw.Attachable === true,
    ipv6: raw.EnableIPv6 === true,
    subnets: subnetsOf(raw),
    gateways: gatewaysOf(raw),
    builtIn: BUILT_IN.has(raw.Name),
    createdAt: isoOrNull(raw.Created),
    options: sortedPairs(raw.Options),
    labels: sortedPairs(raw.Labels),
    containers: toNetworkAttachments(raw),
  }
}

/** Every network, with the containers attached to each. Containers come from one inspect call per network. */
export async function listNetworks(): Promise<NetworkSummary[]> {
  const list = await dockerRequest<RawNetwork[] | null>('GET', '/networks')
  const networks = list ?? []
  // A network removed since the list was read keeps its list entry, with no containers.
  const inspected = await mapLimit(networks, INSPECT_CONCURRENCY, (network) =>
    dockerRequest<RawNetwork | null>('GET', `/networks/${encodeURIComponent(network.Id)}`).then(
      (raw) => raw ?? network,
      () => network,
    ),
  )
  return inspected.map(toNetworkSummary)
}

/** The details of one network (GET /networks/{id}). `id` is the full id or a short one, or the name. */
export async function inspectNetwork(id: string): Promise<NetworkDetails> {
  assertNetworkRef(id)
  const raw = await dockerRequest<RawNetwork>('GET', `/networks/${encodeURIComponent(id)}`)
  return toNetworkDetails(raw)
}

function assertNetworkRef(value: string): void {
  if (!isValidResourceName(value)) throw new Error('Invalid network ID.')
}

/**
 * Creates a bridge network. The subnet and gateway are optional, but both or neither. Docker's own
 * refusal (for example, an overlapping subnet) comes back in the error.
 */
export async function createNetwork(options: {
  name: string
  driver: 'bridge'
  internal: boolean
  subnet?: string
  gateway?: string
}): Promise<{ id: string }> {
  const name = options.name.trim()
  if (!isValidResourceName(name)) throw new Error('Invalid network name.')
  const subnet = options.subnet?.trim() ?? ''
  const gateway = options.gateway?.trim() ?? ''
  const problem = networkAddressProblem(subnet, gateway)
  if (problem) throw new Error(problem)
  const raw = await dockerRequest<{ Id: string }>('POST', '/networks/create', {
    body: {
      Name: name,
      Driver: options.driver,
      Internal: options.internal,
      ...(subnet ? { IPAM: { Driver: 'default', Config: [{ Subnet: subnet, Gateway: gateway }] } } : {}),
    },
  })
  return { id: raw.Id }
}

/**
 * Removes a network. Docker's own networks (bridge, host, none) are refused here, before Docker is
 * asked. Docker refuses a network that still has containers attached, and its message comes back.
 */
export async function removeNetwork(id: string): Promise<void> {
  assertNetworkRef(id)
  const current = await dockerRequest<RawNetwork>('GET', `/networks/${encodeURIComponent(id)}`)
  if (BUILT_IN.has(current.Name)) throw new Error("Docker's own network cannot be removed.")
  await dockerRequest('DELETE', `/networks/${encodeURIComponent(id)}`)
}
