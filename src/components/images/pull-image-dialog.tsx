import { useState } from 'react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Meter, MeterIndicator, MeterTrack } from '@/components/ui/meter'
import { layerCounts, type PullLayer } from '@/lib/image-pull'
import { parseImageReference } from '@/lib/image-reference'
import { countLabel } from '@/lib/format'
import { usePullImage } from './use-pull-image'

/** The message for a name that cannot be pulled, or null when the name is fine. Empty counts as not fine. */
function problemOf(text: string): string | null {
  try {
    parseImageReference(text)
    return null
  } catch (err) {
    return err instanceof Error ? err.message : 'Invalid image name.'
  }
}

function percentOf(layer: Pick<PullLayer, 'current' | 'total' | 'done'>): number {
  if (layer.done) return 100
  if (layer.total <= 0) return 0
  return Math.min(100, (layer.current / layer.total) * 100)
}

/**
 * Pulls an image by name. The name is checked with the same parser as the server. The error shows
 * only after the user types or tries to pull, never on blur or on close. Progress is one row per layer.
 * Closing the dialog cancels a running pull.
 */
export function PullImageDialog({
  open,
  onOpenChange,
  onPulled,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onPulled: () => void
}) {
  const [text, setText] = useState('')
  const [typed, setTyped] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const pull = usePullImage(onPulled)
  // Each opening starts empty. Adjusted during render, as in the other dialogs.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setText('')
      setTyped(false)
      setSubmitted(false)
      pull.reset()
    }
  }

  const problem = problemOf(text)
  const showProblem = (typed || submitted) && problem !== null
  const { phase, progress, failure } = pull.state
  const pulling = phase === 'pulling'
  const counts = layerCounts(progress)
  const overall = counts.total > 0 ? (counts.done / counts.total) * 100 : 0

  const submit = () => {
    setSubmitted(true)
    if (problem !== null || pulling) return
    pull.start(text)
  }

  const close = (next: boolean) => {
    if (!next) pull.cancel()
    onOpenChange(next)
  }

  return (
    <Dialog onOpenChange={close} open={open}>
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>Pull image</DialogTitle>
            <DialogDescription>Download an image from its registry, such as Docker Hub.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-4 px-6 pb-6">
            <Field>
              <FieldLabel>Image</FieldLabel>
              <Input
                aria-describedby={showProblem ? 'pull-image-error' : undefined}
                aria-invalid={showProblem || undefined}
                autoFocus
                disabled={pulling}
                onChange={(event) => {
                  setText(event.target.value)
                  setTyped(true)
                }}
                placeholder="nginx:1.27"
                spellCheck={false}
                value={text}
              />
              {showProblem && (
                <p className="text-destructive text-sm" id="pull-image-error">
                  {problem}
                </p>
              )}
            </Field>

            {phase === 'pulling' && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate text-muted-foreground">
                    {progress.message || 'Starting the pull...'}
                  </span>
                  <span className="shrink-0 tabular-nums">
                    {counts.total > 0 ? `${counts.done} of ${countLabel(counts.total, 'layer')}` : ''}
                  </span>
                </div>
                <Meter aria-label="Overall progress" value={overall}>
                  <MeterTrack>
                    <MeterIndicator />
                  </MeterTrack>
                </Meter>
              </div>
            )}

            {progress.layers.length > 0 && (
              <ul aria-label="Layers" className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                {progress.layers.map((layer) => (
                  <li
                    className="grid grid-cols-[5.5rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 text-sm"
                    key={layer.id}
                  >
                    <span className="font-mono text-muted-foreground text-xs">{layer.id}</span>
                    <span className="min-w-0 truncate">{layer.status}</span>
                    {layer.total > 0 && (
                      <Meter
                        aria-label={`Progress of layer ${layer.id}`}
                        className="col-span-2"
                        value={percentOf(layer)}
                      >
                        <MeterTrack className="h-1.5">
                          <MeterIndicator />
                        </MeterTrack>
                      </Meter>
                    )}
                  </li>
                ))}
              </ul>
            )}

            {phase === 'done' && (
              <Alert variant="success">
                <AlertTitle>Pull finished</AlertTitle>
                <AlertDescription>{progress.message}</AlertDescription>
              </Alert>
            )}
            {phase === 'failed' && (
              <Alert variant="error">
                <AlertTitle>Could not pull the image</AlertTitle>
                <AlertDescription>{failure}</AlertDescription>
              </Alert>
            )}
            {phase === 'cancelled' && <p className="text-muted-foreground text-sm">The pull was cancelled.</p>}
          </div>

          <DialogFooter>
            {pulling ? (
              <Button onClick={() => pull.cancel()} type="button" variant="ghost">
                Cancel
              </Button>
            ) : (
              <DialogClose render={<Button variant="ghost" />}>{phase === 'idle' ? 'Cancel' : 'Close'}</DialogClose>
            )}
            <Button disabled={pulling} type="submit">
              Pull
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
