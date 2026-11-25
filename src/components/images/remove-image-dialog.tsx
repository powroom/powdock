import { useQueryClient } from '@tanstack/react-query'
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { toastManager } from '@/components/ui/toast'
import { removeImageFn } from '@/api/images.functions'
import { countLabel } from '@/lib/format'
import { imageName } from '@/lib/image-view'
import { keys } from '@/lib/queries'
import type { ImageSummary } from '@/lib/types'

/** Removes the image. Resolves to the error text (Docker's own message), or null on success. */
async function deleteImage(ref: string, force: boolean): Promise<string | null> {
  return removeImageFn({ data: { ref, force } }).then(
    () => null,
    (err: unknown) => (err instanceof Error ? err.message : 'Unknown error.'),
  )
}

/** What Remove will do: untag one of several tags, or delete the image, and what blocks it. */
function describeRemoval(image: ImageSummary | null, inUse: number): string {
  if (image && image.tags.length > 1) {
    return `This removes the tag ${image.tags[0]}. The image stays, because ${countLabel(image.tags.length - 1, 'other tag')} still point to it.`
  }
  if (inUse > 0) {
    return `${countLabel(inUse, 'container')} ${inUse === 1 ? 'uses' : 'use'} this image. Force removal works for stopped containers only: Docker refuses while one of them runs. The image can be pulled again later.`
  }
  return 'The image is deleted from this Docker host. You can pull it again later.'
}

/**
 * Asks before an image is removed. When containers use the image, the dialog says how many and offers
 * the force box. Docker's own refusal (for example, a running container) stays in the dialog.
 */
export function RemoveImageDialog({
  image,
  open,
  onOpenChange,
  onRemoved,
}: {
  image: ImageSummary | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** runs after the image is removed (the details page leaves for the list) */
  onRemoved?: () => void
}) {
  const queryClient = useQueryClient()
  const [force, setForce] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Each opening starts clear. Adjusted during render, as in the other dialogs.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setForce(false)
      setFailure(null)
    }
  }

  const name = image ? (imageName(image) ?? image.shortId) : ''
  const inUse = image?.containers ?? 0

  const remove = () => {
    if (!image) return
    // the tag the row shows; an image without tags is removed by its ID
    const ref = image.tags[0] ?? image.id
    setBusy(true)
    setFailure(null)
    void deleteImage(ref, force).then((error) => {
      setBusy(false)
      if (error) {
        setFailure(error)
        return
      }
      toastManager.add({ type: 'success', title: 'Image removed', description: name })
      void queryClient.invalidateQueries({ queryKey: keys.images })
      onOpenChange(false)
      onRemoved?.()
    })
  }

  return (
    <AlertDialog onOpenChange={onOpenChange} open={open}>
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{`Remove image ${name}?`}</AlertDialogTitle>
          <AlertDialogDescription>{describeRemoval(image, inUse)}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-3 px-6 pb-4">
          {inUse > 0 && (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={force} onCheckedChange={(checked) => setForce(checked)} />
              Force remove
            </label>
          )}
          {failure && (
            <Alert variant="error">
              <AlertTitle>Docker did not remove the image</AlertTitle>
              <AlertDescription>{failure}</AlertDescription>
            </Alert>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>Cancel</AlertDialogClose>
          <Button disabled={!image} loading={busy} onClick={() => void remove()} variant="destructive">
            Remove
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
