import { createServerFn } from '@tanstack/react-start'
import type { ProjectBase } from '@/lib/compose'
import type { NewProjectInput, CreateResult } from '@/server/project-create.server'
import type { ProjectFile, SaveResult } from '@/server/project-files.server'
import type { Project } from '@/server/compose.server'
import { projectValidators } from './validators'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The Compose work lives in src/server/compose.server.ts; the files in src/server/project-files.server.ts.

/** A project by name (null when no container has its label), and whether Docker Compose runs here. */
export const projectFn = createServerFn({ method: 'POST' })
  .validator(projectValidators().nameInput)
  .handler(async ({ data }): Promise<{ composeAvailable: boolean; project: Project | null }> => {
    const { composeAvailable, findProject } = await import('@/server/compose.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(async () => {
      const available = await composeAvailable()
      return { composeAvailable: available, project: await findProject(data.name) }
    }, 'Could not read the project.')
  })

/** The remembered projects with no containers now (the Containers page lists them), and whether Compose runs here. */
export const idleProjectsFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<{ composeAvailable: boolean; projects: ProjectBase[] }> => {
    const { composeAvailable, listIdleProjects } = await import('@/server/compose.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(async () => {
      const available = await composeAvailable()
      return { composeAvailable: available, projects: await listIdleProjects() }
    }, 'Could not read the projects.')
  },
)

/** The files of a project for the Compose file tab: its config files and .env. Empty when the project is gone. */
export const projectFilesFn = createServerFn({ method: 'POST' })
  .validator(projectValidators().nameInput)
  .handler(async ({ data }): Promise<ProjectFile[]> => {
    const { findProject } = await import('@/server/compose.server')
    const { readProjectFiles } = await import('@/server/project-files.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(async () => {
      const project = await findProject(data.name)
      return project ? readProjectFiles(project) : []
    }, 'Could not read the project files.')
  })

/** Saves one file of a project (see saveProjectFile). A failed check or a changed file is an answer, not an error. */
export const saveProjectFileFn = createServerFn({ method: 'POST' })
  .validator(projectValidators().saveInput)
  .handler(async ({ data }): Promise<SaveResult> => {
    const { findProject } = await import('@/server/compose.server')
    const { saveProjectFile } = await import('@/server/project-files.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(async () => {
      const project = await findProject(data.name)
      if (!project)
        return { ok: false, reason: 'refused', message: 'No containers belong to this project now.', line: null }
      return saveProjectFile(project, data.path, data.content, data.baseHash)
    }, 'Could not save the file.')
  })

/** The folder New project suggests for a new project (the projects folder). */
export const projectsDirFn = createServerFn({ method: 'POST' }).handler(async (): Promise<string> => {
  const { projectsDir } = await import('@/server/project-create.server')
  return projectsDir()
})

/** New project: makes the folder and its compose.yaml, and remembers the project. It starts nothing. */
export const createProjectFn = createServerFn({ method: 'POST' })
  .validator(projectValidators().createInput)
  .handler(async ({ data }): Promise<CreateResult> => {
    const { createProject } = await import('@/server/project-create.server')
    const { withClientErrors } = await import('@/lib/redact')
    const input: NewProjectInput = data
    return withClientErrors(() => createProject(input), 'Could not create the project.')
  })
