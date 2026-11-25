/**
 * The server functions that run without a session. Every other server function needs one:
 * src/start.ts rejects it with UNAUTHENTICATED before the handler runs.
 *
 * The TanStack compiler gives each createServerFn a `serverFnMeta` ({ id, name, filename }).
 * A function is public only when its name and filename both match an entry below. A missing or
 * unknown identity is private, so renaming or moving a function makes it private, not public.
 * public-functions.test.ts checks this list against the exports of session.functions.ts.
 */

export const PUBLIC_FUNCTIONS_FILE = 'src/api/session.functions.ts'

export const PUBLIC_SERVER_FUNCTIONS: readonly { filename: string; name: string }[] = [
  { filename: PUBLIC_FUNCTIONS_FILE, name: 'authStateFn' },
  { filename: PUBLIC_FUNCTIONS_FILE, name: 'signInFn' },
  { filename: PUBLIC_FUNCTIONS_FILE, name: 'completeSetupFn' },
]

export function isPublicServerFn(meta: { name?: string; filename?: string } | undefined): boolean {
  if (!meta?.name || !meta.filename) return false
  return PUBLIC_SERVER_FUNCTIONS.some((fn) => fn.name === meta.name && fn.filename === meta.filename)
}
