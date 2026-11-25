import { describe, expect, test } from 'bun:test'
import { toNetworkAttachments, toNetworkDetails, toNetworkSummary, type RawNetwork } from './networks.server'

// Fixtures shaped like the Docker Engine 29 API (GET /networks and GET /networks/{id}).
// Nothing here touches the socket: the tests call only the pure functions.

const SHOP_ID = '5f1e0d9c8b7a69584736251403f2e1d0c9b8a7f6e5d4c3b2a1908f7e6d5c4b3a'

const BRIDGE: RawNetwork = {
  Name: 'bridge',
  Id: '1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
  Created: '2026-01-01T00:00:00.000000000Z',
  Scope: 'local',
  Driver: 'bridge',
  EnableIPv6: false,
  IPAM: { Driver: 'default', Config: [{ Subnet: '172.17.0.0/16', Gateway: '172.17.0.1' }] },
  Internal: false,
  Attachable: false,
  Containers: {},
}

const SHOP: RawNetwork = {
  Name: 'shop_default',
  Id: SHOP_ID,
  Created: '2026-11-20T10:15:30.123456789Z',
  Scope: 'local',
  Driver: 'bridge',
  EnableIPv6: true,
  IPAM: { Driver: 'default', Config: [{ Subnet: '172.20.0.0/16', Gateway: '172.20.0.1' }] },
  Internal: true,
  Attachable: true,
  Options: { 'com.docker.network.bridge.name': 'br-shop' },
  Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.network': 'default' },
  Containers: {
    f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff00: {
      Name: 'postgres-1',
      MacAddress: '02:42:ac:14:00:02',
      IPv4Address: '172.20.0.2/16',
      IPv6Address: '',
    },
    '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9': {
      Name: 'api-1',
      MacAddress: '02:42:ac:14:00:03',
      IPv4Address: '172.20.0.3/16',
    },
  },
}

describe('toNetworkSummary', () => {
  test('maps a compose network with its containers and subnet', () => {
    expect(toNetworkSummary(SHOP)).toEqual({
      id: SHOP_ID,
      shortId: '5f1e0d9c8b7a',
      name: 'shop_default',
      driver: 'bridge',
      scope: 'local',
      internal: true,
      attachable: true,
      ipv6: true,
      subnets: ['172.20.0.0/16'],
      gateways: ['172.20.0.1'],
      project: 'shop',
      builtIn: false,
      createdAt: '2026-11-20T10:15:30.123Z',
      containers: [
        { id: '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9', name: 'api-1', ipv4: '172.20.0.3' },
        {
          id: 'f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff00',
          name: 'postgres-1',
          ipv4: '172.20.0.2',
        },
      ],
    })
  })

  test('bridge is built in, and has no containers when none are attached', () => {
    expect(toNetworkSummary(BRIDGE)).toMatchObject({
      name: 'bridge',
      builtIn: true,
      project: null,
      containers: [],
      subnets: ['172.17.0.0/16'],
    })
  })

  test('host and none are built in too, and a list entry without containers maps cleanly', () => {
    expect(toNetworkSummary({ Name: 'host', Id: 'abc', Driver: 'host' })).toMatchObject({
      builtIn: true,
      driver: 'host',
      subnets: [],
      gateways: [],
      createdAt: null,
      containers: [],
    })
    expect(toNetworkSummary({ Name: 'none', Id: 'def', Driver: 'null' }).builtIn).toBe(true)
  })

  test('a name that is not built in is not built in, even when it starts with bridge', () => {
    expect(toNetworkSummary({ ...BRIDGE, Name: 'bridge-tools' }).builtIn).toBe(false)
  })
})

describe('toNetworkAttachments and toNetworkDetails', () => {
  test('attachments keep the MAC address and are sorted by name', () => {
    expect(toNetworkAttachments(SHOP).map((item) => [item.name, item.ipv4, item.mac])).toEqual([
      ['api-1', '172.20.0.3', '02:42:ac:14:00:03'],
      ['postgres-1', '172.20.0.2', '02:42:ac:14:00:02'],
    ])
  })

  test('details carry the options and labels in sorted order', () => {
    const details = toNetworkDetails(SHOP)
    expect(details.options).toEqual([{ key: 'com.docker.network.bridge.name', value: 'br-shop' }])
    expect(details.labels).toEqual([
      { key: 'com.docker.compose.network', value: 'default' },
      { key: 'com.docker.compose.project', value: 'shop' },
    ])
    expect(details.containers).toHaveLength(2)
    expect(details.internal).toBe(true)
  })
})
