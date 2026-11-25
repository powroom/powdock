import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { useState } from 'react'
import { createProjectFn } from '@/api/projects.functions'
import { Alert, AlertDescription } from '@/components/ui/alert'
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
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { Textarea } from '@/components/ui/textarea'
import { convertDockerRun } from '@/lib/docker-run'
import { DOCKER_RUN_PLACEHOLDER, newProjectNameProblem, projectFolderText } from '@/lib/new-project'
import { keys, projectsDirQuery } from '@/lib/queries'
import { describeError } from '@/lib/redact'
import type { NewProjectSource } from '@/server/project-create.server'
import { YamlText } from './yaml-text'

/**
 * New project: a name, a folder, and the start (an empty file, or a docker run command that is
 * converted live). Create writes compose.yaml and opens the project on its Compose file tab. Nothing
 * is started. Errors show after the user types or tries to create, never on blur or on close.
 */
export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const dir = useQuery(projectsDirQuery())
  const [name, setName] = useState('')
  const [nameTouched, setNameTouched] = useState(false)
  // null: the default folder under the projects folder. Set once the user presses Change.
  const [folderOverride, setFolderOverride] = useState<string | null>(null)
  const [source, setSource] = useState<NewProjectSource>('empty')
  const [command, setCommand] = useState('')
  const [commandTouched, setCommandTouched] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const [pending, setPending] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  // Each opening starts empty. Adjusted during render, as in the other dialogs.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setName('')
      setNameTouched(false)
      setFolderOverride(null)
      setSource('empty')
      setCommand('')
      setCommandTouched(false)
      setSubmitted(false)
      setServerError(null)
    }
  }

  const folderDefault = projectFolderText(dir.data ?? '', name)
  const folder = folderOverride ?? folderDefault
  const nameProblem = newProjectNameProblem(name)
  const showNameProblem = (nameTouched || submitted) && nameProblem !== null
  const conversion = source === 'docker-run' ? convertDockerRun(command) : null
  const commandProblem = conversion?.error ?? null
  const showCommandProblem = (commandTouched || submitted) && commandProblem !== null

  const submit = async () => {
    setSubmitted(true)
    setServerError(null)
    if (pending || nameProblem !== null || commandProblem !== null) return
    setPending(true)
    const result = await createProjectFn({ data: { name, folder, source, command } }).catch((err: unknown) => ({
      ok: false as const,
      error: describeError(err),
    }))
    setPending(false)
    if (!result.ok) {
      setServerError(result.error)
      return
    }
    void queryClient.invalidateQueries({ queryKey: keys.projects })
    void queryClient.invalidateQueries({ queryKey: keys.containers })
    onOpenChange(false)
    void navigate({ to: '/projects/$name', params: { name: result.name }, search: { tab: 'compose' } })
  }

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogPopup className="sm:max-w-lg">
        <form
          className="flex min-h-0 flex-col"
          noValidate
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>Make a folder with a Compose file. Nothing is started.</DialogDescription>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-4 overflow-y-auto px-6 pb-6">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                aria-describedby={showNameProblem ? 'new-project-name-error' : undefined}
                aria-invalid={showNameProblem || undefined}
                autoComplete="off"
                autoFocus
                onChange={(event) => {
                  setName(event.target.value)
                  setNameTouched(true)
                }}
                placeholder="web"
                spellCheck={false}
                value={name}
              />
              {showNameProblem && (
                <p className="text-destructive text-sm" id="new-project-name-error">
                  {nameProblem}
                </p>
              )}
            </Field>

            {/* min-w-0 so a long folder path truncates instead of widening the dialog */}
            <Field className="min-w-0">
              <FieldLabel>Folder</FieldLabel>
              {folderOverride === null ? (
                <div className="flex w-full min-w-0 items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-mono text-sm" title={folder}>
                    {folder}
                  </p>
                  <Button
                    disabled={dir.isPending}
                    onClick={() => setFolderOverride(folderDefault)}
                    size="sm"
                    variant="outline"
                  >
                    Change
                  </Button>
                </div>
              ) : (
                <Input
                  aria-label="Folder"
                  autoComplete="off"
                  onChange={(event) => setFolderOverride(event.target.value)}
                  spellCheck={false}
                  value={folderOverride}
                />
              )}
              <FieldDescription>It must not exist yet, or be empty.</FieldDescription>
            </Field>

            <Field>
              <FieldLabel>Start from</FieldLabel>
              <RadioGroup
                aria-label="Start from"
                className="gap-2"
                onValueChange={(value) => setSource(value as NewProjectSource)}
                value={source}
              >
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Radio value="empty" />
                  Empty file
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <Radio value="docker-run" />A docker run command
                </label>
              </RadioGroup>
            </Field>

            {conversion && (
              <>
                <Field>
                  <FieldLabel>docker run command</FieldLabel>
                  <Textarea
                    aria-describedby={showCommandProblem ? 'new-project-command-error' : undefined}
                    aria-invalid={showCommandProblem || undefined}
                    aria-label="docker run command"
                    onChange={(event) => {
                      setCommand(event.target.value)
                      setCommandTouched(true)
                    }}
                    placeholder={DOCKER_RUN_PLACEHOLDER}
                    rows={3}
                    spellCheck={false}
                    value={command}
                  />
                  {showCommandProblem && (
                    <p className="text-destructive text-sm" id="new-project-command-error">
                      {commandProblem}
                    </p>
                  )}
                </Field>

                {!conversion.error && (
                  <div className="flex min-w-0 flex-col gap-2">
                    <p className="font-medium text-sm">Compose file</p>
                    <YamlText label="Compose file preview" text={conversion.yaml} />
                    {conversion.notConverted.length > 0 && (
                      <p className="text-muted-foreground text-xs">
                        Not converted: {conversion.notConverted.join(', ')}. Add these by hand in the editor.
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {serverError !== null && (
              <Alert variant="error">
                <AlertDescription>{serverError}</AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="ghost" />}>Cancel</DialogClose>
            <Button disabled={pending || dir.isPending} type="submit">
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogPopup>
    </Dialog>
  )
}
