import { useQuery } from '@tanstack/react-query'
import { BoxIcon, DatabaseIcon, HammerIcon, LayersIcon, NetworkIcon } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import {
  pruneBuildCacheFn,
  pruneContainersFn,
  pruneImagesFn,
  pruneNetworksFn,
  pruneVolumesFn,
} from '@/api/cleanup.functions'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Radio, RadioGroup } from '@/components/ui/radio-group'
import { Skeleton } from '@/components/ui/skeleton'
import { isStoppedState } from '@/lib/cleanup-view'
import { countLabel, formatBytes } from '@/lib/format'
import { containersQuery, networksQuery, volumesQuery } from '@/lib/queries'
import { shortVolumeName, sortVolumes } from '@/lib/volume-view'
import type { BuildCacheUsage, ContainerUsage, ImageUsage, VolumeUsage } from '@/lib/types'
import { ActionButton, CategoryCard, pending } from './category-card'
import { PruneDialog } from './prune-dialog'

// Every card renders the same markup with or without its usage. While the usage loads (`usage` undefined), the
// numbers are one-line skeletons and the actions are off, so the card keeps the height it has with data. The
// labels and explanations carry no numbers, so they never change. The dialogs are mounted only with the data.

/** The reason an action is off, or null when there is something to remove. */
const nothingTo = (count: number): string | null => (count === 0 ? 'Nothing to remove' : null)

/** The build cache card. The choice decides which cache the action removes. */
export function BuildCacheCard({ usage }: { usage?: BuildCacheUsage }) {
  const [choice, setChoice] = useState<'week' | 'all'>('week')
  const [open, setOpen] = useState(false)
  const week = choice === 'week'
  const bytes = usage && (week ? usage.olderThanWeek : usage.reclaimable)
  const count = usage && (week ? usage.olderThanWeekCount : usage.reclaimableCount)

  return (
    <CategoryCard
      explanation="Build cache holds the layers that image builds reuse. After clearing it, the next builds take longer, but they still work."
      freeable={pending(bytes === undefined ? undefined : `about ${formatBytes(bytes)}`)}
      freeBytes={bytes}
      icon={HammerIcon}
      options={
        <RadioGroup
          aria-label="Which build cache to clear"
          className="gap-2"
          onValueChange={(value) => setChoice(value as 'week' | 'all')}
          value={choice}
        >
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Radio value="week" />
            Older than a week
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Radio value="all" />
            Everything unused
          </label>
        </RadioGroup>
      }
      title="Build cache"
      usedBytes={usage?.total}
      uses={pending(usage && formatBytes(usage.total))}
    >
      <ActionButton
        loading={!usage}
        onClick={() => setOpen(true)}
        reason={usage && nothingTo(count ?? 0)}
        variant="outline"
      >
        Clear build cache
      </ActionButton>
      {usage && (
        <PruneDialog
          confirmLabel="Clear build cache"
          description={`This removes ${countLabel(count ?? 0, 'cache item')}, about ${formatBytes(bytes ?? 0)}. ${
            week
              ? 'Only cache that no build has used for more than a week is removed.'
              : 'Cache that no build uses now is removed, whatever its age.'
          } Later builds may take longer.`}
          noun="build cache item"
          onOpenChange={setOpen}
          open={open}
          run={() => pruneBuildCacheFn({ data: { olderThanWeek: week } })}
          title={week ? 'Clear build cache older than a week?' : 'Clear all unused build cache?'}
        />
      )}
    </CategoryCard>
  )
}

type ImageKind = 'dangling' | 'unused'

/** The images card: dangling images, or every image that no container uses. */
export function ImagesCard({ usage }: { usage?: ImageUsage }) {
  const [kind, setKind] = useState<ImageKind>('dangling')
  const [open, setOpen] = useState(false)
  const openFor = (next: ImageKind) => {
    setKind(next)
    setOpen(true)
  }
  const dangling = kind === 'dangling'

  return (
    <CategoryCard
      explanation="Dangling images have no tag, so no name points to them. Unused images have no container, tagged or not."
      freeable={pending(usage && `about ${formatBytes(usage.unused)}`)}
      freeBytes={usage?.unused}
      icon={LayersIcon}
      title="Images"
      usedBytes={usage?.total}
      uses={pending(usage && formatBytes(usage.total))}
    >
      <ActionButton
        loading={!usage}
        onClick={() => openFor('dangling')}
        reason={usage && nothingTo(usage.danglingCount)}
        variant="outline"
      >
        Remove dangling images
      </ActionButton>
      <ActionButton
        loading={!usage}
        onClick={() => openFor('unused')}
        reason={usage && nothingTo(usage.unusedCount)}
        variant="outline"
      >
        Remove all unused images
      </ActionButton>
      {usage && (
        <PruneDialog
          confirmLabel={dangling ? 'Remove dangling images' : 'Remove all unused images'}
          description={
            dangling
              ? `This removes ${countLabel(usage.danglingCount, 'dangling image')}, about ${formatBytes(usage.dangling)}.`
              : `Images no container uses, also tagged ones. You can pull them again. This removes ${countLabel(usage.unusedCount, 'image')}, about ${formatBytes(usage.unused)}.`
          }
          noun="image"
          onOpenChange={setOpen}
          open={open}
          run={() => pruneImagesFn({ data: { all: !dangling } })}
          title={dangling ? 'Remove dangling images?' : 'Remove all unused images?'}
        />
      )}
    </CategoryCard>
  )
}

/** The containers card. The dialog lists the stopped containers, fetched only while it is open. */
export function ContainersCard({ usage }: { usage?: ContainerUsage }) {
  const [open, setOpen] = useState(false)

  return (
    <CategoryCard
      explanation="Stopped containers keep their writable layer on disk. Removing them deletes that data too."
      freeable={pending(usage && `about ${formatBytes(usage.stoppedSize)}`)}
      freeBytes={usage?.stoppedSize}
      icon={BoxIcon}
      title="Containers"
      usedBytes={usage?.size}
      uses={pending(usage && formatBytes(usage.size))}
    >
      <ActionButton
        loading={!usage}
        onClick={() => setOpen(true)}
        reason={usage && nothingTo(usage.stoppedCount)}
        variant="outline"
      >
        Remove stopped containers
      </ActionButton>
      {usage && (
        <PruneDialog
          confirmLabel="Remove stopped containers"
          description={`This removes ${countLabel(usage.stoppedCount, 'stopped container')} and frees about ${formatBytes(usage.stoppedSize)}. Their data is lost.`}
          noun="container"
          onOpenChange={setOpen}
          open={open}
          run={() => pruneContainersFn({ data: {} })}
          title="Remove stopped containers?"
        >
          <StoppedContainerNames />
        </PruneDialog>
      )}
    </CategoryCard>
  )
}

function StoppedContainerNames() {
  const query = useQuery(containersQuery())
  if (query.isError) return <LoadError message={query.error.message} what="the containers" />
  if (!query.data) return <Skeleton className="h-24 w-full" />
  const names = query.data
    .filter((container) => isStoppedState(container.state))
    .map((container) => ({ key: container.id, text: container.name }))
  return <NameList empty="No stopped containers." label="Containers that will be removed" names={names} />
}

type VolumeKind = 'anonymous' | 'unused'

/**
 * The volumes card. Removing named volumes needs a confirmation checkbox, because they often hold databases.
 * The dialog lists the volumes, fetched only while it is open.
 */
export function VolumesCard({ usage }: { usage?: VolumeUsage }) {
  const [kind, setKind] = useState<VolumeKind>('anonymous')
  const [open, setOpen] = useState(false)
  const openFor = (next: VolumeKind) => {
    setKind(next)
    setOpen(true)
  }
  const anonymous = kind === 'anonymous'

  return (
    <CategoryCard
      explanation="Volumes keep data outside containers. Only volumes that no container uses are removed."
      freeable={pending(usage && `about ${formatBytes(usage.unused)}`)}
      freeBytes={usage?.unused}
      icon={DatabaseIcon}
      title="Volumes"
      usedBytes={usage?.total}
      uses={pending(usage && formatBytes(usage.total))}
    >
      <ActionButton
        loading={!usage}
        onClick={() => openFor('anonymous')}
        reason={usage && nothingTo(usage.anonymousUnusedCount)}
        variant="outline"
      >
        Remove unused anonymous volumes
      </ActionButton>
      <ActionButton
        loading={!usage}
        onClick={() => openFor('unused')}
        reason={usage && nothingTo(usage.unusedCount)}
        variant="outline"
      >
        Remove all unused volumes
      </ActionButton>
      {usage && (
        <PruneDialog
          acknowledgement={anonymous ? undefined : 'I understand the data is deleted'}
          confirmLabel={anonymous ? 'Remove unused anonymous volumes' : 'Remove all unused volumes'}
          description={
            anonymous
              ? `This removes ${countLabel(usage.anonymousUnusedCount, 'unused anonymous volume')}, about ${formatBytes(usage.anonymousUnused)}. Anonymous volumes have no name.`
              : `This removes ${countLabel(usage.unusedCount, 'unused volume')}, about ${formatBytes(usage.unused)}.`
          }
          noun="volume"
          onOpenChange={setOpen}
          open={open}
          run={() => pruneVolumesFn({ data: { named: !anonymous } })}
          title={anonymous ? 'Remove unused anonymous volumes?' : 'Remove all unused volumes?'}
        >
          {!anonymous && (
            <Alert variant="warning">
              <AlertDescription>Named volumes often hold databases. Their data is deleted for good.</AlertDescription>
            </Alert>
          )}
          <VolumeNames anonymousOnly={anonymous} />
        </PruneDialog>
      )}
    </CategoryCard>
  )
}

function VolumeNames({ anonymousOnly }: { anonymousOnly: boolean }) {
  const query = useQuery(volumesQuery())
  if (query.isError) return <LoadError message={query.error.message} what="the volumes" />
  if (!query.data) return <Skeleton className="h-24 w-full" />
  const volumes = sortVolumes(
    query.data.filter((volume) => volume.usedBy.length === 0 && (!anonymousOnly || volume.anonymous)),
  )
  return (
    <NameList
      empty="No volumes to remove."
      label="Volumes that will be removed"
      names={volumes.map((volume) => ({ key: volume.name, text: shortVolumeName(volume) }))}
    />
  )
}

/** The networks card. Built-in networks are never removed, so they are not counted or listed. */
export function NetworksCard({ unusedNetworks }: { unusedNetworks?: number }) {
  const [open, setOpen] = useState(false)

  return (
    <CategoryCard
      explanation="Networks let containers talk to each other. Built-in networks (bridge, host and none) are never removed."
      freeable={pending(unusedNetworks === undefined ? undefined : countLabel(unusedNetworks, 'unused network'))}
      icon={NetworkIcon}
      title="Networks"
      uses="No disk space"
      withMeter={false}
    >
      <ActionButton
        loading={unusedNetworks === undefined}
        onClick={() => setOpen(true)}
        reason={unusedNetworks === undefined ? null : nothingTo(unusedNetworks)}
        variant="outline"
      >
        Remove unused networks
      </ActionButton>
      {unusedNetworks !== undefined && (
        <PruneDialog
          confirmLabel="Remove unused networks"
          description={`This removes ${countLabel(unusedNetworks, 'unused network')}. Built-in networks are never removed.`}
          noun="network"
          onOpenChange={setOpen}
          open={open}
          run={() => pruneNetworksFn({ data: {} })}
          title="Remove unused networks?"
        >
          <NetworkNames />
        </PruneDialog>
      )}
    </CategoryCard>
  )
}

function NetworkNames() {
  const query = useQuery(networksQuery())
  if (query.isError) return <LoadError message={query.error.message} what="the networks" />
  if (!query.data) return <Skeleton className="h-16 w-full" />
  const networks = query.data.filter((network) => !network.builtIn && network.containers.length === 0)
  return (
    <NameList
      empty="No unused networks."
      label="Networks that will be removed"
      names={networks.map((network) => ({ key: network.id, text: network.name }))}
    />
  )
}

/** The names a prune removes, in a box that scrolls when the list is long. */
function NameList({ label, empty, names }: { label: string; empty: string; names: { key: string; text: string }[] }) {
  if (names.length === 0) return <p className="text-muted-foreground text-sm">{empty}</p>
  return (
    <ul aria-label={label} className="max-h-48 divide-y overflow-y-auto rounded-md border text-sm" tabIndex={0}>
      {names.map((name) => (
        <li className="truncate px-3 py-1.5 font-mono" key={name.key}>
          {name.text}
        </li>
      ))}
    </ul>
  )
}

function LoadError({ what, message }: { what: string; message: string }): ReactNode {
  return (
    <Alert variant="error">
      <AlertTitle>{`Could not list ${what}`}</AlertTitle>
      <AlertDescription>{message}</AlertDescription>
    </Alert>
  )
}
