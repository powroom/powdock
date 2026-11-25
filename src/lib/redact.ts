/**
 * Hides secrets in text before it is logged or sent to a client: the password in a
 * scheme://user:password@host URL, a password setting (`password=`, `"password":`, `password:`),
 * and any known secret value. Pattern based, so it is a safety net and not a parser.
 */

/** scheme://user:password@ (the password may hold "/" or "@", so it runs to the last "@" of the word) */
const URL_PASSWORD = /([a-z][a-z0-9+.-]*:\/\/[^\s:/@]*:)\S*@/gi
/** password=..., "password": "...", password: ... (quoted values are taken whole) */
const PASSWORD_SETTING = /(password["']?\s*[:=]\s*)(?:'[^']*'|"[^"]*"|[^\s'",}]+)/gi

export function redactSecrets(text: string, secrets: readonly (string | undefined)[] = []): string {
  let out = text.replace(URL_PASSWORD, '$1***@').replace(PASSWORD_SETTING, '$1***')
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join('***')
  }
  return out
}

/**
 * Runs a server function's work. A thrown error keeps its message (the one the user reads),
 * with secrets hidden. Anything that is not an Error gets the fallback text.
 */
export async function withClientErrors<T>(run: () => Promise<T>, fallback: string): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw new Error(redactSecrets(err instanceof Error ? err.message : fallback))
  }
}

/** The stack (or message) of an error, with secrets hidden, for a log line. */
export function describeError(err: unknown): string {
  return redactSecrets(err instanceof Error ? (err.stack ?? err.message) : String(err))
}
