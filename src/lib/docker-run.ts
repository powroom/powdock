import { emitYaml, type YamlNode } from './yaml-emit'

// Turns a `docker run` command into a Compose file. Pure: no I/O, so the tests use plain strings.
// The tokenizer reads shell words (quotes, backslash escapes, line continuations). It is not a shell:
// nothing is expanded, and operators such as | and && are refused. Flags that do not map to Compose
// are listed, never guessed at.

export interface RunConversion {
  /** the Compose file text (empty when the command could not be read) */
  yaml: string
  /** the service name, or null when the command could not be read */
  service: string | null
  /** the flags that were left out, in the order they came */
  notConverted: string[]
  /** why the command could not be read, or null */
  error: string | null
}

/** Shell words of one command. Throws a message a person can act on. */
export function tokenize(text: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inToken = false
  let i = 0
  while (i < text.length) {
    const ch = text[i]!
    if (ch === "'") {
      const end = text.indexOf("'", i + 1)
      if (end < 0) throw new Error('A single quote is not closed.')
      current += text.slice(i + 1, end)
      inToken = true
      i = end + 1
    } else if (ch === '"') {
      inToken = true
      i += 1
      let closed = false
      while (i < text.length) {
        const c = text[i]!
        if (c === '"') {
          closed = true
          i += 1
          break
        }
        if (c === '\\' && i + 1 < text.length) {
          const next = text[i + 1]!
          if (next === '\n') {
            i += 2
            continue
          }
          if ('"\\$`'.includes(next)) {
            current += next
            i += 2
            continue
          }
        }
        current += c
        i += 1
      }
      if (!closed) throw new Error('A double quote is not closed.')
    } else if (ch === '\\') {
      if (text.startsWith('\r\n', i + 1)) {
        i += 3
      } else if (text[i + 1] === '\n') {
        i += 2
      } else if (i + 1 < text.length) {
        current += text[i + 1]
        inToken = true
        i += 2
      } else {
        i += 1
      }
    } else if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      if (inToken) tokens.push(current)
      current = ''
      inToken = false
      i += 1
    } else if ('|&;<>()'.includes(ch)) {
      throw new Error(`The shell operator ${ch} is not supported. Paste one docker run command.`)
    } else {
      current += ch
      inToken = true
      i += 1
    }
  }
  if (inToken) tokens.push(current)
  return tokens
}

/** Long flags with a value that map to a Compose key. The key is the canonical name used below. */
const LONG_VALUE: Record<string, string> = {
  name: 'name',
  publish: 'publish',
  env: 'env',
  'env-file': 'env-file',
  volume: 'volume',
  mount: 'mount',
  network: 'network',
  net: 'network',
  restart: 'restart',
  workdir: 'workdir',
  user: 'user',
  entrypoint: 'entrypoint',
  hostname: 'hostname',
  cpus: 'cpus',
  memory: 'memory',
  label: 'label',
  'add-host': 'add-host',
  'health-cmd': 'health-cmd',
  'health-interval': 'health-interval',
  'health-timeout': 'health-timeout',
  'health-retries': 'health-retries',
  'cap-add': 'cap-add',
  device: 'device',
  gpus: 'gpus',
  'shm-size': 'shm-size',
  ulimit: 'ulimit',
  pull: 'pull',
  platform: 'platform',
}

/** Flags that take a value and have no Compose mapping here. They are consumed and listed. */
const LONG_VALUE_UNSUPPORTED = new Set([
  'log-driver',
  'log-opt',
  'cap-drop',
  'security-opt',
  'memory-swap',
  'stop-signal',
  'stop-timeout',
  'ip',
  'ip6',
  'dns',
  'dns-search',
  'dns-option',
  'expose',
  'tmpfs',
  'runtime',
  'pid',
  'ipc',
  'uts',
  'userns',
  'cgroupns',
  'sysctl',
  'group-add',
  'annotation',
  'storage-opt',
  'isolation',
  'mac-address',
  'link',
  'cpu-shares',
  'cpuset-cpus',
  'attach',
  'health-start-period',
])

/** Long flags without a value. `detach` and `rm` are dropped on purpose (see below). */
const LONG_BOOL = new Set(['detach', 'rm', 'interactive', 'tty', 'privileged'])

/** Short flags with a value, by letter. */
const SHORT_VALUE: Record<string, string> = {
  p: 'publish',
  e: 'env',
  v: 'volume',
  w: 'workdir',
  u: 'user',
  h: 'hostname',
  l: 'label',
  m: 'memory',
}
const SHORT_VALUE_UNSUPPORTED = new Set(['a', 'c'])
const SHORT_BOOL = new Set(['d', 'i', 't'])

/** Compose keys in the order a service is written. Keys not listed go last. */
const SERVICE_ORDER = [
  'image',
  'container_name',
  'command',
  'entrypoint',
  'working_dir',
  'user',
  'hostname',
  'restart',
  'platform',
  'pull_policy',
  'ports',
  'environment',
  'env_file',
  'volumes',
  'networks',
  'network_mode',
  'labels',
  'extra_hosts',
  'healthcheck',
  'privileged',
  'cap_add',
  'devices',
  'deploy',
  'shm_size',
  'ulimits',
  'stdin_open',
  'tty',
  'cpus',
  'mem_limit',
]

/** A Docker container name as Docker accepts it. */
const CONTAINER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/
/** A volume name in a -v or --mount: a name, not a path. */
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/

interface Opt {
  key: string
  value: string | true
}

/** The Compose service name a docker run gets when it has no --name: the image name without registry, tag or digest. */
export function serviceFromImage(image: string): string {
  const noDigest = image.split('@')[0] ?? image
  const lastSlash = noDigest.lastIndexOf('/')
  const withTag = lastSlash >= 0 ? noDigest.slice(lastSlash + 1) : noDigest
  const colon = withTag.indexOf(':')
  const base = colon >= 0 ? withTag.slice(0, colon) : withTag
  const cleaned = base
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, '-')
    .replace(/^[^a-z0-9]+/, '')
  return cleaned || 'app'
}

/** Splits the flags from the image and the command. Throws for a command that cannot be read. */
function readArguments(tokens: string[]): { opts: Opt[]; notConverted: string[]; image: string; command: string[] } {
  let i = 0
  if (tokens[0] === 'docker' && tokens[1] === 'container' && tokens[2] === 'run') i = 3
  else if (tokens[0] === 'docker' && tokens[1] === 'run') i = 2
  else if (tokens[0] === 'docker') throw new Error('Paste a docker run command, for example docker run -d nginx:1.27.')
  const opts: Opt[] = []
  const notConverted: string[] = []
  while (i < tokens.length) {
    const token = tokens[i]!
    if (token === '--') {
      i += 1
      break
    }
    if (token.startsWith('--')) {
      const eq = token.indexOf('=')
      const name = eq > 0 ? token.slice(2, eq) : token.slice(2)
      const inline = eq > 0 ? token.slice(eq + 1) : null
      if (Object.hasOwn(LONG_VALUE, name) || LONG_VALUE_UNSUPPORTED.has(name)) {
        let value = inline
        if (value === null) {
          if (i + 1 >= tokens.length) throw new Error(`The flag --${name} needs a value.`)
          i += 1
          value = tokens[i]!
        }
        if (Object.hasOwn(LONG_VALUE, name)) opts.push({ key: LONG_VALUE[name]!, value })
        else notConverted.push(`--${name}`)
      } else if (LONG_BOOL.has(name)) {
        if (name === 'interactive') opts.push({ key: 'interactive', value: true })
        else if (name === 'tty') opts.push({ key: 'tty', value: true })
        else if (name === 'privileged') opts.push({ key: 'privileged', value: true })
        else if (name === 'rm') opts.push({ key: 'rm', value: true })
      } else {
        notConverted.push(`--${name}`)
      }
      i += 1
      continue
    }
    if (token.startsWith('-') && token.length > 1) {
      let j = 1
      while (j < token.length) {
        const letter = token[j]!
        if (Object.hasOwn(SHORT_VALUE, letter) || SHORT_VALUE_UNSUPPORTED.has(letter)) {
          let value = token.slice(j + 1)
          if (value === '') {
            if (i + 1 >= tokens.length) throw new Error(`The flag -${letter} needs a value.`)
            i += 1
            value = tokens[i]!
          }
          if (Object.hasOwn(SHORT_VALUE, letter)) opts.push({ key: SHORT_VALUE[letter]!, value })
          else notConverted.push(`-${letter}`)
          break
        }
        if (letter === 'i') opts.push({ key: 'interactive', value: true })
        else if (letter === 't') opts.push({ key: 'tty', value: true })
        else if (!SHORT_BOOL.has(letter)) notConverted.push(`-${letter}`)
        j += 1
      }
      i += 1
      continue
    }
    break
  }
  const image = tokens[i]
  if (image === undefined) throw new Error('No image name found. Add the image, for example nginx:1.27.')
  return { opts, notConverted, image, command: tokens.slice(i + 1) }
}

/** The volume entry of `-v`: a bind mount, a named volume, or an anonymous volume (a path only). */
function volumeEntry(value: string, named: Set<string>): string {
  const parts = value.split(':')
  if (parts.length === 1) return value
  const [source, target, ...mode] = parts
  const suffix = mode.length > 0 ? `:${mode.join(':')}` : ''
  if (VOLUME_NAME.test(source!)) named.add(source!)
  return `${source}:${target}${suffix}`
}

/** A --mount value (type=bind,source=...,target=...,readonly) as the long Compose form, or null when it is not supported. */
function mountEntry(value: string, named: Set<string>): YamlNode | null {
  const fields: Record<string, string | true> = {}
  for (const part of value.split(',')) {
    const eq = part.indexOf('=')
    if (eq < 0) {
      if (part === 'readonly' || part === 'ro') fields.readonly = true
      else return null
    } else {
      fields[part.slice(0, eq)] = part.slice(eq + 1)
    }
  }
  const type = fields.type ?? 'volume'
  const source = fields.source ?? fields.src
  const target = fields.target ?? fields.dst ?? fields.destination
  if (typeof target !== 'string') return null
  if (type !== 'bind' && type !== 'volume' && type !== 'tmpfs') return null
  const entry: { [key: string]: YamlNode } = { type, target }
  if (type !== 'tmpfs') {
    if (typeof source !== 'string') return null
    entry.source = source
    if (type === 'volume') named.add(source)
  }
  if (fields.readonly !== undefined || fields.ro !== undefined) entry.read_only = true
  return entry
}

/** Converts a `docker run` command. Never throws: a command that cannot be read gives `error`. */
export function convertDockerRun(command: string): RunConversion {
  const empty = { yaml: '', service: null, notConverted: [] as string[] }
  let parsed: ReturnType<typeof readArguments>
  try {
    parsed = readArguments(tokenize(command))
  } catch (err) {
    return { ...empty, error: err instanceof Error ? err.message : 'The command could not be read.' }
  }
  const { opts, image, command: args } = parsed
  const notConverted = [...parsed.notConverted]
  const service: { [key: string]: YamlNode } = { image }
  const named = new Set<string>()
  const topNetworks: { [key: string]: YamlNode } = {}
  const ports: string[] = []
  const environment: string[] = []
  const envFile: string[] = []
  const volumes: YamlNode[] = []
  const labels: string[] = []
  const extraHosts: string[] = []
  const capAdd: string[] = []
  const devices: string[] = []
  const ulimits: { [key: string]: YamlNode } = {}
  const healthcheck: { [key: string]: YamlNode } = {}
  let containerName: string | null = null
  let rm = false

  for (const opt of opts) {
    const value = opt.value
    const text = typeof value === 'string' ? value : ''
    switch (opt.key) {
      case 'name':
        if (CONTAINER_NAME.test(text)) containerName = text
        else notConverted.push(`--name ${text} (not a valid container name)`)
        break
      case 'publish':
        ports.push(text)
        break
      case 'env':
        environment.push(text)
        break
      case 'env-file':
        envFile.push(text)
        break
      case 'volume':
        volumes.push(volumeEntry(text, named))
        break
      case 'mount': {
        const entry = mountEntry(text, named)
        if (entry) volumes.push(entry)
        else notConverted.push(`--mount ${text}`)
        break
      }
      case 'network': {
        if (text === 'host' || text === 'none' || text === 'bridge' || text.startsWith('container:')) {
          service.network_mode = text
        } else {
          service.networks = [...((service.networks as YamlNode[] | undefined) ?? []), text]
          topNetworks[text] = { external: true }
        }
        break
      }
      case 'restart':
        service.restart = text
        break
      case 'workdir':
        service.working_dir = text
        break
      case 'user':
        service.user = text
        break
      case 'entrypoint':
        service.entrypoint = text
        break
      case 'hostname':
        service.hostname = text
        break
      case 'cpus':
        service.cpus = text
        break
      case 'memory':
        service.mem_limit = text
        break
      case 'label':
        labels.push(text)
        break
      case 'add-host':
        extraHosts.push(text)
        break
      case 'health-cmd':
        healthcheck.test = ['CMD-SHELL', text]
        break
      case 'health-interval':
        healthcheck.interval = text
        break
      case 'health-timeout':
        healthcheck.timeout = text
        break
      case 'health-retries':
        if (/^\d+$/.test(text)) healthcheck.retries = Number(text)
        else notConverted.push(`--health-retries ${text} (not a number)`)
        break
      case 'cap-add':
        capAdd.push(text)
        break
      case 'device':
        devices.push(text)
        break
      case 'gpus':
        if (text === 'all' || /^\d+$/.test(text)) {
          service.deploy = {
            resources: {
              reservations: {
                devices: [{ driver: 'nvidia', count: text === 'all' ? 'all' : Number(text), capabilities: ['gpu'] }],
              },
            },
          }
        } else {
          notConverted.push(`--gpus ${text}`)
        }
        break
      case 'shm-size':
        service.shm_size = text
        break
      case 'ulimit': {
        const eq = text.indexOf('=')
        const limits = eq >= 0 ? text.slice(eq + 1).split(':') : []
        const ulimitName = eq >= 0 ? text.slice(0, eq) : ''
        if (ulimitName && limits.length === 1 && /^\d+$/.test(limits[0]!)) {
          ulimits[ulimitName] = Number(limits[0])
        } else if (ulimitName && limits.length === 2 && limits.every((item) => /^\d+$/.test(item))) {
          ulimits[ulimitName] = { soft: Number(limits[0]), hard: Number(limits[1]) }
        } else {
          notConverted.push(`--ulimit ${text}`)
        }
        break
      }
      case 'pull':
        service.pull_policy = text
        break
      case 'platform':
        service.platform = text
        break
      case 'interactive':
        service.stdin_open = true
        break
      case 'tty':
        service.tty = true
        break
      case 'privileged':
        service.privileged = true
        break
      case 'rm':
        rm = true
        break
      default:
        break
    }
  }

  if (containerName !== null) service.container_name = containerName
  if (ports.length) service.ports = ports
  if (environment.length) service.environment = environment
  if (envFile.length) service.env_file = envFile
  if (volumes.length) service.volumes = volumes
  if (labels.length) service.labels = labels
  if (extraHosts.length) service.extra_hosts = extraHosts
  if (Object.keys(healthcheck).length) service.healthcheck = healthcheck
  if (capAdd.length) service.cap_add = capAdd
  if (devices.length) service.devices = devices
  if (Object.keys(ulimits).length) service.ulimits = ulimits
  if (args.length) service.command = args

  const serviceName = containerName ?? serviceFromImage(image)
  const ordered: { [key: string]: YamlNode } = {}
  for (const key of SERVICE_ORDER) if (key in service) ordered[key] = service[key]!
  for (const key of Object.keys(service)) if (!(key in ordered)) ordered[key] = service[key]!

  const doc: { [key: string]: YamlNode } = { services: { [serviceName]: ordered } }
  if (named.size) doc.volumes = Object.fromEntries([...named].map((volume) => [volume, {}]))
  if (Object.keys(topNetworks).length) doc.networks = topNetworks

  const header: string[] = []
  if (notConverted.length) header.push(`not converted: ${notConverted.join(', ')}`)
  if (rm) header.push('--rm was not set. Use docker compose down to remove the containers.')
  return {
    yaml: emitYaml(doc, header),
    service: serviceName,
    notConverted,
    error: null,
  }
}
