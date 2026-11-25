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

/**
 * Asks before a project is taken down. The volumes box is clear each time the dialog opens, so
 * deleting data is always a choice made in that moment.
 */
export function DownDialog({
  name,
  open,
  onOpenChange,
  onConfirm,
}: {
  name: string
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: (volumes: boolean) => void
}) {
  const [volumes, setVolumes] = useState(false)
  // Adjusted during render, not in an effect, as in the remove dialog of a container.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setVolumes(false)
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Take down ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            Stops and removes the containers and networks of this project.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox checked={volumes} onCheckedChange={(checked) => setVolumes(checked)} />
            Also delete its volumes
          </label>
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button onClick={() => onConfirm(volumes)} variant="destructive">
            Down
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
