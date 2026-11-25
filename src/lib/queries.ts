import { queryOptions } from '@tanstack/react-query'
import { diskUsageFn } from '@/api/cleanup.functions'
import {
  containerHistoryFn,
  containerShellsFn,
  containerStatsFn,
  countsFn,
  engineInfoFn,
  recentFailuresFn,
  inspectContainerFn,
  listContainersFn,
  totalsHistoryFn,
} from '@/api/docker.functions'
import { imageStacksFn, inspectImageFn, listImagesFn } from '@/api/images.functions'
import { scanResultFn, scanStatusFn, scanSummariesFn } from '@/api/scan.functions'
import { inspectNetworkFn, listNetworksFn } from '@/api/networks.functions'
import { inspectVolumeFn, listVolumesFn, volumeSizesFn } from '@/api/volumes.functions'
import { authStateFn } from '@/api/session.functions'
import { idleProjectsFn, projectFilesFn, projectFn, projectsDirFn } from '@/api/projects.functions'
import { updateInfoFn } from '@/api/update.functions'
import { updateStatusFn } from '@/api/updates.functions'

/** Query keys. Sign-in state lives under 'auth', so one invalidate refreshes it everywhere. */
export const keys = {
  auth: ['auth'] as const,
  update: ['update'] as const,
  /** the container list and its stats (one invalidate refreshes both) */
  containers: ['containers'] as const,
  /** the image list (with container counts) and the details of one image */
  images: ['images'] as const,
  /** the volume list, its sizes (their own query) and the details of one volume */
  volumes: ['volumes'] as const,
  /** the network list and the details of one network */
  networks: ['networks'] as const,
  /** the Compose projects: one project (its folder, files and state) and the files of a project */
  projects: ['projects'] as const,
  /** the disk usage summary of the Cleanup page (a prune on that page also refreshes the lists above) */
  cleanup: ['cleanup'] as const,
  /** the sidebar counts (one small query, not the full lists) */
  counts: ['counts'] as const,
  /** the image update checks (the last results, see updates.server.ts) */
  updates: ['updates'] as const,
  /** the vulnerability scans: the status, the summaries of every stored scan, and the result of one image */
  scans: ['scans'] as const,
}

export const authStateQuery = () =>
  queryOptions({
    queryKey: keys.auth,
    queryFn: () => authStateFn(),
    staleTime: 0,
  })

export const updateInfoQuery = () =>
  queryOptions({
    queryKey: keys.update,
    queryFn: () => updateInfoFn(),
    staleTime: 60 * 60 * 1000,
  })

export const containersQuery = () =>
  queryOptions({
    queryKey: [...keys.containers, 'list'],
    queryFn: () => listContainersFn(),
    staleTime: 0,
  })

/** `ids` must be sorted, so the same running set always gets the same cache entry. */
/** The sidebar counts: running and all containers, and the number of images, volumes and networks. The server keeps them for 5 seconds. */
export const countsQuery = () =>
  queryOptions({
    queryKey: keys.counts,
    queryFn: () => countsFn(),
    staleTime: 5_000,
  })

/** `ids` must be sorted, so the same running set always gets the same cache entry. */
export const containerStatsQuery = (ids: readonly string[]) =>
  queryOptions({
    queryKey: [...keys.containers, 'stats', ids],
    queryFn: () => containerStatsFn({ data: { ids: [...ids] } }),
    staleTime: 0,
  })

/** The stats history of one container (the Stats tab). The sampler keeps five minutes of samples. */
export const containerHistoryQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.containers, 'history', id],
    queryFn: () => containerHistoryFn({ data: { id } }),
    staleTime: 0,
  })

/** The totals of all running containers (the dashboard's usage chart). The sampler keeps five minutes of samples. */
export const totalsHistoryQuery = () =>
  queryOptions({
    queryKey: [...keys.containers, 'totals'],
    queryFn: () => totalsHistoryFn(),
    staleTime: 0,
  })

/** The stops worth a look (out-of-memory kills, non-zero codes after the last boot). The server keeps them for 30 seconds. */
export const recentFailuresQuery = () =>
  queryOptions({
    queryKey: [...keys.containers, 'failures'],
    queryFn: () => recentFailuresFn(),
    staleTime: 30_000,
  })

/** The Docker version, the system, the CPUs and the memory of the host. The server keeps them for a minute. */
export const engineInfoQuery = () =>
  queryOptions({
    queryKey: ['engine'],
    queryFn: () => engineInfoFn(),
    staleTime: 60_000,
  })

/** The shells a running container has (the Terminal tab's picker). They do not change while the container runs. */
export const containerShellsQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.containers, 'shells', id],
    queryFn: () => containerShellsFn({ data: { id } }),
    staleTime: Infinity,
  })

/** The details of one container, for the Details tab. */
export const containerDetailsQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.containers, 'inspect', id],
    queryFn: () => inspectContainerFn({ data: { id } }),
    staleTime: 0,
  })

/** One Compose project and whether Docker Compose runs here. It follows the container list (see keys.containers). */
export const projectQuery = (name: string) =>
  queryOptions({
    queryKey: [...keys.projects, 'one', name],
    queryFn: () => projectFn({ data: { name } }),
    staleTime: 0,
  })

/** The remembered projects with no containers now (the Containers page), and whether Compose runs here. */
export const idleProjectsQuery = () =>
  queryOptions({
    queryKey: [...keys.projects, 'idle'],
    queryFn: () => idleProjectsFn(),
    staleTime: 0,
  })

/** The folder New project suggests. It does not change while the page is open. */
export const projectsDirQuery = () =>
  queryOptions({
    queryKey: [...keys.projects, 'dir'],
    queryFn: () => projectsDirFn(),
    staleTime: Infinity,
  })

/** The config files of a project, for the Compose file tab (their text, version and whether they can be written). */
export const projectFilesQuery = (name: string) =>
  queryOptions({
    queryKey: [...keys.projects, 'files', name],
    queryFn: () => projectFilesFn({ data: { name } }),
    staleTime: 0,
  })

/** The last image update check. It is read from the server's memory, so a short stale time is enough. */
export const updatesQuery = () =>
  queryOptions({
    queryKey: keys.updates,
    queryFn: () => updateStatusFn(),
    staleTime: 30_000,
  })

export const imagesQuery = () =>
  queryOptions({
    queryKey: [...keys.images, 'list'],
    queryFn: () => listImagesFn(),
    staleTime: 0,
  })

/** The details of one image, for the image page. */
export const imageDetailsQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.images, 'inspect', id],
    queryFn: () => inspectImageFn({ data: { id } }),
    staleTime: 0,
  })

/**
 * The icon of each image (see image-stack.ts). `ids` must be sorted and unique (uniqueSortedIds). An image
 * id never changes its config, so the answer is kept until the page reloads.
 */
export const imageStacksQuery = (ids: readonly string[]) =>
  queryOptions({
    queryKey: [...keys.images, 'stacks', ids],
    queryFn: () => imageStacksFn({ data: { ids: [...ids] } }),
    staleTime: Infinity,
  })

/** Whether Trivy is installed and which scans run now. The image page polls it while a scan runs. */
export const scanStatusQuery = () =>
  queryOptions({
    queryKey: [...keys.scans, 'status'],
    queryFn: () => scanStatusFn(),
    staleTime: 5_000,
  })

/** The numbers of every stored scan, for the badges. */
export const scanSummariesQuery = () =>
  queryOptions({
    queryKey: [...keys.scans, 'summaries'],
    queryFn: () => scanSummariesFn(),
    staleTime: 30_000,
  })

/** The stored result of one image (its findings), for the Vulnerabilities section of the image page. */
export const scanResultQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.scans, 'result', id],
    queryFn: () => scanResultFn({ data: { id } }),
    staleTime: 0,
  })

export const volumesQuery = () =>
  queryOptions({
    queryKey: [...keys.volumes, 'list'],
    queryFn: () => listVolumesFn(),
    staleTime: 0,
  })

/**
 * Volume sizes. Docker is slow to report them, so the page starts this query after the list has loaded,
 * and the result is kept for a minute.
 */
export const volumeSizesQuery = () =>
  queryOptions({
    queryKey: [...keys.volumes, 'sizes'],
    queryFn: () => volumeSizesFn(),
    staleTime: 60_000,
  })

/** The details of one volume, for its details sheet. */
export const volumeDetailsQuery = (name: string) =>
  queryOptions({
    queryKey: [...keys.volumes, 'inspect', name],
    queryFn: () => inspectVolumeFn({ data: { name } }),
    staleTime: 0,
  })

export const networksQuery = () =>
  queryOptions({
    queryKey: [...keys.networks, 'list'],
    queryFn: () => listNetworksFn(),
    staleTime: 0,
  })

/** The details of one network, for its details sheet. */
export const networkDetailsQuery = (id: string) =>
  queryOptions({
    queryKey: [...keys.networks, 'inspect', id],
    queryFn: () => inspectNetworkFn({ data: { id } }),
    staleTime: 0,
  })

/**
 * The disk usage summary. Docker can take several seconds on a big host, so the result is kept for a minute
 * and it is never polled.
 */
export const diskUsageQuery = () =>
  queryOptions({
    queryKey: [...keys.cleanup, 'usage'],
    queryFn: () => diskUsageFn(),
    staleTime: 60_000,
    // While the server reads Docker again in the background, ask again each second, so the new numbers arrive.
    refetchInterval: (query) => (query.state.data?.refreshing ? 1000 : false),
  })
