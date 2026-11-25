// The app version and the helpers that compare versions. Used by the server (update check) and the UI.

/** Set at build time from package.json (vite.config.ts). Tests run without the build, so they get a dev version. */
export const APP_VERSION: string = typeof __POWDOCK_VERSION__ === 'string' ? __POWDOCK_VERSION__ : '0.0.0-dev'

/** How pow/dock was installed. Set by the environment: POWDOCK_INSTALL=docker (the image), npm (the launcher), or unset. */
export type InstallMethod = 'docker' | 'npm' | 'source'

export interface ReleaseInfo {
  version: string
  url: string
  publishedAt: string
  notes: string
}

export interface UpdateInfo {
  current: string
  install: InstallMethod
  /** the newer release, or null when there is none (or the check is off or failed) */
  latest: ReleaseInfo | null
}

// "1.2.3", "v1.2.3", "1.2.3-rc.1" and "1.2.3+build" are accepted. Build metadata is ignored.
const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/

interface ParsedVersion {
  core: [number, number, number]
  /** the prerelease text after the dash, or '' for a release */
  pre: string
}

function parseVersion(text: string): ParsedVersion | null {
  const match = VERSION_PATTERN.exec(text.trim())
  if (!match) return null
  return { core: [Number(match[1]), Number(match[2]), Number(match[3])], pre: match[4] ?? '' }
}

export function isVersion(text: string): boolean {
  return parseVersion(text) !== null
}

/**
 * -1, 0 or 1 when a is older, equal or newer than b. A prerelease is older than the same x.y.z
 * release. Two prereleases of the same x.y.z compare as text. Null when either one is not a version.
 */
export function compareVersions(a: string, b: string): -1 | 0 | 1 | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  if (!left || !right) return null
  for (let i = 0; i < 3; i++) {
    if (left.core[i] !== right.core[i]) return left.core[i]! < right.core[i]! ? -1 : 1
  }
  if (left.pre === right.pre) return 0
  if (left.pre === '') return 1
  if (right.pre === '') return -1
  return left.pre < right.pre ? -1 : 1
}

/** True only when latest is a real version and newer than current. */
export function isNewer(latest: string, current: string): boolean {
  return compareVersions(latest, current) === 1
}
