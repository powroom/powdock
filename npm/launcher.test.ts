import { describe, expect, test } from 'bun:test'
import path from 'node:path'
import {
  bunNotice,
  childEnv,
  compareVersions,
  findAllOnPath,
  findBun,
  helpText,
  latestRegistryVersion,
  isSupportedBun,
  npmCommand,
  parseArgs,
  parsePortFlag,
  privateBunCandidates,
  resolveDataDir,
  runtimeDirFor,
  serveSettings,
  serverUrl,
  updateCheckOn,
  updateNotice,
  waitForServer,
  type FileProbe,
  type ParsedArgs,
  type ServeOptions,
} from './lib/launcher.mjs'

const HOME = '/home/tester'
const NO_OPTIONS: ServeOptions = { port: undefined, host: undefined, dataDir: undefined, open: true, yes: false }

/** A fake file system: each listed file exists. The value is the version `bun --version` prints (null: does not run). */
function fakeProbe(files: Record<string, string | null>): FileProbe {
  return {
    isFile: (file) => Object.hasOwn(files, file),
    versionOf: (bin) => files[bin] ?? null,
  }
}

describe('parseArgs', () => {
  test('no command starts the server with default options', () => {
    expect(parseArgs([])).toEqual({ mode: 'serve', options: NO_OPTIONS })
  })

  test('start is the same as no command, with flags', () => {
    const expected: ParsedArgs = {
      mode: 'serve',
      options: { port: 4000, host: '0.0.0.0', dataDir: '/srv/powdock', open: false, yes: true },
    }
    expect(
      parseArgs(['start', '--port', '4000', '--host=0.0.0.0', '--data-dir', '/srv/powdock', '--no-open', '-y']),
    ).toEqual(expected)
    expect(parseArgs(['--port=4000', '--host', '0.0.0.0', '--data-dir=/srv/powdock', '--no-open', '--yes'])).toEqual(
      expected,
    )
  })

  test('flags without a command start the server', () => {
    expect(parseArgs(['--port', '3399', '--no-open'])).toEqual({
      mode: 'serve',
      options: { ...NO_OPTIONS, port: 3399, open: false },
    })
  })

  test('any other command is an error', () => {
    expect(parseArgs(['status']).mode).toBe('error')
    expect(parseArgs(['serve']).mode).toBe('error')
  })

  test('help and version', () => {
    expect(parseArgs(['--help'])).toEqual({ mode: 'help' })
    expect(parseArgs(['-h'])).toEqual({ mode: 'help' })
    expect(parseArgs(['start', '--help'])).toEqual({ mode: 'help' })
    expect(parseArgs(['--version'])).toEqual({ mode: 'version' })
    expect(parseArgs(['-v'])).toEqual({ mode: 'version' })
  })

  test('bad ports, missing values and unknown flags are errors', () => {
    expect(parseArgs(['--port', '70000']).mode).toBe('error')
    expect(parseArgs(['--port', 'abc']).mode).toBe('error')
    expect(parseArgs(['--port']).mode).toBe('error')
    expect(parseArgs(['--port', '--no-open']).mode).toBe('error')
    expect(parseArgs(['--host=']).mode).toBe('error')
    expect(parseArgs(['--data-dir', '']).mode).toBe('error')
    expect(parseArgs(['--frobnicate']).mode).toBe('error')
  })
})

describe('parsePortFlag', () => {
  test('accepts whole numbers from 1 to 65535', () => {
    expect(parsePortFlag('1')).toBe(1)
    expect(parsePortFlag('65535')).toBe(65535)
    expect(parsePortFlag(' 3434 ')).toBe(3434)
  })

  test('rejects everything else', () => {
    for (const value of ['0', '65536', '3.5', '-1', '', 'abc', undefined]) {
      expect(parsePortFlag(value)).toBeNull()
    }
  })
})

describe('versions', () => {
  test('compares numeric parts, not text', () => {
    expect(compareVersions('1.4.4', '1.4.4')).toBe(0)
    expect(compareVersions('1.4.3', '1.4.4')).toBe(-1)
    expect(compareVersions('1.10.0', '1.4.4')).toBe(1)
    expect(compareVersions('v1.4.5', '1.4.4')).toBe(1)
    expect(compareVersions('nope', '1.4.4')).toBeNull()
  })

  test('Bun must be 1.4.4 or newer', () => {
    expect(isSupportedBun('1.4.4')).toBe(true)
    expect(isSupportedBun('1.5.0')).toBe(true)
    expect(isSupportedBun('2.0.0')).toBe(true)
    expect(isSupportedBun('1.4.3')).toBe(false)
    expect(isSupportedBun('1.3.11')).toBe(false)
    expect(isSupportedBun('')).toBe(false)
    expect(isSupportedBun(undefined)).toBe(false)
  })
})

describe('data folder and settings', () => {
  test('defaults to ~/.powdock', () => {
    expect(resolveDataDir({ flag: undefined, env: {}, homeDir: HOME, platform: 'linux' })).toBe('/home/tester/.powdock')
  })

  test('POWDOCK_DATA_DIR is used when no flag is given, and an empty value counts as unset', () => {
    expect(
      resolveDataDir({ flag: undefined, env: { POWDOCK_DATA_DIR: '/data' }, homeDir: HOME, platform: 'linux' }),
    ).toBe('/data')
    expect(resolveDataDir({ flag: undefined, env: { POWDOCK_DATA_DIR: '' }, homeDir: HOME, platform: 'linux' })).toBe(
      '/home/tester/.powdock',
    )
  })

  test('the flag wins over the environment variable', () => {
    expect(
      resolveDataDir({ flag: '/flag', env: { POWDOCK_DATA_DIR: '/data' }, homeDir: HOME, platform: 'linux' }),
    ).toBe('/flag')
  })

  test('a leading ~ means the home folder, and relative paths become absolute', () => {
    expect(resolveDataDir({ flag: '~/db', env: {}, homeDir: HOME, platform: 'linux' })).toBe('/home/tester/db')
    expect(resolveDataDir({ flag: 'rel', env: {}, homeDir: HOME, platform: 'linux' })).toBe(path.posix.resolve('rel'))
  })

  test('Windows paths use backslashes', () => {
    expect(resolveDataDir({ flag: undefined, env: {}, homeDir: 'C:\\Users\\Ana', platform: 'win32' })).toBe(
      'C:\\Users\\Ana\\.powdock',
    )
    expect(runtimeDirFor('C:\\Users\\Ana', 'win32')).toBe('C:\\Users\\Ana\\.powdock\\runtime')
  })

  test('flags win over environment variables, which win over defaults', () => {
    const env = { PORT: '4000', HOST: '0.0.0.0', POWDOCK_DATA_DIR: '/env-data' }
    expect(serveSettings({ options: NO_OPTIONS, env, homeDir: HOME, platform: 'linux' })).toEqual({
      port: '4000',
      host: '0.0.0.0',
      dataDir: '/env-data',
      open: true,
      yes: false,
    })
    expect(
      serveSettings({
        options: { ...NO_OPTIONS, port: 3399, host: '127.0.0.1', dataDir: '/flag-data' },
        env,
        homeDir: HOME,
        platform: 'linux',
      }),
    ).toEqual({ port: '3399', host: '127.0.0.1', dataDir: '/flag-data', open: true, yes: false })
    expect(serveSettings({ options: NO_OPTIONS, env: {}, homeDir: HOME, platform: 'linux' })).toMatchObject({
      port: '3434',
      host: '127.0.0.1',
      dataDir: '/home/tester/.powdock',
    })
  })

  test('the child process gets PORT, HOST and POWDOCK_DATA_DIR, and keeps other variables', () => {
    const settings = { port: '3399', host: '127.0.0.1', dataDir: '/d' }
    expect(childEnv({ PORT: '1', HOST: 'x', KEEP: 'yes' }, settings)).toEqual({
      PORT: '3399',
      HOST: '127.0.0.1',
      POWDOCK_DATA_DIR: '/d',
      POWDOCK_INSTALL: 'npm',
      KEEP: 'yes',
    })
  })

  test('the browser address for a bound host', () => {
    expect(serverUrl('0.0.0.0', '3434')).toBe('http://127.0.0.1:3434/')
    expect(serverUrl('::', '3434')).toBe('http://[::1]:3434/')
    expect(serverUrl('127.0.0.1', '3399')).toBe('http://127.0.0.1:3399/')
  })
})

describe('finding Bun', () => {
  const runtimeBin = '/home/tester/.powdock/runtime/node_modules/@oven/bun-linux-x64/bin/bun'

  test('uses the Bun that runs the launcher when it is new enough', () => {
    const probe = fakeProbe({})
    expect(
      findBun({
        env: {},
        platform: 'linux',
        arch: 'x64',
        homeDir: HOME,
        execPath: '/home/tester/.bun/bin/bun',
        runningVersion: '1.4.4',
        probe,
      }),
    ).toEqual({ bin: '/home/tester/.bun/bin/bun', version: '1.4.4', source: 'runtime', old: [] })
  })

  test('skips a Bun on PATH that is too old and takes the next one', () => {
    const probe = fakeProbe({ '/old/bin/bun': '1.3.9', '/new/bin/bun': '1.4.4' })
    expect(
      findBun({
        env: { PATH: '/old/bin:/new/bin' },
        platform: 'linux',
        arch: 'x64',
        homeDir: HOME,
        execPath: '/usr/bin/node',
        runningVersion: null,
        probe,
      }),
    ).toEqual({
      bin: '/new/bin/bun',
      version: '1.4.4',
      source: 'path',
      old: [{ bin: '/old/bin/bun', version: '1.3.9' }],
    })
  })

  test('uses the private copy in ~/.powdock/runtime when nothing else works', () => {
    const probe = fakeProbe({ [runtimeBin]: '1.4.4' })
    expect(
      findBun({
        env: {},
        platform: 'linux',
        arch: 'x64',
        homeDir: HOME,
        execPath: '/usr/bin/node',
        runningVersion: null,
        probe,
      }),
    ).toEqual({ bin: runtimeBin, version: '1.4.4', source: 'private', old: [] })
  })

  test('finds bun.exe on a Windows PATH', () => {
    const probe = fakeProbe({ 'C:\\bun\\bun.exe': '1.4.4' })
    const result = findBun({
      env: { Path: 'C:\\tools;C:\\bun' },
      platform: 'win32',
      arch: 'x64',
      homeDir: 'C:\\Users\\Ana',
      execPath: 'C:\\Program Files\\nodejs\\node.exe',
      runningVersion: null,
      probe,
    })
    expect(result.bin).toBe('C:\\bun\\bun.exe')
  })

  test('reports copies that do not run, and returns no Bun when there is none', () => {
    expect(
      findBun({
        env: { PATH: '/bad/bin' },
        platform: 'linux',
        arch: 'x64',
        homeDir: HOME,
        execPath: '/usr/bin/node',
        runningVersion: null,
        probe: fakeProbe({ '/bad/bin/bun': null }),
      }),
    ).toEqual({ bin: null, version: null, source: null, old: [{ bin: '/bad/bin/bun', version: null }] })
    expect(
      findBun({
        env: {},
        platform: 'linux',
        arch: 'x64',
        homeDir: HOME,
        execPath: '/usr/bin/node',
        runningVersion: null,
        probe: fakeProbe({}),
      }),
    ).toEqual({ bin: null, version: null, source: null, old: [] })
  })

  test('the private copy is looked for where the npm bun package puts it', () => {
    expect(privateBunCandidates({ runtimeDir: '/r', platform: 'linux', arch: 'x64' })).toEqual([
      '/r/node_modules/bun/bin/bun',
      '/r/node_modules/.bin/bun',
      '/r/node_modules/@oven/bun-linux-x64/bin/bun',
    ])
    expect(privateBunCandidates({ runtimeDir: 'C:\\r', platform: 'win32', arch: 'arm64' })).toEqual([
      'C:\\r\\node_modules\\bun\\bin\\bun.exe',
      'C:\\r\\node_modules\\@oven\\bun-windows-aarch64\\bin\\bun.exe',
    ])
    expect(privateBunCandidates({ runtimeDir: '/r', platform: 'darwin', arch: 'arm64' })).toContain(
      '/r/node_modules/@oven/bun-darwin-aarch64/bin/bun',
    )
  })

  test('findAllOnPath keeps PATH order and skips empty entries', () => {
    const files = new Set(['/a/bun', '/c/bun'])
    expect(
      findAllOnPath('bun', { pathValue: '/a::/b:/c', platform: 'linux', isFile: (file) => files.has(file) }),
    ).toEqual(['/a/bun', '/c/bun'])
  })
})

describe('npm command for installing Bun', () => {
  test('under Node, runs the npm that came with it', () => {
    const cli = '/opt/node/lib/node_modules/npm/bin/npm-cli.js'
    expect(
      npmCommand({
        platform: 'linux',
        execPath: '/opt/node/bin/node',
        isNode: true,
        isFile: (file) => file === cli,
      }),
    ).toEqual({ command: '/opt/node/bin/node', args: [cli], shell: false })
  })

  test('under Bun, or without a bundled npm, uses npm from PATH', () => {
    expect(npmCommand({ platform: 'linux', execPath: '/x/bun', isNode: false, isFile: () => false })).toEqual({
      command: 'npm',
      args: [],
      shell: false,
    })
    expect(npmCommand({ platform: 'win32', execPath: 'C:\\x\\bun.exe', isNode: false, isFile: () => false })).toEqual({
      command: 'npm.cmd',
      args: [],
      shell: true,
    })
  })
})

describe('messages', () => {
  test('help lists the start options', () => {
    const text = helpText('0.0.1')
    expect(text.startsWith('powdock 0.0.1')).toBe(true)
    for (const flag of ['--port', '--host', '--data-dir', '--no-open', '--yes']) expect(text).toContain(flag)
    expect(text).toContain('3434')
  })

  test('the Bun notice explains the options and names the install location', () => {
    const missing = bunNotice({ old: [], runtimeDir: '/home/tester/.powdock/runtime' })
    expect(missing).toContain('not installed')
    expect(missing).toContain('https://bun.sh')
    expect(missing).toContain('/home/tester/.powdock/runtime')
    const old = bunNotice({ old: [{ bin: '/old/bun', version: '1.3.0' }], runtimeDir: '/r' })
    expect(old).toContain('Bun 1.3.0 at /old/bun is too old')
    expect(old).not.toContain('not installed')
  })
})

describe('waitForServer', () => {
  test('gives up at once when the server process is already gone (no network used)', async () => {
    expect(await waitForServer('http://127.0.0.1:9/', { isGone: () => true })).toBe(false)
  })
})

describe('update notice', () => {
  test('the notice names the newer version, the current one, and the command', () => {
    expect(updateNotice('0.1.0', '0.1.1')).toBe(
      'pow/dock 0.1.1 is available (you have 0.1.0). Stop pow/dock and run: npx powdock@latest',
    )
  })

  test('no notice for the same or an older version, or when a version is unknown', () => {
    expect(updateNotice('0.1.1', '0.1.1')).toBeNull()
    expect(updateNotice('0.1.1', '0.1.0')).toBeNull()
    expect(updateNotice('unknown', '0.1.1')).toBeNull()
    expect(updateNotice('0.1.0', null)).toBeNull()
  })

  test('the update check is off for POWDOCK_UPDATE_CHECK off, false or 0', () => {
    expect(updateCheckOn({})).toBe(true)
    expect(updateCheckOn({ POWDOCK_UPDATE_CHECK: 'on' })).toBe(true)
    expect(updateCheckOn({ POWDOCK_UPDATE_CHECK: 'OFF' })).toBe(false)
    expect(updateCheckOn({ POWDOCK_UPDATE_CHECK: 'false' })).toBe(false)
    expect(updateCheckOn({ POWDOCK_UPDATE_CHECK: ' 0 ' })).toBe(false)
  })

  test('the registry is asked for the latest version, with a timeout', async () => {
    const asked: { url: string; signal: AbortSignal | undefined }[] = []
    const fetchImpl = async (url: string | URL | Request, init?: RequestInit) => {
      asked.push({ url: String(url), signal: init?.signal ?? undefined })
      return new Response(JSON.stringify({ name: 'powdock', version: '0.1.1' }), { status: 200 })
    }
    expect(await latestRegistryVersion({ env: {}, fetchImpl })).toBe('0.1.1')
    expect(asked[0]!.url).toBe('https://registry.npmjs.org/powdock/latest')
    expect(asked[0]!.signal).toBeDefined()
  })

  test('no request when the update check is off', async () => {
    let asked = 0
    const fetchImpl = async () => {
      asked++
      return new Response('{}', { status: 200 })
    }
    expect(await latestRegistryVersion({ env: { POWDOCK_UPDATE_CHECK: 'off' }, fetchImpl })).toBeNull()
    expect(asked).toBe(0)
  })

  test('failures are silent: an error, a bad status, or a bad body gives null', async () => {
    const failing = async () => {
      throw new TypeError('fetch failed')
    }
    const notOk = async () => new Response('busy', { status: 503 })
    const notJson = async () => new Response('<html>', { status: 200 })
    const noVersion = async () => new Response('{"name":"powdock"}', { status: 200 })
    expect(await latestRegistryVersion({ env: {}, fetchImpl: failing })).toBeNull()
    expect(await latestRegistryVersion({ env: {}, fetchImpl: notOk })).toBeNull()
    expect(await latestRegistryVersion({ env: {}, fetchImpl: notJson })).toBeNull()
    expect(await latestRegistryVersion({ env: {}, fetchImpl: noVersion })).toBeNull()
  })
})
