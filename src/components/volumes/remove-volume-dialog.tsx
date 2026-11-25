import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { removeVolumeFn } from '@/api/volumes.functions'
import {
  AlertDialog,
  AlertDialogClose,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toastManager } from '@/components/ui/toast'
import { shortVolumeName } from '@/lib/volume-view'
import { keys } from '@/lib/queries'
import type { VolumeSummary } from '@/lib/types'

/**
 * Asks before a volume is removed. Docker's own refusal (for example, a volume a container started to use)
 * stays in the dialog.
 */
export function RemoveVolumeDialog({
  volume,
  open,
  onOpenChange,
}: {
  volume: VolumeSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Each opening starts clear. Adjusted during render, as in the other dialogs.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setFailure(null)
  }

  const name = volume?.name ?? ''

  const remove = () => {
    if (!volume) return
    setBusy(true)
    setFailure(null)
    void removeVolumeFn({ data: { name: volume.name, force: false } }).then(
      () => {
        setBusy(false)
        toastManager.add({ type: 'success', title: 'Volume removed', description: shortVolumeName(volume) })
        void queryClient.invalidateQueries({ queryKey: [...keys.volumes, 'list'] })
        onOpenChange(false)
      },
      (err: unknown) => {
        setBusy(false)
        setFailure(err instanceof Error ? err.message : 'Unknown error.')
      },
    )
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle className="break-all">{`Remove volume ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>Its data is deleted for good.</AlertDialogDescription>
        </AlertDialogHeader>
        {failure && (
          <div className="px-6 pb-4">
            <Alert variant="error">
              <AlertTitle>Docker did not remove the volume</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button disabled={!volume} loading={busy} onClick={() => remove()} variant="destructive">
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
