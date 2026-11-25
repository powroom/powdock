// The input validators of the server functions in this folder. They live here, not in the
// *.functions.ts files, so the client build can drop them: it strips every .validator(...) call.
// The tests build the same schemas from here.
import { CONTAINER_ACTIONS } from '@/lib/types'
import { s } from '@/lib/schema'
import { isValidResourceName, RESOURCE_NAME } from '@/lib/resource-names'
import { MAX_CONFIG_BYTES, PROJECT_NAME } from '@/lib/compose'
import { NEW_PROJECT_NAME_MAX } from '@/lib/new-project'

/** The sign-in and setup form. The length rules are checked in the server code (auth.server.ts). */
export function authValidators() {
  return {
    credentials: s.object({ username: s.string(), password: s.string() }),
    passwordChange: s.object({ current: s.string(), next: s.string() }),
  }
}

/** A Docker container id: 12 to 64 hex characters (the short form or the full one). */
export const CONTAINER_ID = /^[a-f0-9]{12,64}$/
/** At most this many containers in one stats call. */
const MAX_STATS_IDS = 500

/** The inputs of the container server functions (src/api/docker.functions.ts). */
export function dockerValidators() {
  const id = s.string().regex(CONTAINER_ID, 'Invalid container ID.')
  return {
    statsInput: s.object({ ids: s.array(id).max(MAX_STATS_IDS) }),
    historyInput: s.object({ id }),
    actionInput: s.object({ id, action: s.enum(CONTAINER_ACTIONS) }),
    removeInput: s.object({ id, force: s.boolean(), volumes: s.boolean() }),
    inspectInput: s.object({ id }),
    shellsInput: s.object({ id }),
  }
}

/** An image ID: "sha256:" and 64 hex characters, or 12 to 64 hex characters (the short form or the full one). */
export const IMAGE_ID = /^(sha256:[a-f0-9]{64}|[a-f0-9]{12,64})$/

/** An image tag such as `nginx:1.27` or `registry:5000/team/app:v2`: no spaces, at most 255 characters. */
export const IMAGE_TAG_REF = /^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,254}$/

/** At most this many images in one stacks call. */
const MAX_STACK_IDS = 500

/** The inputs of the image server functions (src/api/images.functions.ts). */
export function imageValidators() {
  const id = s.string().regex(IMAGE_ID, 'Invalid image ID.')
  // a tag removes only that tag; an ID (for an image without tags) removes the image
  const ref = s.string().refine((value) => IMAGE_ID.test(value) || IMAGE_TAG_REF.test(value), 'Invalid image.')
  return {
    inspectInput: s.object({ id }),
    removeInput: s.object({ ref, force: s.boolean() }),
    stacksInput: s.object({ ids: s.array(id).max(MAX_STACK_IDS) }),
  }
}

/** A full image id, as the Images list has it: "sha256:" and 64 hex characters. */
export const FULL_IMAGE_ID = /^sha256:[a-f0-9]{64}$/

/** The inputs of the vulnerability scan server functions (src/api/scan.functions.ts). */
export function scanValidators() {
  return {
    imageInput: s.object({ id: s.string().regex(FULL_IMAGE_ID, 'Invalid image ID.') }),
  }
}

/** The inputs of the volume server functions (src/api/volumes.functions.ts). */
export function volumeValidators() {
  const name = s.string().regex(RESOURCE_NAME, 'Invalid volume name.')
  return {
    nameInput: s.object({ name }),
    // an empty name lets Docker pick one
    createInput: s.object({
      name: s.string().refine((value) => value === '' || isValidResourceName(value), 'Invalid volume name.'),
    }),
    removeInput: s.object({ name, force: s.boolean() }),
  }
}

/** The inputs of the project server functions (src/api/projects.functions.ts). */
export function projectValidators() {
  const name = s.string().regex(PROJECT_NAME, 'Invalid project name.')
  return {
    nameInput: s.object({ name }),
    // the path is matched exactly against the project's own files on the server
    saveInput: s.object({
      name,
      path: s.string().min(1).max(1024),
      content: s.string().max(MAX_CONFIG_BYTES),
      baseHash: s.string().regex(/^[a-f0-9]{64}$/, 'Invalid file version.'),
    }),
    createInput: s.object({
      name: s.string().max(NEW_PROJECT_NAME_MAX),
      folder: s.string().max(1024),
      source: s.enum(['empty', 'docker-run'] as const),
      command: s.string().max(10_000),
    }),
  }
}

/** The inputs of the network server functions (src/api/networks.functions.ts). Subnet and gateway may be empty. */
export function networkValidators() {
  const id = s.string().regex(RESOURCE_NAME, 'Invalid network ID.')
  return {
    inspectInput: s.object({ id }),
    removeInput: s.object({ id }),
    createInput: s.object({
      name: s.string().regex(RESOURCE_NAME, 'Invalid network name.'),
      internal: s.boolean(),
      subnet: s.string().max(64),
      gateway: s.string().max(64),
    }),
  }
}

/**
 * The inputs of the cleanup server functions (src/api/cleanup.functions.ts). They are strict: an extra field, such
 * as a label filter, is refused, so a client can never choose what a prune removes.
 */
export function cleanupValidators() {
  return {
    emptyInput: s.strictObject({}),
    imagesInput: s.strictObject({ all: s.boolean() }),
    volumesInput: s.strictObject({ named: s.boolean() }),
    buildInput: s.strictObject({ olderThanWeek: s.boolean() }),
  }
}
