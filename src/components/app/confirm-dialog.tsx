import { useState } from 'react'
import type { ReactNode } from 'react'
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
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'

interface ConfirmContent {
  title: ReactNode
  description?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  destructive?: boolean
  /** user has to type this text to enable the confirm button */
  requireText?: string
}

export function ConfirmDialog({
  open,
  onOpenChange,
  loading = false,
  onConfirm,
  ...content
}: ConfirmContent & {
  open: boolean
  onOpenChange: (open: boolean) => void
  loading?: boolean
  onConfirm: () => void
}) {
  const [typed, setTyped] = useState('')
  // each opening starts empty (a reopen while the last close still animates does not clear it otherwise)
  // Adjusted during render, not in an effect, so the cleared field is what the opening frame paints.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setTyped('')
  }
  // Keep rendering what was shown while open: parents usually clear the state
  // that drives the content at the same moment they close the dialog.
  // Compared field by field because `content` is a new object on every render.
  const [kept, setKept] = useState<ConfirmContent>(content)
  const changed =
    open &&
    (content.title !== kept.title ||
      content.description !== kept.description ||
      content.confirmLabel !== kept.confirmLabel ||
      content.cancelLabel !== kept.cancelLabel ||
      content.destructive !== kept.destructive ||
      content.requireText !== kept.requireText)
  if (changed) setKept(content)
  const shown = changed ? content : kept
  const {
    title,
    description,
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
    destructive = false,
    requireText,
  } = shown
  const blocked = Boolean(requireText) && typed !== requireText

  return (
    <AlertDialog
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) setTyped('')
      }}
      open={open}
    >
      <AlertDialogPopup>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {requireText && (
          <div className="flex flex-col gap-3 px-6 pb-4">
            <Field>
              <FieldLabel className="font-normal text-muted-foreground">
                Type <span className="font-medium font-mono text-foreground">{requireText}</span> to confirm
              </FieldLabel>
              <Input
                autoFocus
                onChange={(e) => setTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !blocked && open) onConfirm()
                }}
                spellCheck={false}
                value={typed}
              />
            </Field>
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogClose render={<Button variant="ghost" />}>{cancelLabel}</AlertDialogClose>
          <Button
            disabled={blocked}
            loading={loading}
            onClick={onConfirm}
            variant={destructive ? 'destructive' : 'default'}
          >
            {confirmLabel}
          </Button>
        </AlertDialogFooter>
      </AlertDialogPopup>
    </AlertDialog>
  )
}
