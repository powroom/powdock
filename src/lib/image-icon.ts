// Pure helpers for the image tiles: which brand icon an image gets, the letter of a tile without one, and
// whether a brand color reads well on the theme's surface. No React here, so the tests use plain strings.

/** The brand icons the app draws. Each key has a simple-icons icon on the server (server/image-icon-paths.server.ts). */
export type IconKey =
  | 'adguard'
  | 'adminer'
  | 'airbyte'
  | 'almalinux'
  | 'alpinelinux'
  | 'ansible'
  | 'apache'
  | 'apacheairflow'
  | 'apachecassandra'
  | 'apachecouchdb'
  | 'apachedruid'
  | 'apacheflink'
  | 'apachehadoop'
  | 'apachekafka'
  | 'apachemaven'
  | 'apachenifi'
  | 'apachepulsar'
  | 'apachesolr'
  | 'apachespark'
  | 'apachesuperset'
  | 'apachetomcat'
  | 'appsmith'
  | 'appwrite'
  | 'archlinux'
  | 'argo'
  | 'authelia'
  | 'authentik'
  | 'baserow'
  | 'bitbucket'
  | 'bookstack'
  | 'budibase'
  | 'bun'
  | 'caddy'
  | 'centos'
  | 'chatwoot'
  | 'clickhouse'
  | 'clojure'
  | 'cloudflare'
  | 'cockroachlabs'
  | 'composer'
  | 'consul'
  | 'couchbase'
  | 'curl'
  | 'debian'
  | 'deno'
  | 'directus'
  | 'docker'
  | 'dotnet'
  | 'drupal'
  | 'duckdb'
  | 'eclipsemosquitto'
  | 'elasticsearch'
  | 'elixir'
  | 'envoyproxy'
  | 'erlang'
  | 'erpnext'
  | 'etcd'
  | 'excalidraw'
  | 'fedora'
  | 'fluentbit'
  | 'fluentd'
  | 'forgejo'
  | 'freshrss'
  | 'ghost'
  | 'gitea'
  | 'gitlab'
  | 'gnubash'
  | 'go'
  | 'gradle'
  | 'grafana'
  | 'graylog'
  | 'haproxy'
  | 'harbor'
  | 'hashicorp'
  | 'haskell'
  | 'hasura'
  | 'hedgedoc'
  | 'helm'
  | 'hivemq'
  | 'homeassistant'
  | 'huggingface'
  | 'immich'
  | 'influxdb'
  | 'jaeger'
  | 'jellyfin'
  | 'jenkins'
  | 'jfrog'
  | 'jitsi'
  | 'joomla'
  | 'julia'
  | 'jupyter'
  | 'k3s'
  | 'keycloak'
  | 'kibana'
  | 'kong'
  | 'kubernetes'
  | 'laravel'
  | 'letsencrypt'
  | 'libreoffice'
  | 'linuxserver'
  | 'listmonk'
  | 'logstash'
  | 'mariadb'
  | 'matomo'
  | 'matrix'
  | 'mattermost'
  | 'mealie'
  | 'medusa'
  | 'meilisearch'
  | 'metabase'
  | 'milvus'
  | 'minio'
  | 'mlflow'
  | 'mongodb'
  | 'mysql'
  | 'n8n'
  | 'natsdotio'
  | 'neo4j'
  | 'netdata'
  | 'nextcloud'
  | 'nextdotjs'
  | 'nginx'
  | 'nginxproxymanager'
  | 'ngrok'
  | 'nodedotjs'
  | 'nodered'
  | 'ntfy'
  | 'odoo'
  | 'ollama'
  | 'onlyoffice'
  | 'openjdk'
  | 'openproject'
  | 'opensearch'
  | 'opensuse'
  | 'opentelemetry'
  | 'outline'
  | 'owncloud'
  | 'paperlessngx'
  | 'penpot'
  | 'perl'
  | 'php'
  | 'phpmyadmin'
  | 'pihole'
  | 'plausibleanalytics'
  | 'plex'
  | 'pocketbase'
  | 'podman'
  | 'portainer'
  | 'postgresql'
  | 'posthog'
  | 'prefect'
  | 'presto'
  | 'prometheus'
  | 'pulumi'
  | 'python'
  | 'pytorch'
  | 'qdrant'
  | 'r'
  | 'rabbitmq'
  | 'rancher'
  | 'rclone'
  | 'redash'
  | 'redhat'
  | 'redis'
  | 'redmine'
  | 'rocketdotchat'
  | 'rockylinux'
  | 'ruby'
  | 'rust'
  | 'seafile'
  | 'searxng'
  | 'selenium'
  | 'sentry'
  | 'sonatype'
  | 'strapi'
  | 'supabase'
  | 'surrealdb'
  | 'swift'
  | 'symfony'
  | 'syncthing'
  | 'tailscale'
  | 'teamcity'
  | 'temporal'
  | 'tensorflow'
  | 'terraform'
  | 'thanos'
  | 'timescale'
  | 'traefikproxy'
  | 'trino'
  | 'typo3'
  | 'ubuntu'
  | 'umami'
  | 'uptimekuma'
  | 'vault'
  | 'vaultwarden'
  | 'victoriametrics'
  | 'wireguard'
  | 'wordpress'
  | 'zulip'

/**
 * The names an image can have as its last path segment (no registry, no tag, no digest), mapped to
 * each icon. Names without a simple-icons icon (BusyBox, Memcached, Mailpit) are left out, so their
 * images get the letter tile. Generic names (server, auto-setup, documentserver) are in SCOPED instead.
 */
const ALIASES: Record<IconKey, readonly string[]> = {
  adguard: ['adguardhome'],
  adminer: ['adminer'],
  airbyte: ['airbyte'],
  almalinux: ['almalinux'],
  alpinelinux: ['alpine'],
  ansible: ['ansible'],
  apache: ['apache', 'httpd', 'zookeeper'],
  apacheairflow: ['airflow'],
  apachecassandra: ['cassandra'],
  apachecouchdb: ['couchdb'],
  apachedruid: ['druid'],
  apacheflink: ['flink'],
  apachehadoop: ['hadoop'],
  apachekafka: ['kafka'],
  apachemaven: ['maven'],
  apachenifi: ['nifi'],
  apachepulsar: ['pulsar'],
  apachesolr: ['solr'],
  apachespark: ['spark'],
  apachesuperset: ['superset'],
  apachetomcat: ['tomcat'],
  appsmith: ['appsmith-ce', 'appsmith-ee'],
  appwrite: ['appwrite'],
  archlinux: ['archlinux'],
  argo: ['argocd'],
  authelia: ['authelia'],
  authentik: [],
  baserow: ['baserow'],
  bitbucket: ['bitbucket'],
  bookstack: ['bookstack'],
  budibase: ['budibase'],
  bun: ['bun'],
  caddy: ['caddy'],
  centos: ['centos'],
  chatwoot: ['chatwoot'],
  clickhouse: ['clickhouse'],
  clojure: ['clojure'],
  cloudflare: ['cloudflared'],
  cockroachlabs: ['cockroach'],
  composer: ['composer'],
  consul: ['consul'],
  couchbase: ['couchbase', 'couchbase-server'],
  curl: ['curl'],
  debian: ['debian'],
  deno: ['deno'],
  directus: ['directus'],
  docker: ['docker', 'dind'],
  dotnet: ['dotnet', 'aspnet'],
  drupal: ['drupal'],
  duckdb: ['duckdb'],
  eclipsemosquitto: ['eclipse-mosquitto', 'mosquitto'],
  elasticsearch: ['elasticsearch', 'elastic'],
  elixir: ['elixir'],
  envoyproxy: ['envoy'],
  erlang: ['erlang'],
  erpnext: ['erpnext'],
  etcd: ['etcd'],
  excalidraw: ['excalidraw'],
  fedora: ['fedora'],
  fluentbit: ['fluent-bit'],
  fluentd: ['fluentd'],
  forgejo: ['forgejo'],
  freshrss: ['freshrss'],
  ghost: ['ghost'],
  gitea: ['gitea'],
  gitlab: ['gitlab-ce', 'gitlab-ee', 'gitlab-runner'],
  gnubash: ['bash'],
  go: ['go', 'golang'],
  gradle: ['gradle'],
  grafana: ['grafana'],
  graylog: ['graylog'],
  haproxy: ['haproxy'],
  harbor: [],
  hashicorp: [],
  haskell: ['haskell'],
  hasura: ['graphql-engine'],
  hedgedoc: ['hedgedoc'],
  helm: ['helm'],
  hivemq: ['hivemq4', 'hivemq-ce'],
  homeassistant: ['home-assistant'],
  huggingface: [],
  immich: ['immich-server', 'immich-machine-learning'],
  influxdb: ['influxdb'],
  jaeger: ['jaeger'],
  jellyfin: ['jellyfin'],
  jenkins: ['jenkins'],
  jfrog: ['artifactory-oss', 'artifactory-pro'],
  jitsi: ['jitsi'],
  joomla: ['joomla'],
  julia: ['julia'],
  jupyter: [
    'base-notebook',
    'minimal-notebook',
    'scipy-notebook',
    'datascience-notebook',
    'pyspark-notebook',
    'tensorflow-notebook',
    'r-notebook',
    'all-spark-notebook',
    'jupyterhub',
    'jupyterlab',
  ],
  k3s: ['k3s'],
  keycloak: ['keycloak'],
  kibana: ['kibana'],
  kong: ['kong', 'kong-gateway'],
  kubernetes: ['kubectl'],
  laravel: ['laravel'],
  letsencrypt: ['certbot'],
  libreoffice: ['libreoffice'],
  linuxserver: [],
  listmonk: ['listmonk'],
  logstash: ['logstash'],
  mariadb: ['mariadb'],
  matomo: ['matomo'],
  matrix: [],
  mattermost: ['mattermost', 'mattermost-team-edition', 'mattermost-enterprise-edition'],
  mealie: ['mealie'],
  medusa: ['medusa'],
  meilisearch: ['meilisearch'],
  metabase: ['metabase'],
  milvus: ['milvus'],
  minio: ['minio'],
  mlflow: ['mlflow'],
  mongodb: ['mongodb', 'mongo'],
  mysql: ['mysql'],
  n8n: ['n8n'],
  natsdotio: ['nats'],
  neo4j: ['neo4j'],
  netdata: ['netdata'],
  nextcloud: ['nextcloud'],
  nextdotjs: ['nextjs'],
  nginx: ['nginx'],
  nginxproxymanager: ['nginx-proxy-manager'],
  ngrok: ['ngrok'],
  nodedotjs: ['node', 'nodejs'],
  nodered: ['node-red'],
  ntfy: ['ntfy'],
  odoo: ['odoo'],
  ollama: ['ollama'],
  onlyoffice: [],
  openjdk: ['openjdk', 'eclipse-temurin', 'temurin'],
  openproject: ['openproject'],
  opensearch: ['opensearch', 'opensearch-dashboards'],
  opensuse: ['leap', 'tumbleweed'],
  opentelemetry: ['opentelemetry-collector', 'opentelemetry-collector-contrib', 'otel-collector'],
  outline: ['outline'],
  owncloud: ['owncloud', 'ocis'],
  paperlessngx: ['paperless-ngx'],
  penpot: ['penpot-frontend', 'penpot-backend'],
  perl: ['perl'],
  php: ['php'],
  phpmyadmin: ['phpmyadmin'],
  pihole: ['pihole'],
  plausibleanalytics: ['plausible'],
  plex: ['pms-docker', 'plex'],
  pocketbase: ['pocketbase'],
  podman: ['podman'],
  portainer: ['portainer', 'portainer-ce'],
  postgresql: ['postgres', 'postgresql', 'postgis', 'alloydbomni', 'pgadmin', 'pgadmin4'],
  posthog: ['posthog'],
  prefect: ['prefect'],
  presto: ['presto'],
  prometheus: ['prometheus'],
  pulumi: ['pulumi'],
  python: ['python'],
  pytorch: ['pytorch'],
  qdrant: ['qdrant'],
  r: ['r-base'],
  rabbitmq: ['rabbitmq'],
  rancher: ['rancher'],
  rclone: ['rclone'],
  redash: ['redash'],
  redhat: ['ubi8', 'ubi9', 'ubi10', 'ubi8-minimal', 'ubi9-minimal'],
  redis: ['redis', 'valkey'],
  redmine: ['redmine'],
  rocketdotchat: ['rocket.chat'],
  rockylinux: ['rockylinux'],
  ruby: ['ruby'],
  rust: ['rust'],
  seafile: ['seafile-mc'],
  searxng: ['searxng'],
  selenium: [],
  sentry: ['sentry'],
  sonatype: ['nexus3'],
  strapi: ['strapi'],
  supabase: [],
  surrealdb: ['surrealdb'],
  swift: ['swift'],
  symfony: ['symfony'],
  syncthing: ['syncthing'],
  tailscale: ['tailscale'],
  teamcity: ['teamcity-server', 'teamcity-agent'],
  temporal: ['temporal'],
  tensorflow: ['tensorflow'],
  terraform: ['terraform'],
  thanos: ['thanos'],
  timescale: ['timescaledb', 'timescaledb-ha'],
  traefikproxy: ['traefik'],
  trino: ['trino'],
  typo3: ['typo3'],
  ubuntu: ['ubuntu'],
  umami: ['umami'],
  uptimekuma: ['uptime-kuma'],
  vault: ['vault'],
  vaultwarden: ['vaultwarden'],
  victoriametrics: ['victoria-metrics', 'vmagent', 'vmalert', 'victoria-logs'],
  wireguard: ['wireguard'],
  wordpress: ['wordpress'],
  zulip: ['docker-zulip', 'zulip'],
}

const KEY_BY_NAME = new Map<string, IconKey>(
  (Object.keys(ALIASES) as IconKey[]).flatMap((key) => ALIASES[key].map((name): [string, IconKey] => [name, key])),
)

/** Names that match only with their namespace, as "namespace/name". */
const SCOPED: Record<string, IconKey> = {
  'goauthentik/server': 'authentik',
  'jitsi/web': 'jitsi',
  'matrixdotorg/synapse': 'matrix',
  'onlyoffice/documentserver': 'onlyoffice',
  'vaultwarden/server': 'vaultwarden',
}

/** Namespaces that name their stack when the image name does not, such as "linuxserver/openssh-server". */
const NAMESPACES: Record<string, IconKey> = {
  airbyte: 'airbyte',
  apache: 'apache',
  appsmith: 'appsmith',
  budibase: 'budibase',
  clickhouse: 'clickhouse',
  cloudflare: 'cloudflare',
  confluentinc: 'apachekafka',
  directus: 'directus',
  dotnet: 'dotnet',
  elastic: 'elasticsearch',
  getsentry: 'sentry',
  gitlab: 'gitlab',
  goharbor: 'harbor',
  grafana: 'grafana',
  hashicorp: 'hashicorp',
  hasura: 'hasura',
  huggingface: 'huggingface',
  'immich-app': 'immich',
  jaegertracing: 'jaeger',
  jenkins: 'jenkins',
  jupyter: 'jupyter',
  linuxserver: 'linuxserver',
  mattermost: 'mattermost',
  milvusdb: 'milvus',
  minio: 'minio',
  n8nio: 'n8n',
  ollama: 'ollama',
  opensearchproject: 'opensearch',
  opensuse: 'opensuse',
  otel: 'opentelemetry',
  'paperless-ngx': 'paperlessngx',
  penpot: 'penpot',
  portainer: 'portainer',
  prefecthq: 'prefect',
  prom: 'prometheus',
  pytorch: 'pytorch',
  rancher: 'rancher',
  selenium: 'selenium',
  strapi: 'strapi',
  supabase: 'supabase',
  tailscale: 'tailscale',
  temporalio: 'temporal',
  tensorflow: 'tensorflow',
}

/** The icon of a bare name such as "postgres" or "node", or null when no alias has it. */
export function iconKeyForName(name: string): IconKey | null {
  return KEY_BY_NAME.get(name) ?? null
}

/** The value of an own key of a table. A plain object also has names such as "constructor", which are not icons. */
function ownKey(table: Readonly<Record<string, IconKey>>, key: string): IconKey | null {
  return Object.hasOwn(table, key) ? (table[key] ?? null) : null
}

/**
 * The reference without its digest and tag, in lower case: "docker.io/library/nginx:1.27" gives
 * "docker.io/library/nginx".
 */
function repositoryPath(reference: string): string {
  const withoutDigest = reference.trim().split('@')[0] ?? ''
  const slash = withoutDigest.lastIndexOf('/')
  const colon = withoutDigest.lastIndexOf(':')
  // A colon after the last slash starts the tag. A colon before it is a registry port.
  const repository = colon > slash ? withoutDigest.slice(0, colon) : withoutDigest
  return repository.toLowerCase()
}

/**
 * The name an image is matched by: the last path segment, lower case, with no registry, tag or digest.
 * "docker.io/library/nginx:1.27" gives "nginx", "bitnami/redis@sha256:..." gives "redis".
 */
export function repositoryName(reference: string): string {
  const path = repositoryPath(reference)
  return path.slice(path.lastIndexOf('/') + 1)
}

/**
 * The namespace of an image: the segment before its name, with the registry host dropped. Empty when there
 * is none. "mcr.microsoft.com/dotnet/sdk" gives "dotnet", "lscr.io/linuxserver/openssh-server" gives
 * "linuxserver", "nginx" gives "".
 */
export function namespaceName(reference: string): string {
  const parts = repositoryPath(reference).split('/')
  // The first part is a registry host when it has a dot or a port, or is "localhost".
  const first = parts[0] ?? ''
  if (parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost')) parts.shift()
  return parts.length > 1 ? (parts[parts.length - 2] ?? '') : ''
}

/**
 * The brand icon of an image reference, or null when no icon is known for it. The "namespace/name" pair comes
 * first, then the name alone, then the namespace alone.
 */
export function imageIconKey(reference: string): IconKey | null {
  const name = repositoryName(reference)
  const namespace = namespaceName(reference)
  return ownKey(SCOPED, `${namespace}/${name}`) ?? iconKeyForName(name) ?? ownKey(NAMESPACES, namespace)
}

/** The letter of a tile without a brand icon: the first letter or digit of the name, upper case. "?" when there is none. */
export function imageInitial(reference: string): string {
  if (reference.startsWith('sha256:')) return '?'
  const name = repositoryName(reference)
  if (!/^[a-z0-9]/.test(name)) return '?'
  return (name[0] ?? '?').toUpperCase()
}

/** The surfaces a brand color is judged against: the white card in light mode, the dark card in dark mode. */
export const SURFACE = { light: '#ffffff', dark: '#1a1a1a' } as const

/** The lowest contrast a logo may have on its surface. 3:1 is the WCAG minimum for graphics. */
export const MIN_LOGO_CONTRAST = 3

/** The WCAG relative luminance of a hex color such as "4169E1" or "#4169e1". */
export function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  const channel = (shift: number) => {
    const c = ((value >> shift) & 0xff) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
}

/** The WCAG contrast ratio of two hex colors, from 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/** True when the brand color is clear enough on the surface of the theme. When false, the logo uses the foreground color. */
export function brandReadsOn(hex: string, theme: keyof typeof SURFACE): boolean {
  return contrastRatio(hex, SURFACE[theme]) >= MIN_LOGO_CONTRAST
}
