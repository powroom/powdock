// Code behind the `powdock` command (npx powdock, bunx powdock). See bin/powdock.mjs.
//
// Runs on Node.js 18 or newer and on Bun, with no dependencies. pow/dock's server needs Bun, so the
// launcher finds Bun 1.4.4 or newer (or offers to install it into ~/.powdock/runtime), then runs
// start.js with it.
// Importing this module does nothing: main() does the work.

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { constants as osConstants, homedir } from 'node:os'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const MIN_BUN_VERSION = '1.4.4'
const DEFAULT_PORT = 3434
const DEFAULT_HOST = '127.0.0.1'

const PACKAGE_DIR = fileURLToPath(new URL('..', import.meta.url))
const SERVER_WAIT_MS = 15000
const SERVER_POLL_MS = 300
const BUN_OS = new Map([
  ['linux', 'linux'],
  ['darwin', 'darwin'],
  ['win32', 'windows'],
])
const BUN_CPU = new Map([
  ['x64', 'x64'],
  ['arm64', 'aarch64'],
])
const SERVE_VALUE_FLAGS = new Set(['--port', '--host', '--data-dir'])
const REGISTRY_LATEST_URL = 'https://registry.npmjs.org/powdock/latest'
const REGISTRY_TIMEOUT_MS = 3000

// ---- small helpers ----------------------------------------------------------------------------

/** Path functions for the platform the paths belong to, so Windows paths can be tested anywhere. */
function pathsFor(platform) {
  return platform === 'win32' ? path.win32 : path.posix
}

function exeName(name, platform) {
  return platform === 'win32' ? `${name}.exe` : name
}

/** The value when it has text in it, otherwise undefined. An empty environment variable counts as unset. */
function nonEmpty(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined
}

function pathEnvOf(env) {
  return env.PATH ?? env.Path ?? ''
}

function usageError(message) {
  return { mode: 'error', message }
}

// ---- versions and ports -----------------------------------------------------------------------

/** "1.4.4", "v1.4.4" or "1.4.4-canary" as [1, 4, 4]. Null when the text does not start with a version. */
function parseVersion(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(String(text ?? '').trim())
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

/** -1, 0 or 1 when a is older, equal or newer than b. Null when either one is not a version. */
export function compareVersions(a, b) {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++) {
    if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1
  }
  return 0
}

export function isSupportedBun(version) {
  const order = compareVersions(version, MIN_BUN_VERSION)
  return order !== null && order >= 0
}

/** A port from a flag: a whole number from 1 to 65535, otherwise null. */
export function parsePortFlag(value) {
  const text = String(value ?? '').trim()
  if (!/^\d+$/.test(text)) return null
  const port = Number(text)
  return port >= 1 && port <= 65535 ? port : null
}

// ---- command line -----------------------------------------------------------------------------

/**
 * Reads the command line. Returns one of:
 *   { mode: 'serve', options }  start the server: no command, or "start"
 *   { mode: 'help' }            powdock --help
 *   { mode: 'version' }         powdock --version
 *   { mode: 'error', message }  a bad command, flag or value
 */
export function parseArgs(argv) {
  if (argv.length > 0 && !argv[0].startsWith('-')) {
    if (argv[0] === 'start') return parseServeArgs(argv.slice(1))
    return usageError(`Unknown command "${argv[0]}". Run "powdock --help" to see the options.`)
  }
  return parseServeArgs(argv)
}

function parseServeArgs(argv) {
  const options = { port: undefined, host: undefined, dataDir: undefined, open: true, yes: false }
  let help = false
  let version = false
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    const equals = arg.startsWith('--') ? arg.indexOf('=') : -1
    const name = equals > 0 ? arg.slice(0, equals) : arg
    let value = equals > 0 ? arg.slice(equals + 1) : undefined
    if (name === '-h' || name === '--help') help = true
    else if (name === '-v' || name === '--version') version = true
    else if (name === '--no-open') options.open = false
    else if (name === '-y' || name === '--yes') options.yes = true
    else if (SERVE_VALUE_FLAGS.has(name)) {
      if (value === undefined) {
        value = argv[i + 1]
        if (value === undefined || value.startsWith('-')) return usageError(`${name} needs a value.`)
        i++
      }
      if (name === '--port') {
        options.port = parsePortFlag(value)
        if (options.port === null) return usageError('--port must be a whole number from 1 to 65535.')
      } else if (value.trim() === '') {
        return usageError(`${name} needs a value.`)
      } else if (name === '--host') {
        options.host = value.trim()
      } else {
        options.dataDir = value
      }
    } else {
      return usageError(`Unknown option "${arg}". Run "powdock --help" to see the options.`)
    }
  }
  if (help) return { mode: 'help' }
  if (version) return { mode: 'version' }
  return { mode: 'serve', options }
}

// ---- folders ----------------------------------------------------------------------------------

/** The data folder: --data-dir, else POWDOCK_DATA_DIR, else ~/.powdock. Always an absolute path. */
export function resolveDataDir({ flag, env, homeDir, platform }) {
  const p = pathsFor(platform)
  const chosen = nonEmpty(flag) ?? nonEmpty(env.POWDOCK_DATA_DIR)
  if (chosen === undefined) return p.join(homeDir, '.powdock')
  let expanded = chosen
  if (chosen === '~') expanded = homeDir
  else if (/^~[\\/]/.test(chosen)) expanded = p.join(homeDir, chosen.slice(2))
  return p.resolve(expanded)
}

/** Where a private copy of Bun is installed. It lives under ~/.powdock even when the data folder moves. */
export function runtimeDirFor(homeDir, platform) {
  return pathsFor(platform).join(homeDir, '.powdock', 'runtime')
}

/** Settings for starting the server. Flags win over environment variables, which win over defaults. */
export function serveSettings({ options, env, homeDir, platform }) {
  return {
    port: options.port !== undefined ? String(options.port) : (nonEmpty(env.PORT) ?? String(DEFAULT_PORT)),
    host: options.host ?? nonEmpty(env.HOST) ?? DEFAULT_HOST,
    dataDir: resolveDataDir({ flag: options.dataDir, env, homeDir, platform }),
    open: options.open,
    yes: options.yes,
  }
}

export function childEnv(baseEnv, settings) {
  return {
    ...baseEnv,
    PORT: settings.port,
    HOST: settings.host,
    POWDOCK_DATA_DIR: settings.dataDir,
    POWDOCK_INSTALL: 'npm',
  }
}

/** False when POWDOCK_UPDATE_CHECK is off, false or 0. The update check is on otherwise. */
export function updateCheckOn(env) {
  const value = String(env.POWDOCK_UPDATE_CHECK ?? '')
    .trim()
    .toLowerCase()
  return value !== 'off' && value !== 'false' && value !== '0'
}

/** The line to print when latest is a newer version than current, or null (also when either is not a version). */
export function updateNotice(current, latest) {
  if (compareVersions(latest, current) !== 1) return null
  return `pow/dock ${latest} is available (you have ${current}). Stop pow/dock and run: npx powdock@latest`
}

/**
 * The newest version on the npm registry, or null. Makes no request when the update check is off.
 * Never throws: a timeout or a bad answer is just null.
 */
export async function latestRegistryVersion({ env, fetchImpl = globalThis.fetch }) {
  if (!updateCheckOn(env)) return null
  try {
    const response = await fetchImpl(REGISTRY_LATEST_URL, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    })
    if (!response.ok) return null
    const data = await response.json()
    return typeof data?.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

/** The address a browser should open for a server bound to host and port. */
export function serverUrl(host, port) {
  let name = host
  if (name === '0.0.0.0' || name === '') name = '127.0.0.1'
  else if (name === '::') name = '::1'
  if (name.includes(':') && !name.startsWith('[')) name = `[${name}]`
  return `http://${name}:${port}/`
}

// ---- finding Bun ------------------------------------------------------------------------------

/** Every file called `command` in the PATH folders, in PATH order. `isFile` is injected for tests. */
export function findAllOnPath(command, { pathValue, platform, isFile }) {
  const p = pathsFor(platform)
  const file = exeName(command, platform)
  const separator = platform === 'win32' ? ';' : ':'
  const found = []
  for (const entry of String(pathValue ?? '').split(separator)) {
    const dir = entry.trim().replace(/^"(.*)"$/, '$1')
    if (dir === '') continue
    const candidate = p.join(dir, file)
    if (!found.includes(candidate) && isFile(candidate)) found.push(candidate)
  }
  return found
}

/**
 * Places where the npm `bun` package, installed into the runtime folder, keeps its binary: the
 * package's own bin folder (its install script puts the real binary there), the npm .bin shim, or
 * the platform package @oven/bun-<os>-<cpu>.
 */
export function privateBunCandidates({ runtimeDir, platform, arch }) {
  const p = pathsFor(platform)
  const modules = p.join(runtimeDir, 'node_modules')
  const exe = exeName('bun', platform)
  const candidates = [p.join(modules, 'bun', 'bin', exe)]
  if (platform !== 'win32') candidates.push(p.join(modules, '.bin', 'bun'))
  const os = BUN_OS.get(platform)
  const cpu = BUN_CPU.get(arch)
  if (os && cpu) candidates.push(p.join(modules, '@oven', `bun-${os}-${cpu}`, 'bin', exe))
  return candidates
}

/**
 * Picks the Bun that runs the server. Order: the Bun running this launcher, then bun on PATH,
 * then the private copy in ~/.powdock/runtime. The first one that reports 1.4.4 or newer wins.
 * `probe.isFile(file)` and `probe.versionOf(bin)` (null when the file does not run) are injected.
 * Returns { bin, version, source, old }, where old lists the copies that were found but are too old
 * or do not run.
 */
export function findBun({ env, platform, arch, homeDir, execPath, runningVersion, probe }) {
  const candidates = []
  if (runningVersion) candidates.push({ bin: execPath, source: 'runtime', version: runningVersion })
  const onPath = findAllOnPath('bun', { pathValue: pathEnvOf(env), platform, isFile: probe.isFile })
  for (const bin of onPath) candidates.push({ bin, source: 'path' })
  for (const bin of privateBunCandidates({ runtimeDir: runtimeDirFor(homeDir, platform), platform, arch })) {
    if (probe.isFile(bin)) candidates.push({ bin, source: 'private' })
  }
  const old = []
  const seen = new Set()
  for (const candidate of candidates) {
    if (seen.has(candidate.bin)) continue
    seen.add(candidate.bin)
    const version = candidate.version ?? probe.versionOf(candidate.bin)
    if (version && isSupportedBun(version)) {
      return { bin: candidate.bin, version, source: candidate.source, old }
    }
    old.push({ bin: candidate.bin, version: version ?? null })
  }
  return { bin: null, version: null, source: null, old }
}

/** The npm program that installs Bun. Under Node, the npm that came with it; otherwise npm on PATH. */
export function npmCommand({ platform, execPath, isNode, isFile }) {
  if (isNode) {
    const p = pathsFor(platform)
    const dir = p.dirname(execPath)
    const candidates = [
      p.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
      p.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    ]
    const cli = candidates.find((file) => isFile(file))
    if (cli) return { command: execPath, args: [cli], shell: false }
  }
  if (platform === 'win32') return { command: 'npm.cmd', args: [], shell: true }
  return { command: 'npm', args: [], shell: false }
}

// ---- text -------------------------------------------------------------------------------------

export function helpText(version) {
  return [
    `powdock ${version}: a lightweight web UI for the Docker Engine on your machine`,
    '',
    'Usage:',
    '  powdock                    start pow/dock (same as "powdock start")',
    '',
    'Start options:',
    '  --port <n>               port to listen on (default: $PORT, else 3434)',
    '  --host <address>         address to listen on (default: $HOST, else 127.0.0.1)',
    '  --data-dir <path>        data folder (default: $POWDOCK_DATA_DIR, else ~/.powdock)',
    '  --no-open                do not open the browser',
    '  -y, --yes                install Bun without asking, when it is missing',
    '  -v, --version            print the version',
    '  -h, --help               show this help',
  ].join('\n')
}

export function bunNotice({ old, runtimeDir }) {
  const lines = [`NOTICE: pow/dock runs on the Bun runtime (version ${MIN_BUN_VERSION} or newer), not on Node.js.`]
  if (old.length === 0) lines.push('Bun is not installed on this computer.')
  for (const copy of old) {
    if (copy.version) lines.push(`Bun ${copy.version} at ${copy.bin} is too old.`)
    else lines.push(`Found ${copy.bin}, but it does not run.`)
  }
  lines.push('', 'You can:')
  lines.push(`  1. Let powdock install Bun ${MIN_BUN_VERSION} into ${runtimeDir}.`)
  lines.push('     That is about 100 MB of disk space (the size depends on the platform).')
  lines.push('     Nothing else on this computer changes: no system install, no PATH or shell change.')
  lines.push('  2. Install Bun yourself from https://bun.sh, then run powdock again.')
  return lines.join('\n')
}

// ---- running things ---------------------------------------------------------------------------

const realProbe = {
  isFile(file) {
    try {
      return statSync(file).isFile()
    } catch {
      return false
    }
  },
  versionOf(bin) {
    const result = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true })
    if (result.error || result.status !== 0) return null
    const version = String(result.stdout).trim()
    return parseVersion(version) ? version : null
  },
}

function packageVersion() {
  try {
    return JSON.parse(readFileSync(path.join(PACKAGE_DIR, 'package.json'), 'utf8')).version ?? 'unknown'
  } catch {
    return 'unknown'
  }
}

/** Resolves when the URL answers with any HTTP response. Stops early when isGone() is true. */
export async function waitForServer(
  url,
  { isGone = () => false, timeoutMs = SERVER_WAIT_MS, intervalMs = SERVER_POLL_MS } = {},
) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (isGone()) return false
    if (await answers(url)) return true
    if (Date.now() >= deadline) return false
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

async function answers(url) {
  try {
    const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
    await response.body?.cancel()
    return true
  } catch {
    return false
  }
}

function waitForExit(child) {
  return new Promise((resolve) => {
    child.on('error', (error) => {
      console.error(`powdock: ${error.message}`)
      resolve(1)
    })
    // A process stopped by a signal exits with 128 + the signal number, as shells report it (130 for Ctrl+C).
    child.on('exit', (code, signal) => {
      if (code !== null) return resolve(code)
      resolve(signal ? 128 + (osConstants.signals[signal] ?? 0) : 1)
    })
  })
}

/** Opens the browser. A missing opener is not an error: the URL is printed anyway. */
function openBrowser(url, platform) {
  let command = 'xdg-open'
  let args = [url]
  let extra = {}
  if (platform === 'darwin') command = 'open'
  if (platform === 'win32') {
    command = 'cmd'
    args = ['/c', 'start', '""', url]
    extra = { windowsVerbatimArguments: true }
  }
  const child = spawn(command, args, { stdio: 'ignore', detached: true, windowsHide: true, ...extra })
  child.on('error', () => {})
  child.unref()
}

function quoteForShell(arg) {
  return /[\s"]/.test(arg) ? `"${arg.replace(/"/g, '\\"')}"` : arg
}

/** Asks one question on the terminal. An empty string when the input ends or Ctrl+C is pressed. */
function ask(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stderr })
    rl.on('close', () => resolve(''))
    rl.on('SIGINT', () => rl.close())
    rl.question(question, (answer) => {
      resolve(answer)
      rl.close()
    })
  })
}

/** Installs Bun 1.4.4 into the runtime folder only. Resolves with npm's exit code. */
function installBun(runtimeDir, isNode, platform, isFile) {
  mkdirSync(runtimeDir, { recursive: true })
  const npm = npmCommand({ platform, execPath: process.execPath, isNode, isFile })
  const args = [...npm.args, 'install', '--prefix', runtimeDir, '--no-save', '--no-audit', '--no-fund']
  args.push(`bun@${MIN_BUN_VERSION}`)
  console.error(`Installing Bun ${MIN_BUN_VERSION} into ${runtimeDir} ...`)
  const child = npm.shell
    ? spawn([npm.command, ...args].map(quoteForShell).join(' '), { stdio: 'inherit', shell: true, windowsHide: true })
    : spawn(npm.command, args, { stdio: 'inherit', windowsHide: true })
  return waitForExit(child)
}

/**
 * Returns the Bun binary to run, or null after printing why there is none. Asks before installing,
 * unless --yes was given. Without a terminal it never installs unless --yes was given.
 */
async function ensureBun({ env, homeDir, platform, arch, yes, isNode }) {
  const lookup = () =>
    findBun({
      env,
      platform,
      arch,
      homeDir,
      execPath: process.execPath,
      runningVersion: process.versions.bun ?? null,
      probe: realProbe,
    })
  const found = lookup()
  if (found.bin !== null) return found.bin

  const runtimeDir = runtimeDirFor(homeDir, platform)
  console.error(bunNotice({ old: found.old, runtimeDir }))
  if (!yes) {
    if (!process.stdin.isTTY) {
      console.error(
        `Not running in a terminal, so Bun was not installed. Install Bun from https://bun.sh, or run "powdock --yes" to let powdock install Bun ${MIN_BUN_VERSION}.`,
      )
      return null
    }
    const answer = await ask('Install it now? [y/N] ')
    if (!/^y(es)?$/i.test(answer.trim())) {
      console.error('Nothing was installed. Install Bun from https://bun.sh, then run powdock again.')
      return null
    }
  }

  const code = await installBun(runtimeDir, isNode, platform, realProbe.isFile)
  if (code !== 0) {
    console.error(`powdock: installing Bun failed (npm exit code ${code}). Install Bun from https://bun.sh instead.`)
    return null
  }
  const installed = lookup()
  if (installed.bin === null) {
    console.error(
      `powdock: Bun ${MIN_BUN_VERSION} was installed but does not run. Install Bun from https://bun.sh instead.`,
    )
    return null
  }
  return installed.bin
}

async function serve(bun, settings, platform) {
  const startJs = path.join(PACKAGE_DIR, 'start.js')
  if (!existsSync(startJs)) {
    console.error(`powdock: ${startJs} is missing. Reinstall the powdock package.`)
    return 1
  }
  console.error(`Data folder: ${settings.dataDir}`)

  const url = serverUrl(settings.host, settings.port)
  const port = parsePortFlag(settings.port)
  // If something already answers there, the server will fail to bind and print the real error.
  // Waiting for an answer would then report that other program as pow/dock, so the wait is skipped.
  const busy = port !== null && (await answers(url))
  if (busy)
    console.error(`Something is already answering at ${url}. If it is not pow/dock, use --port to pick another port.`)

  // Started now and read after the server is up, so the check never delays the start.
  const latestCheck = latestRegistryVersion({ env: process.env })
  const child = spawn(bun, [startJs], { stdio: 'inherit', env: childEnv(process.env, settings), windowsHide: true })
  let gone = false
  const exited = waitForExit(child).then((code) => {
    gone = true
    return code
  })
  const forward = (signal) => () => {
    if (!gone) child.kill(signal)
  }
  process.on('SIGINT', forward('SIGINT'))
  process.on('SIGTERM', forward('SIGTERM'))

  if (port !== null && !busy) {
    const up = await waitForServer(url, { isGone: () => gone })
    if (up) {
      console.error(`Open ${url} in your browser. Press Ctrl+C to stop.`)
      if (settings.open && process.stdout.isTTY) openBrowser(url, platform)
      latestCheck.then((latest) => {
        const notice = updateNotice(packageVersion(), latest)
        if (notice) console.error(notice)
      })
    } else if (!gone) {
      console.error(
        `pow/dock has not answered at ${url} after ${SERVER_WAIT_MS / 1000} seconds. Check the messages above.`,
      )
    }
  }
  return exited
}

/**
 * Runs the command line. Resolves with the exit code. For the server it resolves when the server
 * stops. bin/powdock.mjs passes the code to process.exit.
 */
export async function main(argv) {
  const parsed = parseArgs(argv)
  if (parsed.mode === 'error') {
    console.error(`powdock: ${parsed.message}`)
    return 2
  }
  if (parsed.mode === 'help') {
    console.log(helpText(packageVersion()))
    return 0
  }
  if (parsed.mode === 'version') {
    console.log(packageVersion())
    return 0
  }

  const platform = process.platform
  const homeDirectory = homedir()
  const bun = await ensureBun({
    env: process.env,
    homeDir: homeDirectory,
    platform,
    arch: process.arch,
    yes: parsed.mode === 'serve' && parsed.options.yes,
    isNode: !process.versions.bun,
  })
  if (bun === null) return 1

  const settings = serveSettings({ options: parsed.options, env: process.env, homeDir: homeDirectory, platform })
  return serve(bun, settings, platform)
}
