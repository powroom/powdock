import { useRef, useState } from 'react'
import { Section } from '@/components/app/detail-fields'
import { AccountSettings } from '@/components/app/settings-account'
import { UpdateDialog, useAvailableUpdate } from '@/components/app/update-dialog'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { APP_VERSION } from '@/lib/version'

export function SettingsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  // The focus starts on the dialog, not on Sign out, so a stray Enter cannot sign the user out.
  const popup = useRef<HTMLDivElement>(null)
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-lg" initialFocus={popup} ref={popup}>
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>Your account and the app.</DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-6">
          <AccountSettings />
          <Section title="About">
            <div className="flex items-center justify-between gap-6">
              <span className="font-medium text-sm">Version</span>
              <VersionValue />
            </div>
          </Section>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}

/** The running version, and a button when a newer release is out. The button opens the update dialog. */
function VersionValue() {
  const update = useAvailableUpdate()
  const [open, setOpen] = useState(false)
  return (
    <>
      <span className="flex items-center gap-2">
        {update && (
          <Button onClick={() => setOpen(true)} size="sm" variant="outline">
            Update to {update.latest.version}
          </Button>
        )}
        <span className="font-mono text-sm tabular-nums">{APP_VERSION}</span>
      </span>
      {update && <UpdateDialog onOpenChange={setOpen} open={open} update={update} />}
    </>
  )
}
