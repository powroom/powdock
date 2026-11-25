// Rules and text for New project. Pure: the dialog and the server both use these, so they agree.

/** A new project name: lowercase letters, digits, dashes and underscores, starting with a letter or digit. */
export const NEW_PROJECT_NAME = /^[a-z0-9][a-z0-9_-]*$/
export const NEW_PROJECT_NAME_MAX = 64

/** The message for a name that cannot be used, or null when it is fine. */
export function newProjectNameProblem(name: string): string | null {
  if (name === '') return 'Enter a name for the project.'
  if (name.length > NEW_PROJECT_NAME_MAX) return `Use at most ${NEW_PROJECT_NAME_MAX} characters.`
  if (!NEW_PROJECT_NAME.test(name)) {
    return 'Use lowercase letters, digits, - and _. Start with a letter or a digit.'
  }
  return null
}

/** The folder of a project under the projects folder, shown as text in the dialog. */
export function projectFolderText(projectsDir: string, name: string): string {
  return `${projectsDir.replace(/\/+$/, '')}/${name}`
}

/** The file New project writes for the empty start: five comment lines with one example service. */
export const EMPTY_COMPOSE_FILE = [
  '# Each service is one container. Uncomment the example to start with one.',
  '# services:',
  '#   web:',
  '#     image: nginx:1.27',
  '#     ports: ["8080:80"]',
  '',
].join('\n')

/** The placeholder of the docker run command box. */
export const DOCKER_RUN_PLACEHOLDER = 'docker run -d -p 8080:80 --name web nginx:1.27'
