// Types for launcher.mjs, so the TypeScript tests can import it. Not shipped in the npm package.

export interface FileProbe {
  isFile(file: string): boolean
  versionOf(bin: string): string | null
}

export interface ServeOptions {
  port: number | undefined
  host: string | undefined
  dataDir: string | undefined
  open: boolean
  yes: boolean
}

export type ParsedArgs =
  { mode: 'serve'; options: ServeOptions } | { mode: 'help' } | { mode: 'version' } | { mode: 'error'; message: string }

export interface BunCopy {
  bin: string
  version: string | null
}

export interface BunLookup {
  bin: string | null
  version: string | null
  source: 'runtime' | 'path' | 'private' | null
  old: BunCopy[]
}

export interface ServeSettings {
  port: string
  host: string
  dataDir: string
  open: boolean
  yes: boolean
}

export function platformMessage(platform: string): string | null
export function compareVersions(a: string | null | undefined, b: string | null | undefined): -1 | 0 | 1 | null
export function isSupportedBun(version: string | null | undefined): boolean
export function parsePortFlag(value: string | null | undefined): number | null
export function parseArgs(argv: string[]): ParsedArgs
export function resolveDataDir(input: {
  flag?: string
  env: Record<string, string | undefined>
  homeDir: string
}): string
export function runtimeDirFor(homeDir: string): string
export function serveSettings(input: {
  options: ServeOptions
  env: Record<string, string | undefined>
  homeDir: string
}): ServeSettings
export function childEnv(
  baseEnv: Record<string, string | undefined>,
  settings: Pick<ServeSettings, 'port' | 'host' | 'dataDir'>,
): Record<string, string | undefined>
export function updateCheckOn(env: Record<string, string | undefined>): boolean
export function updateNotice(current: string | null | undefined, latest: string | null | undefined): string | null
export function latestRegistryVersion(input: {
  env: Record<string, string | undefined>
  fetchImpl?: (url: string, init?: RequestInit) => Promise<Response>
}): Promise<string | null>
export function serverUrl(host: string, port: string | number): string
export function findAllOnPath(
  command: string,
  input: { pathValue: string | undefined; isFile: (file: string) => boolean },
): string[]
export function privateBunCandidates(input: { runtimeDir: string; platform: string; arch: string }): string[]
export function findBun(input: {
  env: Record<string, string | undefined>
  platform: string
  arch: string
  homeDir: string
  execPath: string
  runningVersion: string | null
  probe: FileProbe
}): BunLookup
export function npmCommand(input: { execPath: string; isNode: boolean; isFile: (file: string) => boolean }): {
  command: string
  args: string[]
}
export function helpText(version: string): string
export function bunNotice(input: { old: BunCopy[]; runtimeDir: string }): string
export function waitForServer(
  url: string,
  options?: { isGone?: () => boolean; timeoutMs?: number; intervalMs?: number },
): Promise<boolean>
export function main(argv: string[]): Promise<number>
