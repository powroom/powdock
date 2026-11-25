// Parses the name the user types for "Pull image" into the two query values of
// POST /images/create: fromImage (the repository, with the registry host when there is one) and
// tag (a tag, or a digest such as sha256:...). Pure, so the browser and the server share it.

const MAX_LENGTH = 255
/** A registry host: letters, digits, dots and dashes, with an optional port. */
const HOST = /^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*(:[0-9]{1,5})?$/
/** One path part of a repository: lowercase letters and digits, with single separators. */
const PATH_PART = /^[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*$/
/** A tag: up to 128 characters, letters, digits, underscore, dot and dash, not starting with dot or dash. */
const TAG = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/
/** A digest: an algorithm name, a colon and at least 32 hex or base64-style characters. */
const DIGEST = /^[A-Za-z][A-Za-z0-9+.-]*:[A-Za-z0-9=_-]{32,}$/

export interface ImageReference {
  /** the repository, with the registry host when one is given (no tag, no digest) */
  fromImage: string
  /** the tag, or the digest when the reference has one. "latest" when neither is given. */
  tag: string
}

/** Splits "repo:tag" or "repo@digest" and checks each part. Throws an Error with the reason. */
export function parseImageReference(ref: string): ImageReference {
  if (ref.length === 0) throw new Error('Enter an image name, such as nginx:1.27.')
  if (ref.length > MAX_LENGTH) throw new Error(`An image name can be at most ${MAX_LENGTH} characters.`)
  if (/\s/.test(ref)) throw new Error('An image name cannot contain spaces.')

  const at = ref.indexOf('@')
  const namePart = at === -1 ? ref : ref.slice(0, at)
  const digest = at === -1 ? null : ref.slice(at + 1)
  if (digest !== null && !DIGEST.test(digest)) throw new Error('The digest after @ is not valid.')

  // A colon after the last slash starts the tag. A colon before it is a registry port.
  const slash = namePart.lastIndexOf('/')
  const colon = namePart.lastIndexOf(':')
  const hasTag = colon > slash
  const repository = hasTag ? namePart.slice(0, colon) : namePart
  const tag = hasTag ? namePart.slice(colon + 1) : null
  if (tag !== null && !TAG.test(tag)) throw new Error(`The tag "${tag}" is not valid.`)
  if (digest !== null && tag !== null) throw new Error('Use either a tag or a digest, not both.')

  checkRepository(repository)
  return { fromImage: repository, tag: digest ?? tag ?? 'latest' }
}

function checkRepository(repository: string): void {
  if (!repository) throw new Error('The image name is missing before the tag.')
  const parts = repository.split('/')
  const [first = '', ...rest] = parts
  // The first part is a registry host when it has a dot, a port or is "localhost". Otherwise it is a repository part.
  const hasHost = parts.length > 1 && (first.includes('.') || first.includes(':') || first === 'localhost')
  const pathParts = hasHost ? rest : parts
  if (hasHost && !HOST.test(first)) throw new Error(`The registry "${first}" is not valid.`)
  for (const part of pathParts) {
    if (!PATH_PART.test(part)) {
      throw new Error(`The name "${part || '(empty)'}" is not valid. Use lowercase letters, digits and . _ -.`)
    }
  }
}
