import { describe, expect, test } from 'bun:test'
import { isSecretKey, parseEnvLine, shortImageId, toContainerDetails, type RawInspect } from './container-details'

// A fixture shaped like GET /containers/{id}/json from Docker Engine 29.
const RAW: RawInspect = {
  Id: 'cbc267a813a30bad6f9a919ac8768e30870ceb29c7ea0a7b1415c2b83c914357',
  Name: '/shop-web-1',
  Created: '2026-01-01T10:00:00.123Z',
  Image: 'sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499',
  State: {
    Status: 'running',
    ExitCode: 0,
    StartedAt: '2026-01-01T10:00:05.5Z',
    Health: {
      Status: 'unhealthy',
      FailingStreak: 2,
      Log: [
        { Start: '2026-01-01T10:01:00Z', ExitCode: 0, Output: 'ok\n' },
        { Start: '2026-01-01T10:02:00Z', ExitCode: 1, Output: '  connection refused\n' },
      ],
    },
  },
  RestartCount: 3,
  Config: {
    Hostname: 'shopweb',
    User: 'nginx',
    Env: ['PATH=/usr/bin', 'DB_PASSWORD=a=b', 'EMPTY'],
    Cmd: ['nginx', '-g', 'daemon off;'],
    Entrypoint: null,
    WorkingDir: '/app',
    Labels: { 'com.docker.compose.project': 'shop', 'app.owner': 'team-a' },
    ExposedPorts: { '80/tcp': {}, '443/tcp': {}, '53/udp': {} },
    Image: 'nginx:1.27',
  },
  HostConfig: { RestartPolicy: { Name: 'on-failure', MaximumRetryCount: 5 } },
  NetworkSettings: {
    Ports: {
      '80/tcp': [
        { HostIp: '0.0.0.0', HostPort: '8080' },
        { HostIp: '::', HostPort: '8080' },
      ],
      '443/tcp': null,
      '53/udp': [{ HostIp: '127.0.0.1', HostPort: '5353' }],
    },
    Networks: {
      bridge: { IPAddress: '172.17.0.2', Gateway: '172.17.0.1', Aliases: ['web', 'cbc267a813a3'] },
      shop_default: { IPAddress: '', Gateway: '', Aliases: null },
    },
  },
  Mounts: [
    { Type: 'bind', Source: '/srv/site', Destination: '/usr/share/nginx/html', RW: false },
    { Type: 'volume', Source: '/var/lib/docker/volumes/data/_data', Destination: '/data', RW: true },
  ],
}

describe('toContainerDetails', () => {
  const details = toContainerDetails(RAW)

  test('overview: names, image, state, restart and commands', () => {
    expect(details.overview).toEqual({
      id: 'cbc267a813a30bad6f9a919ac8768e30870ceb29c7ea0a7b1415c2b83c914357',
      name: 'shop-web-1',
      image: 'nginx:1.27',
      imageId: '858f009f9709',
      created: '2026-01-01T10:00:00.123Z',
      started: '2026-01-01T10:00:05.5Z',
      status: 'running',
      running: true,
      exitCode: 0,
      restartPolicy: 'on-failure (max 5)',
      restartCount: 3,
      command: 'nginx -g daemon off;',
      entrypoint: '',
      workingDir: '/app',
      user: 'nginx',
      hostname: 'shopweb',
    })
  })

  test('a container that never started has no start time, and no restart policy means "no"', () => {
    const never = toContainerDetails({
      ...RAW,
      State: { Status: 'created', StartedAt: '0001-01-01T00:00:00Z' },
      HostConfig: {},
    })
    expect(never.overview.started).toBeNull()
    expect(never.overview.running).toBe(false)
    expect(never.overview.restartPolicy).toBe('no')
  })

  test('published ports are sorted by host port (each binding kept), unpublished ones are skipped', () => {
    expect(details.ports.published).toEqual([
      { containerPort: 53, protocol: 'udp', hostIp: '127.0.0.1', hostPort: 5353 },
      { containerPort: 80, protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 8080 },
      { containerPort: 80, protocol: 'tcp', hostIp: '::', hostPort: 8080 },
    ])
    expect(details.ports.exposed).toEqual(['443/tcp', '53/udp', '80/tcp'])
  })

  test('environment splits at the first "=" and keeps the order', () => {
    expect(details.environment).toEqual([
      { key: 'PATH', value: '/usr/bin' },
      { key: 'DB_PASSWORD', value: 'a=b' },
      { key: 'EMPTY', value: '' },
    ])
  })

  test('mounts show read-only when RW is false', () => {
    expect(details.mounts).toEqual([
      { type: 'bind', source: '/srv/site', destination: '/usr/share/nginx/html', readOnly: true },
      { type: 'volume', source: '/var/lib/docker/volumes/data/_data', destination: '/data', readOnly: false },
    ])
  })

  test('networks list the address, gateway and aliases, with empty values kept', () => {
    expect(details.networks).toEqual([
      { name: 'bridge', ipAddress: '172.17.0.2', gateway: '172.17.0.1', aliases: ['web', 'cbc267a813a3'] },
      { name: 'shop_default', ipAddress: '', gateway: '', aliases: [] },
    ])
  })

  test('labels are sorted by key', () => {
    expect(details.labels).toEqual([
      { key: 'app.owner', value: 'team-a' },
      { key: 'com.docker.compose.project', value: 'shop' },
    ])
  })

  test('health shows the newest check, with its output trimmed', () => {
    expect(details.health).toEqual({
      status: 'unhealthy',
      failingStreak: 2,
      lastCheck: { startedAt: '2026-01-01T10:02:00Z', exitCode: 1, output: 'connection refused' },
    })
  })

  test('no healthcheck gives a null health; no check yet gives a null last check', () => {
    expect(toContainerDetails({ ...RAW, State: { Status: 'running' } }).health).toBeNull()
    const noCheck = toContainerDetails({ ...RAW, State: { Status: 'running', Health: { Status: 'starting' } } })
    expect(noCheck.health).toEqual({ status: 'starting', failingStreak: 0, lastCheck: null })
  })

  test('a nearly empty response maps to empty values without throwing', () => {
    const empty = toContainerDetails({})
    expect(empty.overview.name).toBe('')
    expect(empty.overview.restartPolicy).toBe('no')
    expect(empty.ports).toEqual({ published: [], exposed: [] })
    expect(empty.environment).toEqual([])
    expect(empty.mounts).toEqual([])
    expect(empty.networks).toEqual([])
    expect(empty.labels).toEqual([])
    expect(empty.health).toBeNull()
  })
})

describe('helpers', () => {
  test('secret keys are matched by name, in any case', () => {
    for (const key of [
      'DB_PASSWORD',
      'api_key',
      'GITHUB_TOKEN',
      'AWS_SECRET_ACCESS_KEY',
      'AUTH_HEADER',
      'credentials',
    ]) {
      expect(isSecretKey(key)).toBe(true)
    }
    for (const key of ['PATH', 'HOME', 'LANG', 'PORT']) expect(isSecretKey(key)).toBe(false)
  })

  test('short image id', () => {
    expect(shortImageId('sha256:858f009f9709ce576febc734')).toBe('858f009f9709')
    expect(shortImageId('')).toBe('')
  })

  test('env line parsing', () => {
    expect(parseEnvLine('A=1=2')).toEqual({ key: 'A', value: '1=2' })
    expect(parseEnvLine('NOVALUE')).toEqual({ key: 'NOVALUE', value: '' })
  })
})
