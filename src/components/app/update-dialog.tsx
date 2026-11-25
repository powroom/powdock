import { useQuery } from '@tanstack/react-query'
import { CircleArrowUpIcon, ExternalLinkIcon } from 'lucide-react'
import { useRef, useState } from 'react'
import { CopyButton } from '@/components/app/copy-button'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { updateInfoQuery } from '@/lib/queries'
import { parseReleaseNotes } from '@/lib/release-notes'
import type { Inline } from '@/lib/release-notes'
import { useAppStore } from '@/lib/store'
import type { InstallMethod, ReleaseInfo, UpdateInfo } from '@/lib/version'

export type AvailableUpdate = UpdateInfo & { latest: ReleaseInfo }

/** The newer release, or null when there is none (or the check is still loading, or it is off). */
export function useAvailableUpdate(): AvailableUpdate | null {
  const { data } = useQuery(updateInfoQuery())
  return data?.latest ? { ...data, latest: data.latest } : null
}

function releaseDate(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date)
}

function Command({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 py-1.5 ps-3 pe-1.5">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{text}</code>
      <CopyButton label={`Copy ${text}`} text={text} />
    </div>
  )
}

function UpdateSteps({ install }: { install: InstallMethod }) {
  if (install === 'docker') {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>Pull the new image:</p>
        <Command text="docker pull ghcr.io/powroom/powdock:latest" />
        <p>Recreate the container with the same command you used to start it. Your data stays in the volume.</p>
        <p>With Docker Compose, run:</p>
        <Command text="docker compose pull && docker compose up -d" />
      </div>
    )
  }
  if (install === 'npm') {
    return (
      <div className="flex flex-col gap-3 text-sm">
        <p>Stop pow/dock (Ctrl+C), then start it again with:</p>
        <Command text="npx powdock@latest" />
        <p>Or with Bun:</p>
        <Command text="bunx powdock@latest" />
        <p>Your data in ~/.powdock stays.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p>In your pow/dock folder, run these:</p>
      <Command text="git pull" />
      <Command text="bun install" />
      <Command text="bun run build" />
      <p>Then restart pow/dock.</p>
    </div>
  )
}

function Inlines({ nodes }: { nodes: Inline[] }) {
  return (
    <>
      {nodes.map((node, index) => {
        if (node.type === 'bold') {
          return (
            <strong key={index}>
              <Inlines nodes={node.children} />
            </strong>
          )
        }
        if (node.type === 'code') {
          return (
            <code className="rounded bg-background px-1 font-mono text-xs" key={index}>
              {node.text}
            </code>
          )
        }
        if (node.type === 'link') {
          return (
            <a
              className="break-all underline underline-offset-2"
              href={node.href}
              key={index}
              rel="noopener noreferrer"
              target="_blank"
            >
              {node.text}
            </a>
          )
        }
        return node.text
      })}
    </>
  )
}

/** The release notes as readable text. Raw markdown is never shown, and no HTML is interpreted. */
function ReleaseNotes({ markdown }: { markdown: string }) {
  const blocks = parseReleaseNotes(markdown)
  return (
    <div className="flex max-h-56 flex-col gap-2 overflow-y-auto rounded-lg border bg-muted/40 p-3 text-sm">
      {blocks.map((block, index) => {
        if (block.type === 'heading') {
          return (
            <h4 className="font-medium text-sm" key={index}>
              <Inlines nodes={block.text} />
            </h4>
          )
        }
        if (block.type === 'list') {
          return (
            <ul className="list-disc ps-5 space-y-1" key={index}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  <Inlines nodes={item} />
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p key={index}>
            <Inlines nodes={block.text} />
          </p>
        )
      })}
    </div>
  )
}

/** The release details, the steps for this install, and Dismiss (hides the header notice for this version). */
export function UpdateDialog({
  open,
  onOpenChange,
  update,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  update: AvailableUpdate
}) {
  const setDismissed = useAppStore((s) => s.setDismissedUpdate)
  // focus starts on Close: the dialog's first focusable element is often a link at the end of the
  // release notes, and focusing it would scroll the notes to the bottom
  const closeRef = useRef<HTMLButtonElement>(null)
  const { latest, current, install } = update
  const date = releaseDate(latest.publishedAt)
  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-lg" initialFocus={closeRef}>
        <DialogHeader>
          <DialogTitle>pow/dock {latest.version} is available</DialogTitle>
          <DialogDescription>
            You have {current}.{date && ` Released ${date}.`}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel className="flex flex-col gap-6">
          {latest.notes.trim() !== '' && (
            <section className="flex flex-col gap-2">
              <h3 className="font-medium text-sm">What changed</h3>
              <ReleaseNotes markdown={latest.notes} />
            </section>
          )}
          <div>
            <Button
              render={<a href={latest.url} rel="noopener noreferrer" target="_blank" />}
              size="sm"
              variant="outline"
            >
              Release notes on GitHub
              <ExternalLinkIcon aria-hidden="true" />
            </Button>
          </div>
          <section className="flex flex-col gap-3">
            <h3 className="font-medium text-sm">How to update</h3>
            <UpdateSteps install={install} />
          </section>
        </DialogPanel>
        <DialogFooter>
          <Button
            onClick={() => {
              setDismissed(latest.version)
              onOpenChange(false)
            }}
            variant="ghost"
          >
            Dismiss
          </Button>
          <DialogClose ref={closeRef} render={<Button variant="outline" />}>
            Close
          </DialogClose>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  )
}

/** The update button in the page headers. It stays hidden for a version the user dismissed. */
export function UpdateNotice() {
  const update = useAvailableUpdate()
  const dismissed = useAppStore((s) => s.dismissedUpdate)
  const [open, setOpen] = useState(false)
  if (!update || update.latest.version === dismissed) return null
  const label = `pow/dock ${update.latest.version} is available`
  return (
    <>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label={label}
              className="text-info-foreground"
              onClick={() => setOpen(true)}
              size="sm"
              variant="ghost"
            />
          }
        >
          <CircleArrowUpIcon aria-hidden="true" />
          <span className="max-sm:hidden">Update</span>
        </TooltipTrigger>
        <TooltipPopup>{label}</TooltipPopup>
      </Tooltip>
      <UpdateDialog onOpenChange={setOpen} open={open} update={update} />
    </>
  )
}
