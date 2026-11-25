import { Link, useMatchRoute } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'
import {
  BoxIcon,
  BrushCleaningIcon,
  HardDriveIcon,
  LayersIcon,
  LayoutDashboardIcon,
  MonitorIcon,
  MoonIcon,
  NetworkIcon,
  SettingsIcon,
  SunIcon,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { countsQuery, engineInfoQuery } from '@/lib/queries'
import { setTheme, useTheme } from '@/lib/theme'
import type { Theme } from '@/lib/theme'
import { Logo } from './logo'
import { SidebarTree } from './sidebar-tree'

/** The counts beside the menu items are polled every 5 seconds while the tab is visible. */
const COUNT_POLL_MS = 5_000

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboardIcon },
  { to: '/containers', label: 'Containers', icon: BoxIcon },
  { to: '/images', label: 'Images', icon: LayersIcon },
  { to: '/volumes', label: 'Volumes', icon: HardDriveIcon },
  { to: '/networks', label: 'Networks', icon: NetworkIcon },
  { to: '/cleanup', label: 'Cleanup', icon: BrushCleaningIcon },
] as const

const THEMES: { value: Theme; label: string; icon: LucideIcon }[] = [
  { value: 'light', label: 'Light theme', icon: SunIcon },
  { value: 'dark', label: 'Dark theme', icon: MoonIcon },
  { value: 'system', label: 'System theme', icon: MonitorIcon },
]

/** The count beside each page: running containers, and the number of images, volumes and networks. */
function useNavCounts(): Partial<Record<(typeof NAV)[number]['to'], number>> {
  const counts = useQuery({ ...countsQuery(), refetchInterval: COUNT_POLL_MS, refetchIntervalInBackground: false })
  return {
    '/containers': counts.data?.containersRunning,
    '/images': counts.data?.images,
    '/volumes': counts.data?.volumes,
    '/networks': counts.data?.networks,
  }
}

/** One line at the bottom: a green dot with the Docker version, or a red dot when Docker cannot be reached. */
function EngineStatus() {
  const engine = useQuery(engineInfoQuery())
  if (engine.isPending) return <Skeleton className="mx-2 h-4 w-32" />
  if (engine.isError) {
    return (
      <Tooltip>
        <TooltipTrigger render={<div className="flex items-center gap-2 px-2 text-muted-foreground text-xs" />}>
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-destructive" />
          Docker is not reachable
        </TooltipTrigger>
        <TooltipPopup>{engine.error.message}</TooltipPopup>
      </Tooltip>
    )
  }
  return (
    <div className="flex items-center gap-2 px-2 text-muted-foreground text-xs">
      <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-success" />
      <span className="truncate">Docker {engine.data.version}</span>
    </div>
  )
}

export function AppSidebar({ onShowSettings }: { onShowSettings: () => void }) {
  const matchRoute = useMatchRoute()
  const { theme } = useTheme()
  const counts = useNavCounts()
  return (
    <Sidebar>
      <SidebarHeader className="gap-1.5 pb-0">
        <div className="px-2 py-1.5">
          <Logo />
        </div>
      </SidebarHeader>
      <SidebarContent className="gap-0 pb-2">
        <SidebarGroup className="py-1">
          <SidebarGroupContent>
            <SidebarMenu className="gap-px">
              {NAV.map((item) => {
                const active = Boolean(matchRoute({ to: item.to }))
                return (
                  <SidebarMenuItem className="relative" key={item.to}>
                    <SidebarMenuButton isActive={active} render={<Link to={item.to} />} size="sm">
                      <item.icon aria-hidden="true" />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                    {counts[item.to] !== undefined && (
                      <SidebarMenuBadge className="text-muted-foreground">{counts[item.to]}</SidebarMenuBadge>
                    )}
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        <SidebarTree />
      </SidebarContent>
      <SidebarFooter className="border-sidebar-border border-t py-2">
        <div className="py-1">
          <EngineStatus />
        </div>
        <div className="flex items-center justify-between gap-2 px-2">
          <Button aria-label="Settings" onClick={onShowSettings} size="sm" variant="ghost">
            <SettingsIcon aria-hidden="true" />
            Settings
          </Button>
          <div className="flex items-center gap-0.5" role="group" aria-label="Theme">
            {THEMES.map((t) => (
              <Button
                aria-label={t.label}
                aria-pressed={theme === t.value}
                key={t.value}
                onClick={() => setTheme(t.value)}
                size="icon-sm"
                variant={theme === t.value ? 'secondary' : 'ghost'}
              >
                <t.icon aria-hidden="true" />
              </Button>
            ))}
          </div>
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
