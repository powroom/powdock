import { useState } from 'react'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { isActiveState } from '@/lib/container-view'
import type { ContainerSummary } from '@/lib/types'

export interface RemoveOptions {
  force: boolean
  volumes: boolean
}

/**
 * Asks before a container is removed. A running, paused or restarting container needs the force box
 * checked first. The name stays on screen while the dialog animates out.
 */
export function RemoveContainerDialog({
  container,
  open,
  onOpenChange,
  onConfirm,
}: {
  container: ContainerSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (options: RemoveOptions) => void
}) {
  const [force, setForce] = useState(false)
  const [volumes, setVolumes] = useState(false)
  // Each opening starts with both boxes clear. Adjusted during render, as in ConfirmDialog.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForce(false)
      setVolumes(false)
    }
  }

  const name = container?.name ?? ''
  const needsForce = container ? isActiveState(container.state) : false
  const blocked = needsForce && !force

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Remove container ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            The container is deleted, and whatever it wrote to its own filesystem goes with it. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-4">
          {needsForce && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={force} onCheckedChange={(checked) => setForce(checked)} />
              Stop it first (force)
            </label>
          )}
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={volumes} onCheckedChange={(checked) => setVolumes(checked)} />
            Also remove its anonymous volumes
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button disabled={blocked || !container} onClick={() => onConfirm({ force, volumes })} variant="destructive">
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
