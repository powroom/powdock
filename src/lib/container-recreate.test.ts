import { describe, expect, test } from 'bun:test'
import fixture from './__fixtures__/busybox-inspect.json'
import { mountBinds, recreateBody, type RecreateInspect } from './container-recreate'

// A real inspect of a container made with:
//   docker run -d --name powdock-update-test -p 127.0.0.1:18099:80 --restart unless-stopped \
//     -e A=1 -v powdock-update-vol:/data busybox:1.36 sleep 3600
const inspect = fixture as unknown as RecreateInspect

describe('recreateBody', () => {
  const body = recreateBody(inspect)
  const host = body.HostConfig as Record<string, unknown>

  test('keeps the image reference, the command and the environment', () => {
    expect(body.Image).toBe('busybox:1.36')
    expect(body.Cmd).toEqual(['sleep', '3600'])
    expect(body.Env).toEqual(['A=1'])
  })

  test('drops the hostname that Docker gave from the short ID', () => {
    expect(inspect.Config?.Hostname).toBe('8f44f4fc4eb1')
    expect('Hostname' in body).toBe(false)
  })

  test('keeps the port publishing and the restart policy', () => {
    expect(host.PortBindings).toEqual({ '80/tcp': [{ HostIp: '127.0.0.1', HostPort: '18099' }] })
    expect(host.RestartPolicy).toEqual({ Name: 'unless-stopped', MaximumRetryCount: 0 })
    expect(host.NetworkMode).toBe('bridge')
  })

  test('keeps the named volume as a bind', () => {
    expect(host.Binds).toEqual(['powdock-update-vol:/data'])
  })

  test('keeps the network with no runtime address', () => {
    const networking = body.NetworkingConfig as { EndpointsConfig: Record<string, Record<string, unknown>> }
    expect(Object.keys(networking.EndpointsConfig)).toEqual(['bridge'])
    expect(networking.EndpointsConfig.bridge).toEqual({})
  })
})

describe('recreateBody with other settings', () => {
  const base: RecreateInspect = {
    Id: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    Name: '/web',
    Image: 'sha256:0000',
    Config: { Image: 'nginx:1.27', Hostname: 'web-host', Env: ['MODE=prod'] },
    HostConfig: { NetworkMode: 'app_net', Binds: ['/srv/site:/usr/share/nginx/html:ro'] },
    Mounts: [
      { Type: 'bind', Source: '/srv/site', Destination: '/usr/share/nginx/html', RW: false },
      { Type: 'volume', Name: 'a'.repeat(64), Destination: '/var/cache/nginx', RW: true },
      { Type: 'tmpfs', Destination: '/run' },
    ],
    NetworkSettings: {
      Networks: {
        app_net: {
          Aliases: ['web', 'abcdef012345', 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'],
          IPAMConfig: { IPv4Address: '172.20.0.10' },
          IPAddress: '172.20.0.2',
          NetworkID: 'n1',
          EndpointID: 'e1',
          MacAddress: '02:42:ac:14:00:02',
        },
      },
    },
  }

  test('a custom hostname is kept', () => {
    expect(recreateBody(base).Hostname).toBe('web-host')
  })

  test('an anonymous volume and a bind are added once, and tmpfs is not a bind', () => {
    expect(mountBinds(base)).toEqual(['/srv/site:/usr/share/nginx/html:ro', `${'a'.repeat(64)}:/var/cache/nginx:rw`])
  })

  test('the old IDs are removed from the aliases, and only the static address is kept', () => {
    const networking = recreateBody(base).NetworkingConfig as { EndpointsConfig: Record<string, unknown> }
    expect(networking.EndpointsConfig).toEqual({
      app_net: { Aliases: ['web'], IPAMConfig: { IPv4Address: '172.20.0.10' } },
    })
  })

  test('a host network gets no endpoints', () => {
    const hostMode: RecreateInspect = {
      ...base,
      HostConfig: { NetworkMode: 'host' },
      NetworkSettings: { Networks: { host: { Aliases: null } } },
    }
    expect(recreateBody(hostMode).NetworkingConfig).toEqual({ EndpointsConfig: {} })
  })
})

describe('mounts made with --mount', () => {
  test('are not added again as binds', () => {
    const binds = mountBinds({
      HostConfig: { Binds: [], Mounts: [{ Type: 'volume', Source: 'data', Target: '/data' }] },
      Mounts: [
        { Type: 'volume', Name: 'data', Source: '/var/lib/docker/volumes/data/_data', Destination: '/data', RW: true },
      ],
    })
    expect(binds).toEqual([])
  })
})
