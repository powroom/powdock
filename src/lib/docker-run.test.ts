import { describe, expect, test } from 'bun:test'
import { convertDockerRun, serviceFromImage, tokenize } from './docker-run'
import { emitYaml, yamlScalar } from './yaml-emit'

describe('tokenize', () => {
  test('splits on spaces and keeps quoted text together', () => {
    expect(tokenize(`docker run -e "A=b c" -e 'X=1 2' nginx`)).toEqual([
      'docker',
      'run',
      '-e',
      'A=b c',
      '-e',
      'X=1 2',
      'nginx',
    ])
  })

  test('reads backslash escapes and line continuations', () => {
    expect(tokenize('echo a\\ b "say \\"hi\\"" \\\n  next')).toEqual(['echo', 'a b', 'say "hi"', 'next'])
    expect(tokenize('one \\\r\ntwo')).toEqual(['one', 'two'])
  })

  test('keeps backslashes that do not escape anything inside double quotes', () => {
    expect(tokenize('"C:\\temp"')).toEqual(['C:\\temp'])
  })

  test('refuses unclosed quotes and shell operators', () => {
    expect(() => tokenize(`"open`)).toThrow('double quote')
    expect(() => tokenize(`'open`)).toThrow('single quote')
    expect(() => tokenize('nginx | grep x')).toThrow('shell operator |')
    expect(() => tokenize('a && b')).toThrow('shell operator &')
  })
})

describe('serviceFromImage', () => {
  test('uses the last path part, without the registry, tag or digest', () => {
    expect(serviceFromImage('nginx:1.27')).toBe('nginx')
    expect(serviceFromImage('registry.example.com:5000/team/App:v2')).toBe('app')
    expect(serviceFromImage('docker.io/library/redis@sha256:abc')).toBe('redis')
    expect(serviceFromImage('@@@')).toBe('app')
  })
})

describe('convertDockerRun', () => {
  test('maps the common flags, and quotes only what needs it', () => {
    const result = convertDockerRun('docker run -d -p 8080:80 --name web nginx:1.27')
    expect(result.error).toBeNull()
    expect(result.service).toBe('web')
    expect(result.notConverted).toEqual([])
    expect(result.yaml).toBe(
      [
        'services:',
        '  web:',
        '    image: "nginx:1.27"',
        '    container_name: web',
        '    ports:',
        '      - "8080:80"',
        '',
      ].join('\n'),
    )
  })

  test('combined short flags and attached values work', () => {
    const result = convertDockerRun('docker run -it -dp 80:80 -e A=1 alpine:3.22 sh')
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: {
        alpine: {
          image: 'alpine:3.22',
          ports: ['80:80'],
          environment: ['A=1'],
          command: ['sh'],
          stdin_open: true,
          tty: true,
        },
      },
    })
  })

  test('long flags take --flag=value and --flag value', () => {
    const result = convertDockerRun('docker container run --name=api --restart unless-stopped -w /app redis')
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: {
        api: { image: 'redis', container_name: 'api', restart: 'unless-stopped', working_dir: '/app' },
      },
    })
  })

  test('named volumes are declared at the top, bind mounts are not', () => {
    const result = convertDockerRun('docker run -v data:/var/lib/data -v ./conf:/etc/app:ro -v /cache alpine')
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: {
        alpine: { image: 'alpine', volumes: ['data:/var/lib/data', './conf:/etc/app:ro', '/cache'] },
      },
      volumes: { data: {} },
    })
  })

  test('--mount becomes the long Compose form, and names its volume', () => {
    const result = convertDockerRun(
      'docker run --mount type=volume,source=cache,target=/c,readonly --mount type=bind,source=/srv,dst=/s alpine',
    )
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: {
        alpine: {
          image: 'alpine',
          volumes: [
            { type: 'volume', source: 'cache', target: '/c', read_only: true },
            { type: 'bind', source: '/srv', target: '/s' },
          ],
        },
      },
      volumes: { cache: {} },
    })
  })

  test('a --mount without a target is not converted', () => {
    const result = convertDockerRun('docker run --mount type=bind,source=/x alpine')
    expect(result.notConverted).toEqual(['--mount type=bind,source=/x'])
  })

  test('--network: host, none and bridge are network_mode; other names are external networks', () => {
    expect(Bun.YAML.parse(convertDockerRun('docker run --net host alpine').yaml)).toEqual({
      services: { alpine: { image: 'alpine', network_mode: 'host' } },
    })
    expect(Bun.YAML.parse(convertDockerRun('docker run --network mynet alpine').yaml)).toEqual({
      services: { alpine: { image: 'alpine', networks: ['mynet'] } },
      networks: { mynet: { external: true } },
    })
  })

  test('resources, health checks, ulimits and gpus', () => {
    const result = convertDockerRun(
      'docker run --cpus 1.5 -m 512m --health-cmd "curl -f http://localhost" --health-interval 30s --health-timeout 5s --health-retries 3 --ulimit nofile=1024:2048 --ulimit nproc=65535 --gpus all --shm-size 1g --pull always --platform linux/amd64 alpine',
    )
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: {
        alpine: {
          image: 'alpine',
          pull_policy: 'always',
          platform: 'linux/amd64',
          shm_size: '1g',
          cpus: '1.5',
          mem_limit: '512m',
          healthcheck: {
            test: ['CMD-SHELL', 'curl -f http://localhost'],
            interval: '30s',
            timeout: '5s',
            retries: 3,
          },
          ulimits: { nofile: { soft: 1024, hard: 2048 }, nproc: 65535 },
          deploy: {
            resources: {
              reservations: {
                devices: [{ driver: 'nvidia', count: 'all', capabilities: ['gpu'] }],
              },
            },
          },
        },
      },
    })
  })

  test('labels, hosts, capabilities, devices, privileged and the other simple keys', () => {
    const result = convertDockerRun(
      'docker run --label a=1 -l "b=two words" --add-host db:10.0.0.5 --cap-add NET_ADMIN --device /dev/fuse --privileged -u 1000:1000 -w /srv -h box --entrypoint /bin/sh alpine',
    )
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: {
        alpine: {
          image: 'alpine',
          entrypoint: '/bin/sh',
          user: '1000:1000',
          working_dir: '/srv',
          hostname: 'box',
          labels: ['a=1', 'b=two words'],
          extra_hosts: ['db:10.0.0.5'],
          cap_add: ['NET_ADMIN'],
          devices: ['/dev/fuse'],
          privileged: true,
        },
      },
    })
  })

  test('env files and env names without values', () => {
    expect(Bun.YAML.parse(convertDockerRun('docker run --env-file ./a.env -e KEY alpine').yaml)).toEqual({
      services: { alpine: { image: 'alpine', env_file: ['./a.env'], environment: ['KEY'] } },
    })
  })

  test('detach is dropped silently, and --rm becomes a comment', () => {
    const result = convertDockerRun('docker run --rm --detach alpine')
    expect(result.notConverted).toEqual([])
    expect(result.yaml.startsWith('# --rm was not set.')).toBe(true)
    expect(Bun.YAML.parse(result.yaml)).toEqual({ services: { alpine: { image: 'alpine' } } })
  })

  test('unknown flags are listed in a comment at the top and in notConverted', () => {
    const result = convertDockerRun('docker run --log-driver json-file --foo -P -p 80:80 alpine')
    expect(result.notConverted).toEqual(['--log-driver', '--foo', '-P'])
    expect(result.yaml.split('\n')[0]).toBe('# not converted: --log-driver, --foo, -P')
    expect(Bun.YAML.parse(result.yaml)).toEqual({ services: { alpine: { image: 'alpine', ports: ['80:80'] } } })
  })

  test('the first word after the flags is the image; the rest is the command, flags included', () => {
    const result = convertDockerRun('docker run alpine ls -la /tmp')
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: { alpine: { image: 'alpine', command: ['ls', '-la', '/tmp'] } },
    })
  })

  test('the -- marker ends the flags', () => {
    const result = convertDockerRun('docker run -- -weird-image')
    expect(Bun.YAML.parse(result.yaml)).toEqual({ services: { 'weird-image': { image: '-weird-image' } } })
  })

  test('a prefix other than docker run is refused, and a command without an image', () => {
    expect(convertDockerRun('docker ps').error).toContain('docker run')
    expect(convertDockerRun('docker run -d').error).toContain('No image name')
    expect(convertDockerRun('docker run -p').error).toContain('-p needs a value')
    expect(convertDockerRun('docker run --name').error).toContain('--name needs a value')
  })

  test('an invalid container name is listed, and the service takes the image name', () => {
    const result = convertDockerRun('docker run --name "my app" nginx')
    expect(result.service).toBe('nginx')
    expect(result.notConverted).toEqual(['--name my app (not a valid container name)'])
  })

  test('a flag name from the object prototype is an unknown flag', () => {
    const result = convertDockerRun('docker run --constructor alpine')
    expect(result.notConverted).toEqual(['--constructor'])
  })

  test('a flag that takes a value but is not supported does not eat the image', () => {
    const result = convertDockerRun('docker run --security-opt seccomp=x alpine')
    expect(result.notConverted).toEqual(['--security-opt'])
    expect(Bun.YAML.parse(result.yaml)).toEqual({ services: { alpine: { image: 'alpine' } } })
  })

  test('generated YAML reads back to the same values for awkward strings', () => {
    const result = convertDockerRun('docker run -e "EMPTY=" -e "YES=yes" -e "COLON=a: b" -l "#x" alpine')
    expect(Bun.YAML.parse(result.yaml)).toEqual({
      services: { alpine: { image: 'alpine', environment: ['EMPTY=', 'YES=yes', 'COLON=a: b'], labels: ['#x'] } },
    })
  })
})

describe('emitYaml and yamlScalar', () => {
  test('plain words are not quoted; numbers, booleans and colons are', () => {
    expect(yamlScalar('web')).toBe('web')
    expect(yamlScalar('8080')).toBe('"8080"')
    expect(yamlScalar('true')).toBe('"true"')
    expect(yamlScalar('no')).toBe('"no"')
    expect(yamlScalar('a:b')).toBe('"a:b"')
    expect(yamlScalar('-x')).toBe('"-x"')
    expect(yamlScalar('')).toBe('""')
  })

  test('nested maps, lists and empty values', () => {
    const text = emitYaml({ services: { app: { image: 'x', ports: [], environment: ['A=1'], deploy: {} } } }, ['note'])
    expect(text).toBe(
      [
        '# note',
        'services:',
        '  app:',
        '    image: x',
        '    ports: []',
        '    environment:',
        '      - A=1',
        '    deploy: {}',
        '',
      ].join('\n'),
    )
    expect(Bun.YAML.parse(text)).toEqual({
      services: { app: { image: 'x', ports: [], environment: ['A=1'], deploy: {} } },
    })
  })
})
