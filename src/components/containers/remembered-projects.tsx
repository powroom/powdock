import { Link } from '@tanstack/react-router'
import { PlayIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Frame, FramePanel } from '@/components/ui/frame'
import type { ProjectBase } from '@/lib/compose'

/**
 * The projects that are remembered but have no containers now. One compact row each: the name, what
 * state it is in, and an Up button. Nothing else, so the list stays calm.
 */
export function RememberedProjects({
  projects,
  composeAvailable,
  busy,
  onUp,
}: {
  projects: readonly ProjectBase[]
  composeAvailable: boolean
  busy: boolean
  onUp: (name: string) => void
}) {
  return (
    <Frame aria-label="Projects not running" role="region">
      <FramePanel className="overflow-hidden p-0">
        {projects.map((project) => (
          <div className="flex min-w-0 items-center gap-3 border-b px-3 py-2 last:border-b-0" key={project.name}>
            <Link
              className="min-w-0 truncate rounded-sm font-medium text-sm outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              params={{ name: project.name }}
              to="/projects/$name"
            >
              {project.name}
            </Link>
            <span className="ms-auto whitespace-nowrap text-muted-foreground text-sm">Not running</span>
            <Button disabled={busy || !composeAvailable} onClick={() => onUp(project.name)} size="sm" variant="outline">
              <PlayIcon aria-hidden="true" />
              Up
            </Button>
          </div>
        ))}
      </FramePanel>
    </Frame>
  )
}
