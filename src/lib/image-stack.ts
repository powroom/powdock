// Pure helpers: which brand icon an image gets from its image config (the start command, the version
// variables it inherits from its base image, and the base image label), from its tag words, or from its
// history. The name mapping in image-icon.ts runs first in the UI; these cover the custom images whose
// names say nothing about their stack. No React and no Docker here, so the tests use plain fixtures.

import { iconKeyForName, imageIconKey, repositoryName, type IconKey } from './image-icon'

/** The part of an image config the detector reads. Docker's Config fields, already defaulted. */
export interface StackConfig {
  /** "NAME=value" lines */
  env: readonly string[]
  entrypoint: readonly string[] | null
  cmd: readonly string[] | null
  labels: Readonly<Record<string, string>>
}

/** The label that names the base image of an image (set by most Dockerfile builds). */
export const BASE_NAME_LABEL = 'org.opencontainers.image.base.name'

/**
 * Start command words, in priority order: the first rule with a word in the command wins. A word matches
 * as a whole, or as the end of a name when it starts with a dot (".jar"). Words of generic wrappers
 * (entrypoint, supervisord, sh, bash, tini and so on) are in no rule, so the next check decides.
 */
const COMMAND_RULES: readonly (readonly [readonly string[], IconKey])[] = [
  [['artisan', 'octane'], 'laravel'],
  [['php-fpm', 'php', 'frankenphp'], 'php'],
  [['next'], 'nextdotjs'],
  [['node', 'npm', 'pnpm', 'yarn', 'npx', 'nest'], 'nodedotjs'],
  [['bun'], 'bun'],
  [['deno'], 'deno'],
  [['uvicorn', 'gunicorn', 'python', 'python3', 'flask', 'django-admin', 'manage.py'], 'python'],
  [['java', '.jar'], 'openjdk'],
  [['dotnet'], 'dotnet'],
  [['rails', 'puma', 'ruby', 'bundle'], 'ruby'],
  [['nginx'], 'nginx'],
  [['caddy'], 'caddy'],
  [['mix', 'elixir'], 'elixir'],
  [['mariadbd'], 'mariadb'],
  [['mysqld'], 'mysql'],
  [['postgres', 'pgbouncer'], 'postgresql'],
  [['redis-server'], 'redis'],
  [['mongod'], 'mongodb'],
  [['grafana', 'grafana-server'], 'grafana'],
  [['prometheus'], 'prometheus'],
  [['haproxy'], 'haproxy'],
  [['traefik'], 'traefikproxy'],
  [['curl'], 'curl'],
  [['soffice', 'libreoffice'], 'libreoffice'],
  [['mvn'], 'apachemaven'],
  [['gradle'], 'gradle'],
  [['vault'], 'vault'],
  [['consul'], 'consul'],
]

/**
 * Version variables that official base images set, in priority order. PHP comes first: a Laravel image
 * often also has Node for its asset build, and it is a PHP app.
 */
const VERSION_ENV_RULES: readonly (readonly [readonly string[], IconKey])[] = [
  [['PHP_VERSION'], 'php'],
  [['NODE_VERSION'], 'nodedotjs'],
  [['PYTHON_VERSION'], 'python'],
  [['GOLANG_VERSION', 'GO_VERSION'], 'go'],
  [['JAVA_VERSION'], 'openjdk'],
  [['RUBY_VERSION'], 'ruby'],
  [['BUN_VERSION'], 'bun'],
  [['DENO_VERSION'], 'deno'],
  [['DOTNET_VERSION', 'ASPNET_VERSION'], 'dotnet'],
  [['NGINX_VERSION'], 'nginx'],
  [['CADDY_VERSION'], 'caddy'],
  [['ELIXIR_VERSION'], 'elixir'],
  [['RUST_VERSION'], 'rust'],
  [['GRAFANA_VERSION'], 'grafana'],
  [['PERL_VERSION'], 'perl'],
  [['ERLANG_VERSION', 'OTP_VERSION'], 'erlang'],
  [['JULIA_VERSION'], 'julia'],
  [['MAVEN_VERSION'], 'apachemaven'],
  [['GRADLE_VERSION'], 'gradle'],
]

/**
 * The words of the start command: every argument of the entrypoint and the command, split at spaces and
 * shell separators, then reduced to the lower-case basename ("/usr/bin/php" gives "php").
 * A shell script given as one argument ("php-fpm && nginx") yields all its words.
 */
export function commandWords(entrypoint: readonly string[] | null, cmd: readonly string[] | null): string[] {
  const args = [...(entrypoint ?? []), ...(cmd ?? [])]
  return args
    .flatMap((arg) => arg.split(/[\s;&|()<>'"`=:]+/))
    .map((word) => word.slice(word.lastIndexOf('/') + 1).toLowerCase())
    .filter((word) => word !== '')
}

function wordMatches(word: string, term: string): boolean {
  return term.startsWith('.') ? word.endsWith(term) : word === term
}

/** The icon of the start command, or null when no word of it names a stack. */
export function stackFromCommand(entrypoint: readonly string[] | null, cmd: readonly string[] | null): IconKey | null {
  const words = commandWords(entrypoint, cmd)
  for (const [terms, key] of COMMAND_RULES) {
    if (words.some((word) => terms.some((term) => wordMatches(word, term)))) return key
  }
  return null
}

/** The icon of the first version variable the image sets to a value, or null. */
export function stackFromEnv(env: readonly string[]): IconKey | null {
  const values = new Map<string, string>()
  for (const line of env) {
    const index = line.indexOf('=')
    if (index > 0) values.set(line.slice(0, index), line.slice(index + 1).trim())
  }
  for (const [names, key] of VERSION_ENV_RULES) {
    if (names.some((name) => (values.get(name) ?? '') !== '')) return key
  }
  return null
}

/**
 * The icon key of an image's stack, or null when the config does not tell (then the letter tile stays).
 * The start command wins, then the inherited version variables, then the base image label.
 */
export function detectStack(config: StackConfig): IconKey | null {
  return (
    stackFromCommand(config.entrypoint, config.cmd) ??
    stackFromEnv(config.env) ??
    imageIconKey(config.labels[BASE_NAME_LABEL] ?? '')
  )
}

/**
 * The icon of the first word of a tag that names a stack: "jobdesk-libreoffice:latest" gives libreoffice and
 * "cp-kafka" gives apachekafka. Words are split at "-", "_" and "."; words under three letters are skipped.
 */
export function stackFromTags(tags: readonly string[]): IconKey | null {
  for (const tag of tags) {
    for (const word of repositoryName(tag).split(/[-_.]/)) {
      const key = word.length >= 3 ? iconKeyForName(word) : null
      if (key) return key
    }
  }
  return null
}

/** The base OS names found in history lines, in the order they are checked. "os_release_debian" contains "debian". */
const BASE_OS_RULES: readonly (readonly [string, IconKey])[] = [
  ['alpine-minirootfs', 'alpinelinux'],
  ['debian', 'debian'],
  ['ubuntu', 'ubuntu'],
  ['rockylinux', 'rockylinux'],
  ['almalinux', 'almalinux'],
  ['centos', 'centos'],
  ['fedora', 'fedora'],
]

/**
 * The base OS of an image, from its history lines (`CreatedBy`, newest first as Docker lists them). The base
 * layer is the oldest line, so the lines are read from the end. A compiled binary copied from a builder stage
 * leaves no other trace of its OS.
 */
export function baseOsFromHistory(createdBy: readonly string[]): IconKey | null {
  for (const line of [...createdBy].reverse()) {
    const rule = BASE_OS_RULES.find(([term]) => line.includes(term))
    if (rule) return rule[1]
  }
  return null
}

/** The sorted, unique ids, so the same set of images always makes the same query key. Empty ids are dropped. */
export function uniqueSortedIds(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => id !== ''))].sort()
}
