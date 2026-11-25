/**
 * Settings for the Bun server in server.ts.
 */

/** Bun's idleTimeout is in seconds and cannot exceed 255. */
export const IDLE_TIMEOUT_SECONDS = 255

/** The largest request body the server reads. The app only sends small JSON bodies. */
export const MAX_REQUEST_BODY_BYTES = 1024 * 1024
