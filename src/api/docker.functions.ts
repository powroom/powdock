import { createServerFn } from '@tanstack/react-start'
import type { ContainerDetails } from '@/lib/container-details'
import type { RecentFailure } from '@/lib/recent-failures'
import type { TerminalShell } from '@/lib/terminal-protocol'
import type {
  ContainerHistory,
  ContainerStats,
  ContainerSummary,
  DockerCounts,
  EngineInfo,
  TotalsSample,
} from '@/lib/types'
import { dockerValidators } from './validators'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The Docker calls and their error text live in src/server/docker.server.ts.

export const listContainersFn = createServerFn({ method: 'GET' }).handler(async (): Promise<ContainerSummary[]> => {
  const { listContainers } = await import('@/server/docker-cache.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => listContainers(), 'Could not list containers.')
})

/** The counts the sidebar shows: running and all containers, images, volumes and networks. Kept for 5 seconds on the server. */
export const countsFn = createServerFn({ method: 'GET' }).handler(async (): Promise<DockerCounts> => {
  const { dockerCounts } = await import('@/server/docker-cache.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => dockerCounts(), 'Could not read the counts.')
})

/** The latest CPU and memory of the given containers, with a sparkline of their CPU. The sampler keeps the history. */
export const containerStatsFn = createServerFn({ method: 'POST' })
  .validator(dockerValidators().statsInput)
  .handler(async ({ data }): Promise<ContainerStats[]> => {
    const { statsSampler } = await import('@/server/stats-sampler.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(async () => statsSampler.latest(data.ids), 'Could not read container stats.')
  })

/** The history of one container: every sample the sampler kept (about the last five minutes). */
export const containerHistoryFn = createServerFn({ method: 'POST' })
  .validator(dockerValidators().historyInput)
  .handler(async ({ data }): Promise<ContainerHistory> => {
    const { statsSampler } = await import('@/server/stats-sampler.server')
    const { hostMemoryTotal } = await import('@/server/docker.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(async () => {
      const samples = statsSampler.history(data.id)
      return { samples, hostMemory: await hostMemoryTotal() }
    }, 'Could not read the container history.')
  })

/** The totals of all running containers over the last five minutes. The dashboard's usage chart polls it. */
export const totalsHistoryFn = createServerFn({ method: 'GET' }).handler(async (): Promise<TotalsSample[]> => {
  const { statsSampler } = await import('@/server/stats-sampler.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(async () => statsSampler.totals(), 'Could not read the totals.')
})

/** The Docker version, the system, the CPU count and the memory of the host. Kept for a minute on the server. */
export const engineInfoFn = createServerFn({ method: 'GET' }).handler(async (): Promise<EngineInfo> => {
  const { engineInfo } = await import('@/server/docker.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => engineInfo(), 'Could not read the Docker details.')
})

/** The stops worth a look on the dashboard. The server keeps the answer for 30 seconds. */
export const recentFailuresFn = createServerFn({ method: 'GET' }).handler(async (): Promise<RecentFailure[]> => {
  const { recentFailures } = await import('@/server/failures.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => recentFailures(), 'Could not check the stopped containers.')
})

export const containerActionFn = createServerFn({ method: 'POST' })
  .validator(dockerValidators().actionInput)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { containerAction } = await import('@/server/docker.server')
    const { withClientErrors } = await import('@/lib/redact')
    await withClientErrors(() => containerAction(data.id, data.action), 'Could not run the container action.')
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return { ok: true }
  })

export const removeContainerFn = createServerFn({ method: 'POST' })
  .validator(dockerValidators().removeInput)
  .handler(async ({ data }): Promise<{ ok: true }> => {
    const { removeContainer } = await import('@/server/docker.server')
    const { withClientErrors } = await import('@/lib/redact')
    await withClientErrors(
      () => removeContainer(data.id, { force: data.force, volumes: data.volumes }),
      'Could not remove the container.',
    )
    const { invalidateDockerCache } = await import('@/server/docker-cache.server')
    invalidateDockerCache()
    return { ok: true }
  })

export const inspectContainerFn = createServerFn({ method: 'POST' })
  .validator(dockerValidators().inspectInput)
  .handler(async ({ data }): Promise<ContainerDetails> => {
    const { inspectContainer } = await import('@/server/docker.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => inspectContainer(data.id), 'Could not read the container details.')
  })

/** The shells a running container has, for the Terminal tab's picker. Empty when the check cannot run. */
export const containerShellsFn = createServerFn({ method: 'POST' })
  .validator(dockerValidators().shellsInput)
  .handler(async ({ data }): Promise<TerminalShell[]> => {
    const { listShells } = await import('@/server/shells.server')
    return listShells(data.id)
  })
