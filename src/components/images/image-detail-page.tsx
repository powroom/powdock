import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { CopyIcon, MoreHorizontalIcon, Trash2Icon } from 'lucide-react'
import { useState } from 'react'
import {
  Copyable,
  DateTimeText,
  EnvironmentList,
  Field,
  Fields,
  LabelsSection,
  Section,
  SectionsSkeleton,
  Text,
} from '@/components/app/detail-fields'
import { copyWithToast } from '@/components/app/copy-feedback'
import { ImageIcon } from '@/components/app/image-icon'
import { RelativeTime } from '@/components/app/relative-time'
import { useImageStacks } from '@/components/app/use-image-stacks'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Empty, EmptyContent, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { Menu, MenuItem, MenuPopup, MenuSeparator, MenuTrigger } from '@/components/ui/menu'
import { Skeleton } from '@/components/ui/skeleton'
import { formatBytes } from '@/lib/format'
import { imageName } from '@/lib/image-view'
import { imageDetailsQuery, imagesQuery } from '@/lib/queries'
import type { IconKey } from '@/lib/image-icon'
import type { ImageDetails, ImageSummary } from '@/lib/types'
import { RemoveImageDialog } from './remove-image-dialog'
import { VulnerabilitySection } from './scan-section'

/**
 * One image: a header (name, tags, size, age, the actions) and the sections of its details. The list
 * supplies the header, and the details come from their own query.
 */
export function ImageDetailPage({ id }: { id: string }) {
  const list = useQuery(imagesQuery())
  // The URL holds the short id (or, from an old link, the full one).
  const image = list.data?.find((item) => item.id === id || item.shortId === id)
  const stacks = useImageStacks(image ? [image.id] : [])
  const details = useQuery({ ...imageDetailsQuery(image?.id ?? ''), enabled: Boolean(image) })
  const navigate = useNavigate()
  const [removeOpen, setRemoveOpen] = useState(false)

  return (
    <div className="flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      {list.isPending && <HeaderSkeleton />}

      {list.error && !list.data && (
        <Alert variant="error">
          <AlertTitle>Could not load the image</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void list.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {!list.isPending && !image && !list.error && (
        <Empty className="rounded-lg border bg-card">
          <EmptyHeader>
            <EmptyTitle>This image no longer exists.</EmptyTitle>
          </EmptyHeader>
          <EmptyContent>
            <Button render={<Link to="/images" />} variant="outline">
              Back to images
            </Button>
          </EmptyContent>
        </Empty>
      )}

      {image && (
        <>
          <Header image={image} onRemove={() => setRemoveOpen(true)} stack={stacks[image.id] ?? null} />

          <VulnerabilitySection imageId={image.id} />
          {details.data ? (
            <Details details={details.data} />
          ) : details.error ? (
            <Alert variant="error">
              <AlertTitle>Could not load the details</AlertTitle>
              <AlertDescription>{details.error.message}</AlertDescription>
              <AlertAction>
                <Button onClick={() => void details.refetch()} size="sm" variant="outline">
                  Retry
                </Button>
              </AlertAction>
            </Alert>
          ) : (
            <SectionsSkeleton rows={[6, 5, 3]} />
          )}

          <RemoveImageDialog
            image={image}
            onOpenChange={setRemoveOpen}
            onRemoved={() => void navigate({ to: '/images' })}
            open={removeOpen}
          />
        </>
      )}
    </div>
  )
}

function Header({
  image,
  stack,
  onRemove,
}: {
  image: ImageSummary
  /** the icon the image's config names (see useImageStacks) */
  stack: IconKey | null
  onRemove: () => void
}) {
  const name = imageName(image)
  const title = image.dangling ? image.shortId : image.repository

  return (
    <header className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        {/* the name takes the full width on a phone, so the actions wrap below it */}
        <div className="flex min-w-0 flex-1 items-start gap-3 max-sm:basis-full">
          <ImageIcon image={name ?? image.id} name={title} size={36} stack={stack} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h1 className="min-w-0 truncate font-heading font-semibold text-xl tracking-tight" title={title}>
              {title}
            </h1>
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              {image.dangling && (
                <Badge size="sm" variant="outline">
                  Dangling
                </Badge>
              )}
              {image.tags.map((tag) => (
                <Badge className="max-w-60 truncate" key={tag} size="sm" variant="secondary">
                  {tag}
                </Badge>
              ))}
            </div>
            <p className="text-muted-foreground text-sm">
              <span className="tabular-nums">{formatBytes(image.size)}</span> · Created{' '}
              <RelativeTime value={image.createdAt} />
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Menu>
            <MenuTrigger render={<Button aria-label={`More actions for ${title}`} size="icon-sm" variant="outline" />}>
              <MoreHorizontalIcon aria-hidden="true" />
            </MenuTrigger>
            <MenuPopup align="end">
              <MenuItem onClick={() => void copyWithToast(image.id, 'Image ID copied', image.shortId)}>
                <CopyIcon aria-hidden="true" />
                Copy ID
              </MenuItem>
              <MenuItem
                disabled={!name}
                onClick={() => {
                  if (name) void copyWithToast(name, 'Image name copied', name)
                }}
              >
                <CopyIcon aria-hidden="true" />
                Copy name
              </MenuItem>
              <MenuSeparator />
              <MenuItem onClick={onRemove} variant="destructive">
                <Trash2Icon aria-hidden="true" />
                Remove
              </MenuItem>
            </MenuPopup>
          </Menu>
        </div>
      </div>
    </header>
  )
}

/** The header's size while the image list loads: the same rows, so the page does not move. */
function HeaderSkeleton() {
  return (
    <div aria-busy="true" className="flex min-w-0 items-start gap-3">
      <Skeleton className="size-9 shrink-0 rounded-lg" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 pt-1">
        <Skeleton className="h-5 w-56 max-w-full" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
    </div>
  )
}

function Details({ details }: { details: ImageDetails }) {
  const platform = [details.os, details.architecture, details.variant].filter(Boolean).join('/')
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <Section title="Overview">
        <Fields>
          <Field label="Tags">
            {details.tags.length === 0 ? (
              <Text muted>None (dangling)</Text>
            ) : (
              <ul className="flex min-w-0 flex-col gap-1">
                {details.tags.map((tag) => (
                  <li className="flex min-w-0" key={tag}>
                    <Copyable label="tag" value={tag} />
                  </li>
                ))}
              </ul>
            )}
          </Field>
          <Field label="ID">
            <Copyable label="image ID" value={details.id} />
          </Field>
          <Field label="Created">
            <DateTimeText value={details.createdAt} />
          </Field>
          <Field label="Size">
            <Text>{formatBytes(details.size)}</Text>
          </Field>
          <Field label="Platform">
            <Text>{platform || '-'}</Text>
          </Field>
          <Field label="Author">
            <Text>{details.author || '-'}</Text>
          </Field>
          <Field label="Layers">
            <Text>{details.layers}</Text>
          </Field>
        </Fields>
      </Section>

      <Section title="Runtime">
        <Fields>
          <Field label="Entrypoint">
            <Copyable label="entrypoint" value={details.entrypoint.join(' ')} />
          </Field>
          <Field label="Command">
            <Copyable label="command" value={details.cmd.join(' ')} />
          </Field>
          <Field label="Working dir">
            <Copyable label="working directory" value={details.workingDir} />
          </Field>
          <Field label="User">
            <Text>{details.user || 'default'}</Text>
          </Field>
          <Field label="Exposed">
            <Text>{details.exposedPorts.length === 0 ? 'None' : details.exposedPorts.join(', ')}</Text>
          </Field>
        </Fields>
      </Section>

      <Section title="Environment">
        <EnvironmentList variables={details.env} />
      </Section>

      <LabelsSection labels={details.labels} />

      <Section title={`History (${details.history.length})`}>
        {details.history.length === 0 ? (
          <Text muted>No history</Text>
        ) : (
          <ol className="flex min-w-0 flex-col gap-1.5">
            {details.history.map((step, index) => (
              <li
                className="grid min-w-0 grid-cols-[4.5rem_minmax(0,1fr)] gap-x-3 text-xs"
                key={`${index}|${step.createdBy}`}
              >
                <span className={step.size === 0 ? 'tabular-nums text-muted-foreground' : 'tabular-nums'}>
                  {step.size === 0 ? '0 B' : formatBytes(step.size)}
                </span>
                <span className="truncate font-mono text-muted-foreground" title={step.createdBy || undefined}>
                  {step.createdBy || '(no command)'}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Section>
    </div>
  )
}
