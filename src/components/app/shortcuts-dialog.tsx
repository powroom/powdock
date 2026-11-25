import { Fragment } from 'react'
import { Dialog, DialogDescription, DialogHeader, DialogPanel, DialogPopup, DialogTitle } from '@/components/ui/dialog'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { modKey } from '@/hooks/use-hotkey'

/** A key combination is a list of keys. "Mod" is Cmd on macOS and Ctrl elsewhere. */
const ROWS: { label: string; keys: string[] }[] = [
  { label: 'Open the command palette', keys: ['Mod', 'K'] },
  { label: 'Show or hide the sidebar', keys: ['Mod', 'B'] },
  { label: 'Show keyboard shortcuts', keys: ['?'] },
]

function keyLabel(key: string): string {
  return key === 'Mod' ? modKey : key
}

export function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Shortcuts that work anywhere in pow/dock.</DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <div className="flex flex-col divide-y rounded-xl border">
            {ROWS.map((row) => (
              <div className="flex items-center justify-between gap-4 px-3.5 py-2.5" key={row.label}>
                <span className="text-sm">{row.label}</span>
                <KbdGroup>
                  {row.keys.map((key, index) => (
                    <Fragment key={key}>
                      {index > 0 && <span className="text-muted-foreground text-xs">+</span>}
                      <Kbd>{keyLabel(key)}</Kbd>
                    </Fragment>
                  ))}
                </KbdGroup>
              </div>
            ))}
          </div>
        </DialogPanel>
      </DialogPopup>
    </Dialog>
  )
}
