import type { VolumeSummary } from './types'

// Pure helpers for the Volumes page: which volumes match the filter and the search, how they sort,
// the counts on the filter tabs, and why a volume cannot be removed. No React here, so they are unit tested.

export type VolumeFilter = 'all' | 'in-use' | 'unused' | 'anonymous'

/** How many leading characters of an anonymous volume's ID the row shows. */
const ANONYMOUS_SHOWN = 12

export function matchesVolumeFilter(
  volume: Pick<VolumeSummary, 'usedBy' | 'anonymous'>,
  filter: VolumeFilter,
): boolean {
  if (filter === 'in-use') return volume.usedBy.length > 0
  if (filter === 'unused') return volume.usedBy.length === 0
  if (filter === 'anonymous') return volume.anonymous
  return true
}

/** Case-insensitive match on the name and the Compose project. An empty query matches all. */
export function matchesVolumeSearch(volume: Pick<VolumeSummary, 'name' | 'project'>, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return [volume.name, volume.project ?? ''].some((value) => value.toLowerCase().includes(needle))
}

export function countVolumes(volumes: readonly VolumeSummary[]): Record<VolumeFilter, number> {
  return {
    all: volumes.length,
    'in-use': volumes.filter((volume) => matchesVolumeFilter(volume, 'in-use')).length,
    unused: volumes.filter((volume) => matchesVolumeFilter(volume, 'unused')).length,
    anonymous: volumes.filter((volume) => volume.anonymous).length,
  }
}

/** Named volumes first: in use before unused, then by name. Anonymous volumes go last, in use or not. */
export function sortVolumes(volumes: readonly VolumeSummary[]): VolumeSummary[] {
  const rank = (volume: VolumeSummary): number => {
    if (volume.anonymous) return 2
    return volume.usedBy.length > 0 ? 0 : 1
  }
  return [...volumes].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

/** The total of the known sizes. A volume with no size, or no sizes yet, adds nothing. */
export function totalVolumeSize(
  volumes: readonly Pick<VolumeSummary, 'name'>[],
  sizes: Record<string, number | null>,
): number {
  return volumes.reduce((sum, volume) => sum + (sizes[volume.name] ?? 0), 0)
}

/** The name the row shows: an anonymous volume shows the start of its ID. */
export function shortVolumeName(volume: Pick<VolumeSummary, 'name' | 'anonymous'>): string {
  return volume.anonymous ? `${volume.name.slice(0, ANONYMOUS_SHOWN)}…` : volume.name
}

/** Why Remove is off for a volume, or null when it can be removed. */
export function volumeRemoveBlock(volume: Pick<VolumeSummary, 'usedBy'>): string | null {
  const [first, ...rest] = volume.usedBy
  if (!first) return null
  return rest.length > 0 ? `In use by ${first.name} and ${rest.length} more` : `In use by ${first.name}`
}
