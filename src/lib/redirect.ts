/** Only same-site paths: a `redirect` value comes from the URL, so never leave the site. */
export function safeRedirect(value: string | undefined): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/'
  return value
}

/** Search params of the sign-in and setup pages. */
export function validateRedirectSearch(search: Record<string, unknown>): { redirect?: string } {
  return { redirect: typeof search.redirect === 'string' ? search.redirect : undefined }
}
