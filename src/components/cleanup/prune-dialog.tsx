import { useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
import { toastManager } from '@/components/ui/toast'
import { pruneToast } from '@/lib/cleanup-view'
import { keys } from '@/lib/queries'
import type { PruneResult } from '@/lib/types'

/** After any prune, the disk usage and every list a prune can change are refreshed. */
function refreshAfterPrune(queryClient: QueryClient) {
  return Promise.all(
    [keys.cleanup, keys.containers, keys.images, keys.volumes, keys.networks].map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  )
}

export interface PruneDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  /** What goes and how much space is expected */
  description: ReactNode
  /** The label of the destructive button */
  confirmLabel: string
  /** The singular name of what is removed, for the toast: "image", "volume" and so on */
  noun: string
  /** A box the user must tick before the button turns on, such as "I understand the data is deleted" */
  acknowledgement?: string
  /** Runs the prune. A rejected call shows Docker's message inside this dialog. */
  run: () => Promise<PruneResult>
  children?: ReactNode
}

/**
 * The confirmation for one prune. It runs the prune, shows the result as a toast, refreshes the lists, and keeps
 * Docker's error inside the dialog. The dialog cannot be closed while the prune runs.
 */
export function PruneDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  noun,
  acknowledgement,
  run,
  children,
}: PruneDialogProps) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [acknowledged, setAcknowledged] = useState(false)
  // Each opening starts clear. Adjusted during render, as in the other dialogs.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setFailure(null)
      setAcknowledged(false)
    }
  }

  const confirm = () => {
    setBusy(true)
    setFailure(null)
    void run().then(
      (result) => {
        setBusy(false)
        toastManager.add(pruneToast(result, noun))
        void refreshAfterPrune(queryClient)
        onOpenChange(false)
      },
      (err: unknown) => {
        setBusy(false)
        setFailure(err instanceof Error ? err.message : 'Unknown error.')
        void refreshAfterPrune(queryClient)
      },
    )
  }

  const handleOpenChange = (next: boolean) => {
    if (!next && busy) return
    onOpenChange(next)
  }

  return (
    <AlertDialog onOpenChange={handleOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        {children && <div className="flex flex-col gap-3 px-6 pb-4">{children}</div>}
        {acknowledgement && (
          <div className="px-6 pb-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={acknowledged} onCheckedChange={(checked) => setAcknowledged(checked)} />
              {acknowledgement}
            </label>
          </div>
        )}
        {failure && (
          <div className="px-6 pb-4">
            <Alert variant="error">
              <AlertTitle>Docker did not finish the cleanup</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogClose disabled={busy} render={<Button variant="ghost" />}>
            Cancel
          </AlertDialogClose>
          <Button
            disabled={acknowledgement !== undefined && !acknowledged}
            loading={busy}
            onClick={() => confirm()}
            variant="destructive"
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
