/**
 * The shells a container has (bash, zsh, fish and sh). A short exec runs `command -v` for each name.
 * It uses a TTY, so Docker sends plain text with no frame headers.
 */
import { parseShellList, type TerminalShell } from '@/lib/terminal-protocol'
import { dockerFetch, dockerRequest } from '@/server/docker.server'

const SHELL_CHECK = 'for s in bash zsh fish; do command -v "$s" >/dev/null 2>&1 && echo "$s"; done; echo sh'
/** The check is quick. A container that does not answer in time has no shells for the tab. */
const CHECK_TIMEOUT_MS = 3000

/** The shells the container has. An empty list when the check cannot run (no sh, or the container is stopped). */
export async function listShells(containerId: string): Promise<TerminalShell[]> {
  try {
    const exec = await dockerRequest<{ Id: string }>('POST', `/containers/${encodeURIComponent(containerId)}/exec`, {
      body: { AttachStdout: true, AttachStderr: true, Tty: true, Cmd: ['sh', '-c', SHELL_CHECK] },
    })
    const response = await dockerFetch('POST', `/exec/${encodeURIComponent(exec.Id)}/start`, {
      body: { Detach: false, Tty: true },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!response.ok) return []
    return parseShellList(await response.text())
  } catch {
    return []
  }
}
