import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createVolumeFn } from '@/api/volumes.functions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toastManager } from '@/components/ui/toast'
import { isValidResourceName } from '@/lib/resource-names'
import { keys } from '@/lib/queries'

const NAME_RULE = 'Use letters, digits, dots, dashes or underscores. Start with a letter or digit.'

/** The message for a name that cannot be used, or null. An empty name is fine: Docker then picks one. */
function nameProblem(value: string): string | null {
  if (value === '' || isValidResourceName(value)) return null
  return NAME_RULE
}

/**
 * Creates a local volume. The name is optional. The error text shows only after the user types or
 * tries to create, never on blur or on close. Docker's own error stays in the dialog.
 */
export function CreateVolumeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [typed, setTyped] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  // Each opening starts empty. Adjusted during render, as in the other dialogs.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setTyped(false)
      setSubmitted(false)
      setFailure(null)
    }
  }

  const problem = nameProblem(name)
  const showProblem = (typed || submitted) && problem !== null

  const create = () => {
    setSubmitted(true)
    if (problem !== null || busy) return
    setBusy(true)
    setFailure(null)
    void createVolumeFn({ data: { name: name.trim() } }).then(
      (volume) => {
        setBusy(false)
        toastManager.add({ type: 'success', title: 'Volume created', description: volume.name })
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
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            create()
          }}
        >
          <DialogHeader>
            <DialogTitle>Create volume</DialogTitle>
            <DialogDescription>
              A named volume keeps data for containers. Leave the name empty to let Docker pick one.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 pb-6">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                aria-describedby={showProblem ? 'create-volume-error' : undefined}
                aria-invalid={showProblem || undefined}
                autoFocus
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value)
                  setTyped(true)
                }}
                placeholder="pgdata"
                spellCheck={false}
                value={name}
              />
              {showProblem && (
                <p className="text-destructive text-sm" id="create-volume-error">
                  {problem}
                </p>
              )}
            </Field>

            <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-baseline gap-x-3 text-sm">
              <span className="text-muted-foreground">Driver</span>
              <span className="font-mono">local</span>
            </div>

            {failure && (
              <Alert variant="error">
                <AlertTitle>Docker did not create the volume</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button onClick={() => onOpenChange(false)} type="button" variant="ghost">
              Cancel
            </Button>
            <Button loading={busy} type="submit">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
