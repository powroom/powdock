export interface SessionGate {
  /** the function is listed in public-functions.ts */
  isPublic: boolean
  sessionValid: boolean
}

/** True when the call must be refused: the function is private and there is no valid session. */
export function needsSignIn({ isPublic, sessionValid }: SessionGate): boolean {
  return !isPublic && !sessionValid
}
