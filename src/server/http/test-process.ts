import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

/**
 * bun test runs every file in one process, and auth.server and store.server keep their data
 * in module state. Stateful HTTP tests therefore run in a child bun process of their own,
 * each with a fresh POWDOCK_DATA_DIR. The child sets POWDOCK_HTTP_ISOLATED=1 and runs the tests.
 */
export const ISOLATED = process.env.POWDOCK_HTTP_ISOLATED === '1'

const PROJECT_ROOT = path.resolve(import.meta.dir, '../../..')

export async function runInChildProcess(file: string): Promise<void> {
  const dir = mkdtempSync(path.join(tmpdir(), 'powdock-http-'))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !key.startsWith('POWDOCK_')) env[key] = value
  }
  env.POWDOCK_DATA_DIR = dir
  env.POWDOCK_HTTP_ISOLATED = '1'
  try {
    const proc = Bun.spawn([process.execPath, 'test', file], {
      cwd: PROJECT_ROOT,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    if (code !== 0) throw new Error(`isolated run of ${path.basename(file)} failed:\n${stdout}\n${stderr}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
