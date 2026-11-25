import { s } from './schema'
import type { ProjectBase } from './compose'

// The projects pow/dock remembers between sessions: a project stays in the list after `down`, so it
// can be started again. Pure helpers only. The file itself is read and written in the server code.

/** A project pow/dock has seen (its containers had the Compose labels) or created. */
export interface RememberedProject {
  name: string
  workingDir: string
  configFiles: string[]
  /** true for a project made by New project in pow/dock, false for one first seen in the labels */
  createdByPowdock: boolean
  /** ISO time the project was last seen with containers, or created */
  lastSeen: string
}

/** The file in the data folder: { "projects": [...] }. */
export const PROJECTS_FILE_NAME = 'projects.json'

export const projectsFileSchema = s.object({
  projects: s.array(
    s.object({
      name: s.string(),
      workingDir: s.string(),
      configFiles: s.array(s.string()),
      createdByPowdock: s.boolean(),
      lastSeen: s.string(),
    }),
  ),
})

/** lastSeen is written again only after this long, so a page that polls does not write the file on every call. */
export const LAST_SEEN_STEP_MS = 10 * 60_000

/**
 * Adds the projects that have containers now, and refreshes the ones already remembered. Returns the
 * new list and whether anything changed (so the caller writes the file only then).
 */
export function observeProjects(
  known: readonly RememberedProject[],
  seen: readonly ProjectBase[],
  now: Date,
): { projects: RememberedProject[]; changed: boolean } {
  const projects = [...known]
  let changed = false
  const nowText = now.toISOString()
  for (const project of seen) {
    if (!project.workingDir || project.configFiles.length === 0) continue
    const index = projects.findIndex((entry) => entry.name === project.name)
    const existing = projects[index]
    if (!existing) {
      projects.push({
        name: project.name,
        workingDir: project.workingDir,
        configFiles: [...project.configFiles],
        createdByPowdock: false,
        lastSeen: nowText,
      })
      changed = true
      continue
    }
    const moved =
      existing.workingDir !== project.workingDir || existing.configFiles.join('\n') !== project.configFiles.join('\n')
    const stale = now.getTime() - Date.parse(existing.lastSeen) >= LAST_SEEN_STEP_MS
    if (moved || stale) {
      projects[index] = {
        ...existing,
        workingDir: project.workingDir,
        configFiles: [...project.configFiles],
        lastSeen: nowText,
      }
      changed = true
    }
  }
  return { projects, changed }
}

/** The remembered projects with no containers now, as project rows (no services, 0 of 0). */
export function idleProjects(
  remembered: readonly RememberedProject[],
  activeNames: ReadonlySet<string>,
): ProjectBase[] {
  return remembered
    .filter((entry) => !activeNames.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      workingDir: entry.workingDir,
      configFiles: [...entry.configFiles],
      services: [],
      running: 0,
      total: 0,
      containsSelf: false,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Adds or replaces one remembered project by name (a project made by New project). */
export function rememberProject(known: readonly RememberedProject[], entry: RememberedProject): RememberedProject[] {
  return [...known.filter((project) => project.name !== entry.name), entry]
}

/** The remembered projects whose config files all still exist. A project with no config files is dropped. */
export function keepExisting(
  remembered: readonly RememberedProject[],
  exists: (path: string) => boolean,
): RememberedProject[] {
  return remembered.filter((entry) => entry.configFiles.length > 0 && entry.configFiles.every(exists))
}
