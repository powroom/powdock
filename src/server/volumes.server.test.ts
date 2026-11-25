import { describe, expect, test } from 'bun:test'
import {
  isAnonymousVolume,
  mountsByVolume,
  toVolumeDetails,
  toVolumeSizes,
  toVolumeSummary,
  type RawVolume,
} from './volumes.server'
import type { RawContainer } from './docker.server'

// Fixtures shaped like the Docker Engine 29 API (GET /volumes, GET /containers/json, GET /system/df).
// Nothing here touches the socket: the tests call only the pure functions.

const ANON = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2'

const PGDATA: RawVolume = {
  Name: 'pgdata',
  Driver: 'local',
  Mountpoint: '/var/lib/docker/volumes/pgdata/_data',
  CreatedAt: '2026-11-20T10:15:30Z',
  Labels: { 'com.docker.compose.project': 'shop' },
  Scope: 'local',
  Options: null,
}
const ANONYMOUS: RawVolume = {
  Name: ANON,
  Driver: 'local',
  Mountpoint: `/var/lib/docker/volumes/${ANON}/_data`,
  CreatedAt: '2026-11-01T08:00:00Z',
  Labels: null,
  Scope: 'local',
}
const CACHE: RawVolume = { Name: 'build-cache', Driver: 'local', Mountpoint: '/x', CreatedAt: 'not a date' }

const POSTGRES: RawContainer = {
  Id: 'f1e2d3c4b5a69788796a5b4c3d2e1f00112233445566778899aabbccddeeff00',
  Names: ['/postgres-1'],
  Image: 'postgres:16',
  Created: 1795400000,
  State: 'running',
  Status: 'Up 3 hours',
  Mounts: [
    { Type: 'volume', Name: 'pgdata', Destination: '/var/lib/postgresql/data', RW: true },
    { Type: 'bind', Source: '/etc/localtime', Destination: '/etc/localtime', RW: false },
  ],
}
const WORKER: RawContainer = {
  Id: '0a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9',
  Names: ['/worker'],
  Image: 'app:1',
  Created: 1795400001,
  State: 'exited',
  Status: 'Exited (0) 2 days ago',
  Mounts: [
    { Type: 'volume', Name: 'pgdata', Destination: '/backup', RW: false },
    { Type: 'volume', Name: ANON, Destination: '/cache', RW: true },
    { Type: 'volume', Name: ANON, Destination: '/cache2', RW: true },
  ],
}

describe('mountsByVolume', () => {
  test('groups the volume mounts by volume name and leaves out bind mounts', () => {
    const byVolume = mountsByVolume([POSTGRES, WORKER])
    expect([...byVolume.keys()].sort()).toEqual(['pgdata', ANON].sort())
    expect(byVolume.get('pgdata')).toEqual([
      {
        id: POSTGRES.Id,
        name: 'postgres-1',
        running: true,
        destination: '/var/lib/postgresql/data',
        readOnly: false,
      },
      { id: WORKER.Id, name: 'worker', running: false, destination: '/backup', readOnly: true },
    ])
  })

  test('a container that mounts one volume twice gets two entries', () => {
    expect(mountsByVolume([WORKER]).get(ANON)).toHaveLength(2)
  })
})

describe('isAnonymousVolume', () => {
  test('a 64-character hex name without labels is anonymous', () => {
    expect(isAnonymousVolume(ANONYMOUS)).toBe(true)
  })

  test('a hex name with the anonymous label of Docker 23+ is anonymous', () => {
    expect(isAnonymousVolume({ Name: ANON, Labels: { 'com.docker.volume.anonymous': '' } })).toBe(true)
  })

  test('a named volume, or one with labels, is not anonymous', () => {
    expect(isAnonymousVolume(PGDATA)).toBe(false)
    expect(isAnonymousVolume({ Name: ANON, Labels: { owner: 'me' } })).toBe(false)
  })
})

describe('toVolumeSummary', () => {
  test('maps a compose volume that one container uses', () => {
    const mounts = mountsByVolume([POSTGRES]).get('pgdata') ?? []
    expect(toVolumeSummary(PGDATA, mounts)).toEqual({
      name: 'pgdata',
      driver: 'local',
      mountpoint: '/var/lib/docker/volumes/pgdata/_data',
      createdAt: '2026-11-20T10:15:30.000Z',
      project: 'shop',
      anonymous: false,
      usedBy: [{ id: POSTGRES.Id, name: 'postgres-1', running: true }],
      size: null,
    })
  })

  test('an unused anonymous volume has no users and no project', () => {
    expect(toVolumeSummary(ANONYMOUS, [])).toMatchObject({
      anonymous: true,
      project: null,
      usedBy: [],
    })
  })

  test('a container that mounts a volume twice is listed once', () => {
    const mounts = mountsByVolume([WORKER]).get(ANON) ?? []
    expect(toVolumeSummary(ANONYMOUS, mounts).usedBy).toEqual([{ id: WORKER.Id, name: 'worker', running: false }])
  })

  test('a date Docker does not give, or cannot read, is null', () => {
    expect(toVolumeSummary(CACHE, []).createdAt).toBeNull()
  })

  test('a missing driver counts as local', () => {
    expect(toVolumeSummary({ Name: 'x' }, []).driver).toBe('local')
  })
})

describe('toVolumeDetails', () => {
  test('keeps labels and options sorted, and every mount', () => {
    const details = toVolumeDetails(
      { ...PGDATA, Labels: { z: '1', a: '2' }, Options: { type: 'tmpfs', device: 'x' } },
      mountsByVolume([POSTGRES]).get('pgdata') ?? [],
    )
    expect(details.labels).toEqual([
      { key: 'a', value: '2' },
      { key: 'z', value: '1' },
    ])
    expect(details.options).toEqual([
      { key: 'device', value: 'x' },
      { key: 'type', value: 'tmpfs' },
    ])
    expect(details.scope).toBe('local')
    expect(details.usedBy).toHaveLength(1)
  })
})

describe('toVolumeSizes', () => {
  test('maps the sizes, and -1 (not known) becomes null', () => {
    expect(
      toVolumeSizes({
        Volumes: [
          { Name: 'pgdata', UsageData: { Size: 1_048_576, RefCount: 1 } },
          { Name: ANON, UsageData: { Size: -1, RefCount: 0 } },
          { Name: 'no-usage' },
        ],
      }),
    ).toEqual({ pgdata: 1_048_576, [ANON]: null, 'no-usage': null })
  })

  test('no volumes gives an empty map', () => {
    expect(toVolumeSizes({ Volumes: null })).toEqual({})
    expect(toVolumeSizes(null)).toEqual({})
  })
})
