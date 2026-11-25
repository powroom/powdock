import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { containerActionFn, removeContainerFn } from '@/api/docker.functions'
import { toastManager } from '@/components/ui/toast'
import type { BulkAction } from '@/lib/container-view'
import { countLabel } from '@/lib/format'
import { keys } from '@/lib/queries'
import type { ContainerAction, ContainerSummary } from '@/lib/types'

/** What a container is busy with: an action, or the removal. */
export type BusyKind = ContainerAction | 'remove'
export type BusyMap = ReadonlyMap<string, BusyKind>

const VERBS: Record<ContainerAction, string> = {
  start: 'start',
  stop: 'stop',
  restart: 'restart',
  pause: 'pause',
  unpause: 'resume',
  kill: 'kill',
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : 'Unknown error.'
}

function withEntries(prev: BusyMap, ids: readonly string[], kind: BusyKind | null): BusyMap {
  const next = new Map(prev)
  for (const id of ids) {
    if (kind) next.set(id, kind)
    else next.delete(id)
  }
  return next
}

/**
 * Runs container actions from the page. Each target shows a busy state while its action runs. Errors
 * become toasts with Docker's message. The list is refreshed before the busy state clears, so a row
 * never shows its old state after the spinner is gone.
 */
export function useContainerActions() {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState<BusyMap>(() => new Map())

  // The work reports its own errors, so the release after it always runs.
  const withBusy = (ids: readonly string[], kind: BusyKind, work: () => Promise<void>) => {
    setBusy((prev) => withEntries(prev, ids, kind))
    return work().finally(async () => {
      await queryClient.invalidateQueries({ queryKey: keys.containers })
      setBusy((prev) => withEntries(prev, ids, null))
    })
  }

  const act = (container: ContainerSummary, action: ContainerAction) => {
    void withBusy([container.id], action, async () => {
      try {
        await containerActionFn({ data: { id: container.id, action } })
      } catch (err) {
        toastManager.add({
          type: 'error',
          title: `Could not ${VERBS[action]} ${container.name}`,
          description: messageOf(err),
        })
      }
    })
  }

  /** Runs one action on each container, in order. Failures are counted and reported once at the end. */
  const actAll = (containers: readonly ContainerSummary[], action: BulkAction) => {
    if (containers.length === 0) return
    void withBusy(
      containers.map((container) => container.id),
      action,
      async () => {
        let failed = 0
        let firstError = ''
        for (const container of containers) {
          try {
            await containerActionFn({ data: { id: container.id, action } })
          } catch (err) {
            failed += 1
            if (!firstError) firstError = messageOf(err)
          }
        }
        if (failed > 0) {
          toastManager.add({
            type: 'error',
            title: `Could not ${VERBS[action]} ${countLabel(failed, 'container')}`,
            description: firstError,
          })
        }
      },
    )
  }

  /** `onRemoved` runs once the container is gone (the detail page leaves its own URL then). */
  const remove = (
    container: ContainerSummary,
    options: { force: boolean; volumes: boolean },
    onRemoved?: () => void,
  ) => {
    const notify = () => onRemoved?.()
    void withBusy([container.id], 'remove', async () => {
      try {
        await removeContainerFn({ data: { id: container.id, force: options.force, volumes: options.volumes } })
        toastManager.add({ type: 'success', title: 'Container removed', description: container.name })
        notify()
      } catch (err) {
        toastManager.add({
          type: 'error',
          title: `Could not remove ${container.name}`,
          description: messageOf(err),
        })
      }
    })
  }

  return { busy, act, actAll, remove }
}
