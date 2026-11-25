import type { NetworkSummary } from './types'

// Pure helpers for the Networks page: which networks match the filter and the search, how they sort,
// the counts on the filter tabs, and why a network cannot be removed. No React here, so they are unit tested.

export type NetworkFilter = 'all' | 'in-use' | 'unused'

/** Docker's own networks count as in use, because Docker needs them. */
export function isNetworkInUse(network: Pick<NetworkSummary, 'builtIn' | 'containers'>): boolean {
  return network.builtIn || network.containers.length > 0
}

export function matchesNetworkFilter(
  network: Pick<NetworkSummary, 'builtIn' | 'containers'>,
  filter: NetworkFilter,
): boolean {
  if (filter === 'in-use') return isNetworkInUse(network)
  if (filter === 'unused') return !isNetworkInUse(network)
  return true
}

/** Case-insensitive match on the name, the subnets and the Compose project. An empty query matches all. */
export function matchesNetworkSearch(
  network: Pick<NetworkSummary, 'name' | 'subnets' | 'project'>,
  query: string,
): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [network.name, network.project ?? '', ...network.subnets].some((value) => value.toLowerCase().includes(needle))
}

export function countNetworks(networks: readonly NetworkSummary[]): Record<NetworkFilter, number> {
  return {
    all: networks.length,
    'in-use': networks.filter((network) => matchesNetworkFilter(network, 'in-use')).length,
    unused: networks.filter((network) => matchesNetworkFilter(network, 'unused')).length,
  }
}

/** Your networks by name, then Docker's own (bridge, host, none) by name. */
export function sortNetworks(networks: readonly NetworkSummary[]): NetworkSummary[] {
  return [...networks].sort((a, b) => {
    if (a.builtIn !== b.builtIn) return a.builtIn ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

/** Why Remove is off for a network, or null when it can be removed. */
export function networkRemoveBlock(network: Pick<NetworkSummary, 'builtIn' | 'containers'>): string | null {
  if (network.builtIn) return "Docker's own network"
  if (network.containers.length > 0) return 'Disconnect its containers first'
  return null
}
