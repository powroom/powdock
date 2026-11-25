import { useState } from 'react'
import { ConfirmDialog } from '@/components/app/confirm-dialog'
import type { useProjectRun } from '@/components/projects/use-project-run'
import type { ContainerSummary } from '@/lib/types'

const COMPOSE_TEXT = 'Pulls the new image and recreates this service.'
const STANDALONE_TEXT = 'Pulls the new image and recreates the container with the same settings. Its volumes stay.'

/**
 * The update of one container, from a badge: a confirm dialog, then the run. A container of a Compose project
 * updates its service through the project's run; any other container is recreated by pow/dock. The page
 * renders `dialog` and the run panel of `run`. Returns `ask`, which opens the dialog for a container.
 */
export function useUpdateFlow(run: ReturnType<typeof useProjectRun>) {
  const [target, setTarget] = useState<ContainerSummary | null>(null)
  const [open, setOpen] = useState(false)
  const isCompose = target !== null && target.project !== null && target.service !== null

  const ask = (container: ContainerSummary) => {
    setTarget(container)
    setOpen(true)
  }

  const dialog = (
    <ConfirmDialog
      confirmLabel="Update"
      description={isCompose ? COMPOSE_TEXT : STANDALONE_TEXT}
      onConfirm={() => {
        setOpen(false)
        if (target === null) return
        if (target.project !== null && target.service !== null) {
          run.start(target.project, 'update-service', false, target.service)
        } else {
          run.startContainerUpdate(target.id, target.name)
        }
      }}
      onOpenChange={setOpen}
      open={open}
      title={`Update ${target?.name ?? 'container'}?`}
    />
  )

  return { ask, dialog }
}
