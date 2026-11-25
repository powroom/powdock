import { createFileRoute, Outlet } from '@tanstack/react-router'
import { useState } from 'react'
import type React from 'react'
import { AppHeader } from '@/components/app/app-header'
import { AppSidebar } from '@/components/app/app-sidebar'
import { CommandPalette } from '@/components/app/command-palette'
import { SettingsDialog } from '@/components/app/settings-dialog'
import { ShortcutsDialog } from '@/components/app/shortcuts-dialog'
import { SidebarInset, SidebarProvider } from '@/components/ui/sidebar'
import { useHotkey } from '@/hooks/use-hotkey'

/**
 * The app shell: the sidebar, the header and the page. Every page under /containers, /images and
 * so on is rendered inside it. Signed-out visitors never get here (see __root.tsx).
 */
export const Route = createFileRoute('/_app')({
  component: AppShell,
})

// The sidebar remembers whether it was open (the ui sidebar writes this cookie).
function readSidebarCookie(): boolean {
  if (typeof document === 'undefined') return true
  const m = /(?:^|; )sidebar_state=(true|false)/.exec(document.cookie)
  return m ? m[1] === 'true' : true
}

function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useHotkey('mod+k', () => setPaletteOpen((open) => !open))
  useHotkey('?', () => setShortcutsOpen(true))

  return (
    <SidebarProvider
      className="h-svh min-h-0"
      defaultOpen={readSidebarCookie()}
      style={{ '--sidebar-width': '15rem' } as React.CSSProperties}
    >
      <AppSidebar onShowSettings={() => setSettingsOpen(true)} />
      <SidebarInset className="h-svh min-w-0 overflow-hidden">
        <AppHeader onOpenPalette={() => setPaletteOpen(true)} onShowShortcuts={() => setShortcutsOpen(true)} />
        <main className="flex min-h-0 flex-1 flex-col overflow-y-auto text-base [scrollbar-gutter:stable] sm:text-sm">
          <Outlet />
        </main>
      </SidebarInset>
      <CommandPalette
        onOpenChange={setPaletteOpen}
        onShowSettings={() => setSettingsOpen(true)}
        onShowShortcuts={() => setShortcutsOpen(true)}
        open={paletteOpen}
      />
      <SettingsDialog onOpenChange={setSettingsOpen} open={settingsOpen} />
      <ShortcutsDialog onOpenChange={setShortcutsOpen} open={shortcutsOpen} />
    </SidebarProvider>
  )
}
