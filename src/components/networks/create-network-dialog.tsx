import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { createNetworkFn } from '@/api/networks.functions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { toastManager } from '@/components/ui/toast'
import { isValidResourceName, networkAddressProblem } from '@/lib/resource-names'
import { keys } from '@/lib/queries'

const NAME_RULE = 'Use letters, digits, dots, dashes or underscores. Start with a letter or digit.'

/** The message for a network name that cannot be used, or null. Empty is a problem: a network needs a name. */
function nameProblem(value: string): string | null {
  if (value === '') return 'Enter a name.'
  return isValidResourceName(value) ? null : NAME_RULE
}

/**
 * Creates a bridge network. The subnet and gateway are optional; a gateway needs a subnet. The errors show
 * only after the user types or tries to create, never on blur or on close. Docker's own error stays in
 * the dialog.
 */
export function CreateNetworkDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [internal, setInternal] = useState(false)
  const [subnet, setSubnet] = useState('')
  const [gateway, setGateway] = useState('')
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
      setInternal(false)
      setSubnet('')
      setGateway('')
      setTyped(false)
      setSubmitted(false)
      setFailure(null)
    }
  }

  const namePart = nameProblem(name.trim())
  const addressPart = networkAddressProblem(subnet.trim(), gateway.trim())
  const showName = (typed || submitted) && namePart !== null
  const showAddress = (typed || submitted) && addressPart !== null

  const create = () => {
    setSubmitted(true)
    if (namePart !== null || addressPart !== null || busy) return
    setBusy(true)
    setFailure(null)
    void createNetworkFn({
      data: { name: name.trim(), internal, subnet: subnet.trim(), gateway: gateway.trim() },
    }).then(
      () => {
        setBusy(false)
        toastManager.add({ type: 'success', title: 'Network created', description: name.trim() })
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
            <DialogTitle>Create network</DialogTitle>
            <DialogDescription>A bridge network lets containers talk to each other by name.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 pb-6">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                aria-describedby={showName ? 'create-network-name-error' : undefined}
                aria-invalid={showName || undefined}
                autoFocus
                disabled={busy}
                onChange={(event) => {
                  setName(event.target.value)
                  setTyped(true)
                }}
                placeholder="backend"
                spellCheck={false}
                value={name}
              />
              {showName && (
                <p className="text-destructive text-sm" id="create-network-name-error">
                  {namePart}
                </p>
              )}
            </Field>

            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <Checkbox checked={internal} disabled={busy} onCheckedChange={(checked) => setInternal(checked)} />
              Internal (no access to the outside)
            </label>

            <Field>
              <FieldLabel>Subnet</FieldLabel>
              <Input
                aria-describedby={showAddress ? 'create-network-address-error' : undefined}
                aria-invalid={showAddress || undefined}
                disabled={busy}
                onChange={(event) => {
                  setSubnet(event.target.value)
                  setTyped(true)
                }}
                placeholder="172.20.0.0/16 (optional)"
                spellCheck={false}
                value={subnet}
              />
            </Field>

            <Field>
              <FieldLabel>Gateway</FieldLabel>
              <Input
                aria-describedby={showAddress ? 'create-network-address-error' : undefined}
                aria-invalid={showAddress || undefined}
                disabled={busy}
                onChange={(event) => {
                  setGateway(event.target.value)
                  setTyped(true)
                }}
                placeholder="172.20.0.1 (optional)"
                spellCheck={false}
                value={gateway}
              />
              {showAddress && (
                <p className="text-destructive text-sm" id="create-network-address-error">
                  {addressPart}
                </p>
              )}
            </Field>

            {failure && (
              <Alert variant="error">
                <AlertTitle>Docker did not create the network</AlertTitle>
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
