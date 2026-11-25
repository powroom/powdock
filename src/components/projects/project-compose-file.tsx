import { useQuery, useQueryClient } from '@tanstack/react-query'
import { FileTextIcon } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { EmptyState } from '@/components/app/empty-state'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { Toolbar } from '@/components/ui/toolbar'
import { saveProjectFileFn } from '@/api/projects.functions'
import { describeError } from '@/lib/redact'
import { projectFilesQuery } from '@/lib/queries'
import type { ProjectFile, SaveResult } from '@/server/project-files.server'

// CodeMirror is loaded only when this tab shows a file (see code-editor.tsx).
const CodeEditor = lazy(() => import('./code-editor').then((module) => ({ default: module.CodeEditor })))

const COMPOSE_MISSING = 'Needs the docker compose command on this machine.'
const UNREADABLE = 'pow/dock cannot read this file from here.'
const READ_ONLY = 'This file is read only.'

/** What the user typed in a file: the text now, and the text and version the editing started from. */
interface Edit {
  draft: string
  startText: string
  startHash: string
}

/** Why the last save failed. `jump` moves the editor to the line a Compose check named. */
interface Notice {
  path: string
  kind: 'conflict' | 'invalid' | 'refused'
  message: string
  jump: { line: number } | null
}

function fileLabel(path: string): string {
  return path.split('/').pop() ?? path
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

/** The save request as an answer. A network or server failure is a refusal with its message. */
function requestSave(name: string, path: string, edit: Edit): Promise<SaveResult> {
  return saveProjectFileFn({
    data: { name, path, content: edit.draft, baseHash: edit.startHash },
  }).catch((err: unknown): SaveResult => ({ ok: false, reason: 'refused', message: describeError(err), line: null }))
}

/**
 * The files of the project in editors: its Compose file (or files), and .env when there is one. Edits
 * are kept in this tab until they are saved or discarded. A save checks a Compose file first. Read
 * only when the project is generated (until "Edit anyway"), when the file cannot be written, or when
 * Compose is not available.
 */
export function ProjectComposeFile({
  name,
  generated,
  composeAvailable,
  applyReason,
  onApply,
}: {
  name: string
  generated: boolean
  composeAvailable: boolean
  /** why "Save and apply" cannot run now, or null when it can */
  applyReason: string | null
  onApply: () => void
}) {
  const queryClient = useQueryClient()
  const files = useQuery(projectFilesQuery(name))
  const [selected, setSelected] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, Edit>>({})
  const [notice, setNotice] = useState<Notice | null>(null)
  const [unlocked, setUnlocked] = useState(false)
  const [saving, setSaving] = useState(false)

  if (files.isPending) {
    return (
      <div aria-busy="true" aria-label="Loading the Compose file" className="flex flex-col gap-2">
        <Skeleton className="h-4 w-80 max-w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (files.error) {
    return (
      <Alert variant="error">
        <AlertTitle>Could not read the Compose file</AlertTitle>
        <AlertDescription>{files.error.message}</AlertDescription>
      </Alert>
    )
  }
  if (files.data.length === 0) {
    return (
      <EmptyState
        description="Its config files are not known here."
        icon={FileTextIcon}
        title="No Compose file to show"
      />
    )
  }

  const current: ProjectFile = files.data.find((file) => file.path === selected) ?? files.data[0]!
  const path = current.path
  const edit = edits[path]
  const dirty = edit !== undefined && edit.draft !== edit.startText
  const value = edit !== undefined ? edit.draft : (current.text ?? '')
  const lockedByGenerated = generated && !unlocked
  let readOnlyReason: string | null = null
  if (!composeAvailable) readOnlyReason = COMPOSE_MISSING
  else if (current.text === null) readOnlyReason = UNREADABLE
  else if (!current.writable) readOnlyReason = READ_ONLY
  const readOnly = readOnlyReason !== null || lockedByGenerated
  const shownNotice = notice !== null && notice.path === path ? notice : null

  const changeText = (text: string) => {
    setEdits((prev) => {
      const before = prev[path]
      return {
        ...prev,
        [path]: {
          draft: text,
          startText: before?.startText ?? current.text ?? '',
          startHash: before?.startHash ?? current.hash ?? '',
        },
      }
    })
  }

  const discard = () => {
    setEdits((prev) => without(prev, path))
    setNotice(null)
  }

  const reload = () => {
    discard()
    void queryClient.invalidateQueries({ queryKey: projectFilesQuery(name).queryKey })
  }

  const save = async (andApply: boolean) => {
    if (!edit || !dirty || readOnly || saving) return
    setSaving(true)
    setNotice(null)
    const result = await requestSave(name, path, edit)
    setSaving(false)
    if (!result.ok) {
      setNotice({
        path,
        kind: result.reason === 'conflict' ? 'conflict' : result.reason === 'invalid' ? 'invalid' : 'refused',
        message: result.message,
        jump: result.line === null ? null : { line: result.line },
      })
      return
    }
    queryClient.setQueryData<ProjectFile[]>(projectFilesQuery(name).queryKey, (old) =>
      old?.map((file) => (file.path === path ? { ...file, text: result.text, hash: result.hash } : file)),
    )
    setEdits((prev) => without(prev, path))
    if (andApply) onApply()
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      {files.data.length > 1 && (
        <Tabs onValueChange={(next) => setSelected(String(next))} value={path}>
          <TabsList size="sm">
            {files.data.map((file) => (
              <TabsTab className="grow-0" key={file.path} title={file.path} value={file.path}>
                {fileLabel(file.path)}
              </TabsTab>
            ))}
          </TabsList>
        </Tabs>
      )}

      {generated && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Made by another tool. Changes here can be overwritten.</span>
          {!unlocked && (
            <Button onClick={() => setUnlocked(true)} size="sm" variant="link">
              Edit anyway
            </Button>
          )}
        </div>
      )}

      {readOnlyReason !== null && <p className="text-muted-foreground text-sm">{readOnlyReason}</p>}

      {shownNotice && (
        <Alert variant="error">
          <AlertTitle>
            {shownNotice.kind === 'conflict'
              ? 'The file changed'
              : shownNotice.kind === 'invalid'
                ? 'Compose rejected the file'
                : 'The file was not saved'}
          </AlertTitle>
          <AlertDescription>
            <span className="block whitespace-pre-wrap break-words font-mono text-xs">{shownNotice.message}</span>
          </AlertDescription>
          {shownNotice.kind === 'conflict' && (
            <AlertAction>
              <Button onClick={reload} size="sm" variant="outline">
                Reload
              </Button>
            </AlertAction>
          )}
        </Alert>
      )}

      <Frame>
        <Toolbar className="flex-wrap items-center border-0 bg-transparent p-1.5">
          <p className="min-w-0 flex-1 truncate font-mono text-muted-foreground text-xs" title={path}>
            {/* the folder is already in the page header; the full path stays in the title */}
            {fileLabel(path)}
          </p>
          {dirty && !readOnly && (
            <div className="flex flex-wrap items-center gap-2">
              <Button disabled={saving} onClick={discard} size="sm" variant="ghost">
                Discard
              </Button>
              <Button disabled={saving} onClick={() => void save(false)} size="sm" variant="outline">
                Save
              </Button>
              <Button disabled={saving || applyReason !== null} onClick={() => void save(true)} size="sm">
                Save and apply
              </Button>
            </div>
          )}
        </Toolbar>

        <FramePanel className="overflow-hidden p-0">
          <div className="flex h-[min(70svh,40rem)] min-h-64 min-w-0 flex-col overflow-hidden">
            <Suspense fallback={<Skeleton className="h-full w-full" />}>
              <CodeEditor
                jump={shownNotice?.jump ?? null}
                key={path}
                label={`Contents of ${path}`}
                language={fileLabel(path) === '.env' ? 'plain' : 'yaml'}
                onChange={changeText}
                onSave={() => void save(false)}
                readOnly={readOnly}
                value={value}
              />
            </Suspense>
          </div>
        </FramePanel>
      </Frame>
    </div>
  )
}
