import { useQuery } from '@tanstack/react-query'
import { Link, useMatchRoute, useParams } from '@tanstack/react-router'
import { KeyboardIcon, SearchIcon } from 'lucide-react'
import { UpdateNotice } from '@/components/app/update-dialog'
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb'
import { Button } from '@/components/ui/button'
import { Kbd } from '@/components/ui/kbd'
import { SidebarTrigger } from '@/components/ui/sidebar'
import { Tooltip, TooltipPopup, TooltipTrigger } from '@/components/ui/tooltip'
import { modKey } from '@/hooks/use-hotkey'
import { shortImageId } from '@/lib/container-details'
import { imageName } from '@/lib/image-view'
import { containersQuery, imagesQuery } from '@/lib/queries'

const PAGES = [
  { to: '/', label: 'Dashboard' },
  { to: '/containers', label: 'Containers' },
  { to: '/images', label: 'Images' },
  { to: '/volumes', label: 'Volumes' },
  { to: '/networks', label: 'Networks' },
  { to: '/cleanup', label: 'Cleanup' },
] as const

export function AppHeader({
  onOpenPalette,
  onShowShortcuts,
}: {
  onOpenPalette: () => void
  onShowShortcuts: () => void
}) {
  const matchRoute = useMatchRoute()
  const params = useParams({ strict: false }) as { id?: string; name?: string }
  const containers = useQuery(containersQuery())
  const images = useQuery(imagesQuery())
  const page = PAGES.find((p) => matchRoute({ to: p.to }))
  const onContainer = Boolean(matchRoute({ to: '/containers/$id' }))
  const onProject = Boolean(matchRoute({ to: '/projects/$name' }))
  const onImage = Boolean(matchRoute({ to: '/images/$id' }))

  // a container shows its id until the container list has loaded, an image its short id
  const containerName = containers.data?.find((c) => c.id === params.id)?.name ?? params.id?.slice(0, 12)
  const image = images.data?.find((item) => item.id === params.id || item.shortId === params.id)
  const imageTitle = image ? (imageName(image) ?? image.shortId) : shortImageId(params.id ?? '')
  const detailTitle = onProject ? params.name : onContainer ? containerName : onImage ? imageTitle : undefined
  const parent = onImage ? { to: '/images', label: 'Images' } : { to: '/containers', label: 'Containers' }

  return (
    <header className="@container/header flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <SidebarTrigger className="-ms-1" />
      <div className="mx-1 h-4 w-px bg-border" />
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Breadcrumb className="min-w-0 shrink">
          <BreadcrumbList className="flex-nowrap">
            {detailTitle !== undefined ? (
              <>
                <BreadcrumbItem className="shrink-0">
                  <BreadcrumbLink render={<Link to={parent.to} />}>{parent.label}</BreadcrumbLink>
                </BreadcrumbItem>
                <BreadcrumbSeparator />
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate font-medium">{detailTitle}</BreadcrumbPage>
                </BreadcrumbItem>
              </>
            ) : (
              page && (
                <BreadcrumbItem className="min-w-0">
                  <BreadcrumbPage className="truncate font-medium">{page.label}</BreadcrumbPage>
                </BreadcrumbItem>
              )
            )}
          </BreadcrumbList>
        </Breadcrumb>
      </div>

      <Button
        className="hidden w-56 justify-start font-normal text-muted-foreground @3xl/header:flex @5xl/header:w-72"
        onClick={onOpenPalette}
        size="sm"
        variant="outline"
      >
        <SearchIcon aria-hidden="true" />
        <span className="flex-1 text-start">Search…</span>
        <Kbd className="-me-1">{modKey} K</Kbd>
      </Button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Search"
              className="@3xl/header:hidden"
              onClick={onOpenPalette}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <SearchIcon />
        </TooltipTrigger>
        <TooltipPopup>Search ({modKey} K)</TooltipPopup>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              aria-label="Keyboard shortcuts"
              // keyboard shortcuts do not apply on touch screens, and the header needs the room there
              className="max-sm:hidden"
              onClick={onShowShortcuts}
              size="icon-sm"
              variant="ghost"
            />
          }
        >
          <KeyboardIcon />
        </TooltipTrigger>
        <TooltipPopup>Keyboard shortcuts (?)</TooltipPopup>
      </Tooltip>
      <UpdateNotice />
    </header>
  )
}
