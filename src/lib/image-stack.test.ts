import { describe, expect, test } from 'bun:test'
import {
  BASE_NAME_LABEL,
  baseOsFromHistory,
  commandWords,
  detectStack,
  stackFromCommand,
  stackFromEnv,
  stackFromTags,
  uniqueSortedIds,
  type StackConfig,
} from './image-stack'

/** A config with nothing set, so each test adds only what it checks. */
function config(overrides: Partial<StackConfig> = {}): StackConfig {
  return { env: [], entrypoint: null, cmd: null, labels: {}, ...overrides }
}

describe('commandWords', () => {
  test('splits arguments into lower-case basenames', () => {
    expect(commandWords(null, ['/usr/local/bin/PHP-FPM', '-F'])).toEqual(['php-fpm', '-f'])
    expect(commandWords(['entrypoint'], ['php', 'artisan', 'octane:start'])).toEqual([
      'entrypoint',
      'php',
      'artisan',
      'octane',
      'start',
    ])
  })

  test('reads the words of a shell script given as one argument', () => {
    expect(commandWords(null, ['/bin/sh', '-c', 'php-fpm && nginx -g "daemon off;"'])).toEqual([
      'sh',
      '-c',
      'php-fpm',
      'nginx',
      '-g',
      'daemon',
      'off',
    ])
  })

  test('is empty without a command', () => {
    expect(commandWords(null, null)).toEqual([])
    expect(commandWords([], [])).toEqual([])
  })
})

describe('stackFromCommand', () => {
  test('Laravel: artisan or octane', () => {
    expect(stackFromCommand(null, ['php', 'artisan', 'octane:start', '--port=8000'])).toBe('laravel')
    expect(stackFromCommand(null, ['php', 'artisan', 'queue:work'])).toBe('laravel')
    expect(stackFromCommand(['docker-entrypoint.sh'], ['octane'])).toBe('laravel')
  })

  test('PHP: php-fpm, php and frankenphp', () => {
    expect(stackFromCommand(null, ['php-fpm'])).toBe('php')
    expect(stackFromCommand(null, ['php', '-S', '0.0.0.0:8000'])).toBe('php')
    expect(stackFromCommand(null, ['frankenphp', 'run'])).toBe('php')
    expect(stackFromCommand(['/usr/local/bin/frankenphp'], null)).toBe('php')
  })

  test('Next.js comes before Node', () => {
    expect(stackFromCommand(null, ['npx', 'next', 'start'])).toBe('nextdotjs')
    expect(stackFromCommand(null, ['next', 'start', '-p', '3000'])).toBe('nextdotjs')
  })

  test('Node: node, npm, pnpm, yarn, npx and nest', () => {
    expect(stackFromCommand(null, ['node', 'server.js'])).toBe('nodedotjs')
    expect(stackFromCommand(null, ['npm', 'run', 'start'])).toBe('nodedotjs')
    expect(stackFromCommand(null, ['pnpm', 'start'])).toBe('nodedotjs')
    expect(stackFromCommand(null, ['yarn', 'start'])).toBe('nodedotjs')
    expect(stackFromCommand(null, ['npx', 'serve'])).toBe('nodedotjs')
    expect(stackFromCommand(null, ['nest', 'start'])).toBe('nodedotjs')
  })

  test('Bun and Deno', () => {
    expect(stackFromCommand(null, ['bun', 'run', 'index.ts'])).toBe('bun')
    expect(stackFromCommand(null, ['deno', 'run', 'main.ts'])).toBe('deno')
  })

  test('Python: uvicorn, gunicorn, python, python3, flask, django-admin and manage.py', () => {
    expect(stackFromCommand(null, ['uvicorn', 'app:main'])).toBe('python')
    expect(stackFromCommand(null, ['gunicorn', 'wsgi'])).toBe('python')
    expect(stackFromCommand(null, ['python', '-m', 'http.server'])).toBe('python')
    expect(stackFromCommand(null, ['python3', 'app.py'])).toBe('python')
    expect(stackFromCommand(null, ['flask', 'run'])).toBe('python')
    expect(stackFromCommand(null, ['django-admin', 'runserver'])).toBe('python')
    expect(stackFromCommand(null, ['python', 'manage.py', 'runserver'])).toBe('python')
  })

  test('Java: java, and a .jar file', () => {
    expect(stackFromCommand(null, ['java', '-jar', 'app.jar'])).toBe('openjdk')
    expect(stackFromCommand(null, ['-jar', '/opt/app/service.JAR'])).toBe('openjdk')
  })

  test('.NET, Ruby, and the other servers', () => {
    expect(stackFromCommand(null, ['dotnet', 'App.dll'])).toBe('dotnet')
    expect(stackFromCommand(null, ['rails', 'server'])).toBe('ruby')
    expect(stackFromCommand(null, ['puma', '-C', 'config.rb'])).toBe('ruby')
    expect(stackFromCommand(null, ['bundle', 'exec', 'sidekiq'])).toBe('ruby')
    expect(stackFromCommand(null, ['nginx', '-g', 'daemon off;'])).toBe('nginx')
    expect(stackFromCommand(null, ['caddy', 'run'])).toBe('caddy')
    expect(stackFromCommand(null, ['mix', 'phx.server'])).toBe('elixir')
    expect(stackFromCommand(null, ['elixir', '--sname', 'app'])).toBe('elixir')
  })

  test('databases: mariadbd, mysqld, postgres, redis-server and mongod', () => {
    expect(stackFromCommand(null, ['mariadbd'])).toBe('mariadb')
    expect(stackFromCommand(null, ['mysqld'])).toBe('mysql')
    expect(stackFromCommand(['docker-entrypoint.sh'], ['postgres'])).toBe('postgresql')
    expect(stackFromCommand(null, ['redis-server', '/etc/redis.conf'])).toBe('redis')
    expect(stackFromCommand(null, ['mongod', '--bind_ip_all'])).toBe('mongodb')
  })

  test('wrappers alone name no stack, so the next check decides', () => {
    expect(stackFromCommand(['entrypoint'], ['supervisord', '-c', '/etc/supervisord.conf'])).toBe(null)
    expect(stackFromCommand(['docker-entrypoint.sh'], null)).toBe(null)
    expect(stackFromCommand(['/sbin/tini', '--'], ['/bin/sh', '-c'])).toBe(null)
    expect(stackFromCommand(['dumb-init'], ['bash'])).toBe(null)
  })

  test('an unknown program names no stack', () => {
    expect(stackFromCommand(null, ['./main'])).toBe(null)
    expect(stackFromCommand(null, ['/app/server'])).toBe(null)
    expect(stackFromCommand(null, null)).toBe(null)
  })

  test('words must match whole, not as a part of a longer word', () => {
    expect(stackFromCommand(null, ['phpunit'])).toBe(null)
    expect(stackFromCommand(null, ['nodemon', 'app.js'])).toBe(null)
    expect(stackFromCommand(null, ['mysqldump'])).toBe(null)
    expect(stackFromCommand(null, ['dotnetcore-tool'])).toBe(null)
    expect(stackFromCommand(null, ['myapp.jarred'])).toBe(null)
  })

  test('database proxies, web servers, office, metrics and infrastructure tools', () => {
    expect(stackFromCommand(null, ['pgbouncer', '-u', 'postgres'])).toBe('postgresql')
    expect(stackFromCommand(null, ['curl', '-f', 'http://localhost'])).toBe('curl')
    expect(stackFromCommand(null, ['soffice', '--headless'])).toBe('libreoffice')
    expect(stackFromCommand(null, ['libreoffice', '--convert-to', 'pdf'])).toBe('libreoffice')
    expect(stackFromCommand(null, ['grafana', 'server'])).toBe('grafana')
    expect(stackFromCommand(null, ['/usr/share/grafana/bin/grafana-server'])).toBe('grafana')
    expect(stackFromCommand(null, ['prometheus', '--config.file=/etc/prometheus.yml'])).toBe('prometheus')
    expect(stackFromCommand(null, ['haproxy', '-f', '/usr/local/etc/haproxy.cfg'])).toBe('haproxy')
    expect(stackFromCommand(['/entrypoint.sh'], ['traefik'])).toBe('traefikproxy')
    expect(stackFromCommand(null, ['mvn', 'package'])).toBe('apachemaven')
    expect(stackFromCommand(null, ['gradle', 'build'])).toBe('gradle')
    expect(stackFromCommand(null, ['vault', 'server', '-config=/vault/config'])).toBe('vault')
    expect(stackFromCommand(null, ['consul', 'agent', '-dev'])).toBe('consul')
  })

  test('the first matching rule wins, not the first word', () => {
    // nginx is earlier in the command, but php has the higher rule priority
    expect(stackFromCommand(null, ['nginx', 'php-fpm'])).toBe('php')
  })
})

describe('stackFromEnv', () => {
  test('reads the version variables of the base images', () => {
    expect(stackFromEnv(['PHP_VERSION=8.4.27'])).toBe('php')
    expect(stackFromEnv(['NODE_VERSION=22.23.4'])).toBe('nodedotjs')
    expect(stackFromEnv(['PYTHON_VERSION=3.13.1'])).toBe('python')
    expect(stackFromEnv(['GOLANG_VERSION=1.23.4'])).toBe('go')
    expect(stackFromEnv(['GO_VERSION=1.23.4'])).toBe('go')
    expect(stackFromEnv(['JAVA_VERSION=21.0.5'])).toBe('openjdk')
    expect(stackFromEnv(['RUBY_VERSION=3.4.1'])).toBe('ruby')
    expect(stackFromEnv(['BUN_VERSION=1.2.0'])).toBe('bun')
    expect(stackFromEnv(['DENO_VERSION=2.1.0'])).toBe('deno')
    expect(stackFromEnv(['DOTNET_VERSION=9.0.0'])).toBe('dotnet')
    expect(stackFromEnv(['ASPNET_VERSION=9.0.0'])).toBe('dotnet')
    expect(stackFromEnv(['NGINX_VERSION=1.27.3'])).toBe('nginx')
    expect(stackFromEnv(['CADDY_VERSION=2.8.4'])).toBe('caddy')
    expect(stackFromEnv(['ELIXIR_VERSION=1.17.3'])).toBe('elixir')
    expect(stackFromEnv(['RUST_VERSION=1.83.0'])).toBe('rust')
  })

  test('the other base images: Grafana, Perl, Erlang, Julia, Maven and Gradle', () => {
    expect(stackFromEnv(['GRAFANA_VERSION=11.4.0'])).toBe('grafana')
    expect(stackFromEnv(['PERL_VERSION=5.40.0'])).toBe('perl')
    expect(stackFromEnv(['ERLANG_VERSION=27.2'])).toBe('erlang')
    expect(stackFromEnv(['OTP_VERSION=27.2'])).toBe('erlang')
    expect(stackFromEnv(['JULIA_VERSION=1.11.2'])).toBe('julia')
    expect(stackFromEnv(['MAVEN_VERSION=3.9.9'])).toBe('apachemaven')
    expect(stackFromEnv(['GRADLE_VERSION=8.11'])).toBe('gradle')
  })

  test('PHP wins over Node when both are set (a Laravel image with a Node build step)', () => {
    expect(stackFromEnv(['NODE_VERSION=22.23.4', 'PHP_VERSION=8.4.27'])).toBe('php')
    expect(stackFromEnv(['PHP_VERSION=8.4.27', 'NODE_VERSION=22.23.4'])).toBe('php')
  })

  test('an empty version is no version', () => {
    expect(stackFromEnv(['PHP_VERSION='])).toBe(null)
    expect(stackFromEnv(['PHP_VERSION=  '])).toBe(null)
    expect(stackFromEnv(['NODE_VERSION=', 'PYTHON_VERSION=3.13.1'])).toBe('python')
  })

  test('the name must match exactly', () => {
    expect(stackFromEnv(['PHP_VERSIONS=8.4'])).toBe(null)
    expect(stackFromEnv(['php_version=8.4'])).toBe(null)
    expect(stackFromEnv(['MY_PHP_VERSION=8.4'])).toBe(null)
  })

  test('a value may hold "=" and a line without "=" is ignored', () => {
    expect(stackFromEnv(['NODE_VERSION=22=lts'])).toBe('nodedotjs')
    expect(stackFromEnv(['PHP_VERSION'])).toBe(null)
    expect(stackFromEnv(['=8.4'])).toBe(null)
  })

  test('no version variable names no stack', () => {
    expect(stackFromEnv([])).toBe(null)
    expect(stackFromEnv(['PATH=/usr/bin', 'APP_ENV=production'])).toBe(null)
  })
})

describe('detectStack', () => {
  test('the custom PHP image: an entrypoint script, supervisord, and PHP_VERSION', () => {
    expect(
      detectStack(
        config({
          env: ['PATH=/usr/local/sbin', 'PHP_VERSION=8.4.27'],
          entrypoint: ['entrypoint'],
          cmd: ['supervisord', '-c', '/etc/supervisord.conf'],
        }),
      ),
    ).toBe('php')
  })

  test('the custom Laravel image: php artisan octane:start', () => {
    expect(
      detectStack(
        config({
          env: ['PHP_VERSION=8.2.29'],
          cmd: ['php', 'artisan', 'octane:start', '--server=frankenphp'],
        }),
      ),
    ).toBe('laravel')
  })

  test('the custom Node image: node server.js and NODE_VERSION', () => {
    expect(detectStack(config({ env: ['NODE_VERSION=22.23.4'], cmd: ['node', 'server.js'] }))).toBe('nodedotjs')
  })

  test('a Node image with no start command still shows Node from its version', () => {
    expect(detectStack(config({ env: ['NODE_VERSION=22.23.2'] }))).toBe('nodedotjs')
  })

  test('the start command beats the version variable', () => {
    expect(detectStack(config({ env: ['NODE_VERSION=22.0.0'], cmd: ['python', 'app.py'] }))).toBe('python')
  })

  test('the version variable beats the base image label', () => {
    expect(
      detectStack(
        config({
          env: ['RUBY_VERSION=3.4.1'],
          labels: { [BASE_NAME_LABEL]: 'docker.io/library/node:22-alpine' },
        }),
      ),
    ).toBe('ruby')
  })

  test('the base image label is run through the name mapping', () => {
    expect(detectStack(config({ labels: { [BASE_NAME_LABEL]: 'docker.io/library/node:22-alpine' } }))).toBe('nodedotjs')
    expect(detectStack(config({ labels: { [BASE_NAME_LABEL]: 'docker.io/library/postgres:17' } }))).toBe('postgresql')
    expect(detectStack(config({ labels: { [BASE_NAME_LABEL]: 'ghcr.io/org/private-base:1' } }))).toBe(null)
  })

  test('the custom Go image with no version variable and an unknown program gets no icon', () => {
    expect(
      detectStack(
        config({
          env: ['PATH=/usr/bin', 'APP_ENV=production'],
          entrypoint: null,
          cmd: ['./main'],
          labels: { 'org.opencontainers.image.source': 'https://example.invalid' },
        }),
      ),
    ).toBe(null)
  })

  test('an empty config gets no icon', () => {
    expect(detectStack(config())).toBe(null)
  })
})

describe('uniqueSortedIds', () => {
  test('sorts, removes duplicates and drops empty ids', () => {
    expect(uniqueSortedIds(['sha256:b', 'sha256:a', 'sha256:b', '', 'sha256:c'])).toEqual([
      'sha256:a',
      'sha256:b',
      'sha256:c',
    ])
  })

  test('the same set of ids gives the same list in any order', () => {
    expect(uniqueSortedIds(['y', 'x'])).toEqual(uniqueSortedIds(['x', 'y']))
  })

  test('an empty list stays empty', () => {
    expect(uniqueSortedIds([])).toEqual([])
  })
})

describe('stackFromTags', () => {
  test('finds a stack word in the repository name of a tag', () => {
    expect(stackFromTags(['jobdesk-libreoffice:latest'])).toBe('libreoffice')
    expect(stackFromTags(['cp-kafka:7.6.0'])).toBe('apachekafka')
    expect(stackFromTags(['myorg/my_redis.cache:1'])).toBe('redis')
  })

  test('the first tag with a word that names a stack wins, and word order decides within a tag', () => {
    expect(stackFromTags(['internal/app:1', 'mongo-tools:2'])).toBe('mongodb')
    expect(stackFromTags(['mysql-postgres:1'])).toBe('mysql')
  })

  test('words under three letters are skipped', () => {
    expect(stackFromTags(['go-app:1'])).toBe(null)
    expect(stackFromTags(['my-go:1'])).toBe(null)
  })

  test('only an exact name counts, not a part of a word', () => {
    expect(stackFromTags(['redislike-tool:1'])).toBe(null)
    expect(stackFromTags(['nodes:1'])).toBe(null)
  })

  test('the namespace does not count, and no tags give no icon', () => {
    expect(stackFromTags(['postgres/app:1'])).toBe(null)
    expect(stackFromTags([])).toBe(null)
    expect(stackFromTags(['<none>:<none>'])).toBe(null)
  })
})

describe('baseOsFromHistory', () => {
  test('reads the base OS from the oldest line, which is last in the list', () => {
    expect(
      baseOsFromHistory([
        'COPY --from=builder /app/server /app/server # buildkit',
        'CMD ["/app/server"]',
        '/bin/sh -c apk add --no-cache ca-certificates # buildkit',
        'ADD alpine-minirootfs-3.20.3-x86_64.tar.gz / # buildkit',
      ]),
    ).toBe('alpinelinux')
  })

  test('finds the base OS when a newer line also names another OS', () => {
    expect(
      baseOsFromHistory(['RUN apt-get install ubuntu-keyring # buildkit', 'ADD file:abc in / # os_release_debian']),
    ).toBe('debian')
  })

  test('the other distributions', () => {
    expect(baseOsFromHistory(['ADD rocky-release.tar in / # rockylinux'])).toBe('rockylinux')
    expect(baseOsFromHistory(['ADD almalinux-9.tar in / # almalinux'])).toBe('almalinux')
    expect(baseOsFromHistory(['ADD centos-stream.tar in / # centos'])).toBe('centos')
    expect(baseOsFromHistory(['ADD fedora.tar in / # fedora'])).toBe('fedora')
    expect(baseOsFromHistory(['ADD ubuntu-noble.tar in / # ubuntu'])).toBe('ubuntu')
  })

  test('no OS in the history gives no icon', () => {
    expect(baseOsFromHistory(['/bin/sh -c #(nop) CMD ["/app"]', 'ADD file:abc in /'])).toBe(null)
    expect(baseOsFromHistory([])).toBe(null)
  })
})
