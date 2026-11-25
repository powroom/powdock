import { describe, expect, test } from 'bun:test'
import {
  countNetworks,
  isNetworkInUse,
  matchesNetworkFilter,
  matchesNetworkSearch,
  networkRemoveBlock,
  sortNetworks,
} from './network-view'
import type { NetworkSummary } from './types'

function network(overrides: Partial<NetworkSummary>): NetworkSummary {
  return {
    id: 'a'.repeat(64),
    shortId: 'aaaaaaaaaaaa',
    name: 'custom',
    driver: 'bridge',
    scope: 'local',
    internal: false,
    attachable: false,
    ipv6: false,
    subnets: [],
    gateways: [],
    project: null,
    builtIn: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    containers: [],
    ...overrides,
  }
}

const SHOP = network({
  name: 'shop_default',
  project: 'shop',
  subnets: ['172.20.0.0/16'],
  containers: [{ id: '1', name: 'postgres-1', ipv4: '172.20.0.2' }],
})
const BRIDGE = network({ name: 'bridge', builtIn: true, subnets: ['172.17.0.0/16'] })
const HOST = network({ name: 'host', builtIn: true })
const TOOLS = network({ name: 'tools' })

describe('isNetworkInUse and matchesNetworkFilter', () => {
  test('built-in networks count as in use', () => {
    expect(isNetworkInUse(BRIDGE)).toBe(true)
    expect(matchesNetworkFilter(HOST, 'in-use')).toBe(true)
  })

  test('a network with containers is in use, one without is unused', () => {
    expect(matchesNetworkFilter(SHOP, 'in-use')).toBe(true)
    expect(matchesNetworkFilter(TOOLS, 'unused')).toBe(true)
    expect(matchesNetworkFilter(SHOP, 'unused')).toBe(false)
    expect(matchesNetworkFilter(TOOLS, 'all')).toBe(true)
  })
})

describe('matchesNetworkSearch', () => {
  test('matches the name, a subnet and the project', () => {
    expect(matchesNetworkSearch(SHOP, 'SHOP_')).toBe(true)
    expect(matchesNetworkSearch(SHOP, '172.20')).toBe(true)
    expect(matchesNetworkSearch(SHOP, 'shop')).toBe(true)
    expect(matchesNetworkSearch(TOOLS, '172.20')).toBe(false)
  })

  test('an empty query matches everything', () => {
    expect(matchesNetworkSearch(TOOLS, '')).toBe(true)
  })
})

describe('countNetworks', () => {
  test('counts for each tab', () => {
    expect(countNetworks([SHOP, BRIDGE, HOST, TOOLS])).toEqual({ all: 4, 'in-use': 3, unused: 1 })
  })
})

describe('sortNetworks', () => {
  test('your networks by name, then Docker built-in ones by name', () => {
    expect(sortNetworks([BRIDGE, TOOLS, HOST, SHOP]).map((item) => item.name)).toEqual([
      'shop_default',
      'tools',
      'bridge',
      'host',
    ])
  })
})

describe('networkRemoveBlock', () => {
  test('built-in networks say they are Docker own', () => {
    expect(networkRemoveBlock(HOST)).toBe("Docker's own network")
  })

  test('a network with containers must be disconnected first', () => {
    expect(networkRemoveBlock(SHOP)).toBe('Disconnect its containers first')
  })

  test('an empty custom network can be removed', () => {
    expect(networkRemoveBlock(TOOLS)).toBeNull()
  })
})
