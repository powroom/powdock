import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { removeNetworkFn } from '@/api/networks.functions'
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
import { keys } from '@/lib/queries'
import type { NetworkSummary } from '@/lib/types'

/**
 * Asks before a network is removed. Docker's own refusal (for example, a container that joined while the
 * page was open) stays in the dialog.
 */
export function RemoveNetworkDialog({
  network,
  open,
  onOpenChange,
}: {
  network: NetworkSummary | null
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

  const name = network?.name ?? ''

  const remove = () => {
    if (!network) return
    setBusy(true)
    setFailure(null)
    void removeNetworkFn({ data: { id: network.id } }).then(
      () => {
        setBusy(false)
        toastManager.add({ type: 'success', title: 'Network removed', description: network.name })
        void queryClient.invalidateQueries({ queryKey: [...keys.networks, 'list'] })
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
          <AlertDialogTitle className="break-all">{`Remove network ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>
            The network is deleted, and its subnet is released for other networks.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failure && (
          <div className="px-6 pb-4">
            <Alert variant="error">
              <AlertTitle>Docker did not remove the network</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button disabled={!network} loading={busy} onClick={() => remove()} variant="destructive">
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
