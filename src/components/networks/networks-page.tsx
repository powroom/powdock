import { useQuery } from '@tanstack/react-query'
import { NetworkIcon, PlusIcon, SearchIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useRef, useState } from 'react'
import { Alert, AlertAction, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { EmptyState } from '@/components/app/empty-state'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group'
import { Tabs, TabsList, TabsTab } from '@/components/ui/tabs'
import { useHotkey } from '@/hooks/use-hotkey'
import { countLabel } from '@/lib/format'
import { networksQuery } from '@/lib/queries'
import {
  countNetworks,
  matchesNetworkFilter,
  matchesNetworkSearch,
  sortNetworks,
  type NetworkFilter,
} from '@/lib/network-view'
import type { NetworkSummary } from '@/lib/types'
import { CreateNetworkDialog } from './create-network-dialog'
import { NetworkDetailsSheet } from './network-details-sheet'
import { NetworkRow, NetworkRowSkeleton } from './network-row'
import { RemoveNetworkDialog } from './remove-network-dialog'

/** How often the list refreshes while the tab is visible. Attached containers change when containers start or stop. */
const POLL_MS = 10_000
const SKELETON_KEYS = ['first', 'second', 'third', 'fourth', 'fifth']
const FILTERS: { value: NetworkFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'in-use', label: 'In use' },
  { value: 'unused', label: 'Unused' },
]

export function NetworksPage() {
  const list = useQuery({ ...networksQuery(), refetchInterval: POLL_MS, refetchIntervalInBackground: false })
  const networks = list.data ?? []

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<NetworkFilter>('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [detailsTarget, setDetailsTarget] = useState<NetworkSummary | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<NetworkSummary | null>(null)
  const [removeOpen, setRemoveOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  useHotkey('/', () => searchRef.current?.focus())

  const counts = countNetworks(networks)
  const shown = sortNetworks(
    networks.filter((network) => matchesNetworkFilter(network, filter) && matchesNetworkSearch(network, query)),
  )

  let body: ReactNode
  if (list.isPending) {
    body = (
      <Frame aria-busy="true" aria-label="Loading networks" role="region">
        <FramePanel className="overflow-hidden p-0">
          {SKELETON_KEYS.map((key) => (
            <NetworkRowSkeleton key={key} />
          ))}
        </FramePanel>
      </Frame>
    )
  } else if (networks.length === 0) {
    body = list.error ? null : (
      <EmptyState
        action={
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Create network
          </Button>
        }
        description="A network lets containers talk to each other."
        icon={NetworkIcon}
        title="No networks found"
      />
    )
  } else if (shown.length === 0) {
    body = <EmptyState description="Try another search or filter." icon={SearchIcon} title="Nothing matches" />
  } else {
    body = (
      <Frame>
        <FramePanel className="divide-y overflow-hidden p-0">
          {shown.map((network) => (
            <NetworkRow
              handlers={{
                onDetails: (target) => {
                  setDetailsTarget(target)
                  setDetailsOpen(true)
                },
                onRemove: (target) => {
                  setRemoveTarget(target)
                  setRemoveOpen(true)
                },
              }}
              key={network.id}
              network={network}
            />
          ))}
        </FramePanel>
      </Frame>
    )
  }

  return (
    <div className="@container flex min-w-0 flex-col gap-4 p-4 sm:p-6">
      <h1 className="font-heading font-semibold text-xl tracking-tight">Networks</h1>

      <div className="flex flex-wrap items-center gap-3">
        <InputGroup className="w-full sm:w-72">
          <InputGroupAddon>
            <SearchIcon aria-hidden="true" />
          </InputGroupAddon>
          <InputGroupInput
            aria-label="Search networks"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setQuery('')
            }}
            placeholder="Search name, subnet, project"
            ref={searchRef}
            spellCheck={false}
            type="search"
            value={query}
          />
        </InputGroup>
        <div className="no-scrollbar max-w-full overflow-x-auto">
          <Tabs onValueChange={(value) => setFilter(value as NetworkFilter)} value={filter}>
            <TabsList size="sm">
              {FILTERS.map((option) => (
                <TabsTab className="grow-0 gap-1.5" key={option.value} value={option.value}>
                  {option.label}
                  <Badge size="sm" variant="secondary">
                    {counts[option.value]}
                  </Badge>
                </TabsTab>
              ))}
            </TabsList>
          </Tabs>
        </div>
        <div className="ms-auto flex flex-wrap items-center gap-3">
          <p className="text-muted-foreground text-sm tabular-nums">{countLabel(networks.length, 'network')}</p>
          <Button onClick={() => setCreateOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Create network
          </Button>
        </div>
      </div>

      {list.error && (
        <Alert variant="error">
          <AlertTitle>Could not load networks</AlertTitle>
          <AlertDescription>{list.error.message}</AlertDescription>
          <AlertAction>
            <Button onClick={() => void list.refetch()} size="sm" variant="outline">
              Retry
            </Button>
          </AlertAction>
        </Alert>
      )}

      {body}

      <CreateNetworkDialog onOpenChange={setCreateOpen} open={createOpen} />
      <NetworkDetailsSheet network={detailsTarget} onOpenChange={setDetailsOpen} open={detailsOpen} />
      <RemoveNetworkDialog network={removeTarget} onOpenChange={setRemoveOpen} open={removeOpen} />
    </div>
  )
}
