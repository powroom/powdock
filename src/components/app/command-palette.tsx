import { useNavigate } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  BoxIcon,
  BrushCleaningIcon,
  CornerDownLeftIcon,
  HardDriveIcon,
  KeyboardIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  MoonIcon,
  NetworkIcon,
  SettingsIcon,
  SunIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Fragment, useState } from 'react'
import {
  Command,
  CommandCollection,
  CommandDialog,
  CommandDialogPopup,
  CommandEmpty,
  CommandFooter,
  CommandGroup,
  CommandGroupLabel,
  CommandInput,
  CommandItem,
  CommandList,
  CommandPanel,
  CommandSeparator,
  CommandShortcut,
} from '@/components/ui/command'
import { ImageIcon } from '@/components/app/image-icon'
import { Kbd, KbdGroup } from '@/components/ui/kbd'
import { paletteMatches } from '@/lib/container-view'
import { containersQuery } from '@/lib/queries'
import { useImageStacks } from '@/components/app/use-image-stacks'
import { setTheme } from '@/lib/theme'
import type { IconKey } from '@/lib/image-icon'
import type { Theme } from '@/lib/theme'

interface PaletteItem {
  id: string
  label: string
  keywords?: string
  icon: LucideIcon
  /** a container's image: the item shows the image tile instead of the icon */
  image?: string
  /** the icon the image's config names, for the tile of `image` (see useImageStacks) */
  stack?: IconKey | null
  hint?: string
  run: () => void
}

interface PaletteGroup {
  value: string
  items: PaletteItem[]
}

const PAGES = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon },
  { to: '/containers', label: 'Containers', icon: BoxIcon },
  { to: '/images', label: 'Images', icon: LayersIcon },
  { to: '/volumes', label: 'Volumes', icon: HardDriveIcon },
  { to: '/networks', label: 'Networks', icon: NetworkIcon },
  { to: '/cleanup', label: 'Cleanup', icon: BrushCleaningIcon },
] as const

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
]

/** Keeps the items whose label or keywords contain the query. The query is compared in lower case. */
function matches(item: PaletteItem, query: string): boolean {
  if (!query) return true
  return `${item.label} ${item.keywords ?? ''}`.toLowerCase().includes(query)
}

export function CommandPalette({
  open,
  onOpenChange,
  onShowSettings,
  onShowShortcuts,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onShowSettings: () => void
  onShowShortcuts: () => void
}) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const q = query.trim().toLowerCase()
  // The list is read only while the palette is open. Typing a name finds a container, running or stopped.
  const containers = useQuery({ ...containersQuery(), enabled: open })
  const stacks = useImageStacks(containers.data?.map((container) => container.imageId) ?? [], open)

  const close = () => onOpenChange(false)

  const pages: PaletteItem[] = PAGES.map((page) => ({
    id: `page:${page.to}`,
    label: page.label,
    icon: page.icon,
    keywords: 'go open page',
    run: () => void navigate({ to: page.to }),
  }))
  const actions: PaletteItem[] = [
    {
      id: 'settings',
      label: 'Settings',
      icon: SettingsIcon,
      keywords: 'account password sign out',
      run: onShowSettings,
    },
    {
      id: 'shortcuts',
      label: 'Keyboard shortcuts',
      icon: KeyboardIcon,
      hint: '?',
      keywords: 'help keys',
      run: onShowShortcuts,
    },
  ]
  const themes: PaletteItem[] = THEMES.map((t) => ({
    id: `theme:${t.value}`,
    label: `Theme: ${t.label}`,
    icon: t.icon,
    keywords: 'appearance dark light system color',
    run: () => setTheme(t.value),
  }))

  const containerItems: PaletteItem[] = paletteMatches(containers.data ?? [], q).map((container) => ({
    id: `container:${container.id}`,
    label: container.name,
    icon: BoxIcon,
    image: container.image,
    stack: stacks[container.imageId] ?? null,
    run: () => void navigate({ to: '/containers/$id', params: { id: container.id }, search: {} }),
  }))

  const groups: PaletteGroup[] = [
    { value: 'Pages', items: pages },
    { value: 'Containers', items: containerItems },
    { value: 'Actions', items: actions },
    { value: 'Theme', items: themes },
  ]
    .map((group) => ({ value: group.value, items: group.items.filter((item) => matches(item, q)) }))
    .filter((group) => group.items.length > 0)

  return (
    <CommandDialog
      onOpenChange={onOpenChange}
      onOpenChangeComplete={(isOpen) => {
        if (!isOpen) setQuery('')
      }}
      open={open}
    >
      <CommandDialogPopup aria-label="Command palette">
        <Command
          filteredItems={groups}
          items={groups}
          itemToStringValue={(item: unknown) => (item as PaletteItem).label}
          onValueChange={setQuery}
          value={query}
        >
          <CommandInput placeholder="Go to a page, a container or an action…" />
          <CommandPanel>
            <CommandEmpty>No results for “{query}”.</CommandEmpty>
            <CommandList>
              {(group: PaletteGroup) => (
                <Fragment key={group.value}>
                  <CommandGroup items={group.items}>
                    <CommandGroupLabel>{group.value}</CommandGroupLabel>
                    <CommandCollection>
                      {(item: PaletteItem) => (
                        <CommandItem
                          className="gap-2.5"
                          key={item.id}
                          onClick={() => {
                            close()
                            item.run()
                          }}
                          value={item}
                        >
                          {item.image === undefined ? (
                            <item.icon aria-hidden="true" className="size-4 opacity-70" />
                          ) : (
                            <ImageIcon image={item.image} name={item.label} size={20} stack={item.stack} />
                          )}
                          <span className="truncate">{item.label}</span>
                          {item.hint && <CommandShortcut className="tracking-normal">{item.hint}</CommandShortcut>}
                        </CommandItem>
                      )}
                    </CommandCollection>
                  </CommandGroup>
                  <CommandSeparator />
                </Fragment>
              )}
            </CommandList>
          </CommandPanel>
          <CommandFooter>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <KbdGroup>
                  <Kbd>
                    <ArrowUpIcon />
                  </Kbd>
                  <Kbd>
                    <ArrowDownIcon />
                  </Kbd>
                </KbdGroup>
                <span>Navigate</span>
              </div>
              <div className="flex items-center gap-2">
                <Kbd>
                  <CornerDownLeftIcon />
                </Kbd>
                <span>Open</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Kbd>Esc</Kbd>
              <span>Close</span>
            </div>
          </CommandFooter>
        </Command>
      </CommandDialogPopup>
    </CommandDialog>
  )
}
