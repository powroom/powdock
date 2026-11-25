import { describe, expect, test } from 'bun:test'
import { needsSignIn } from './session-gate'

describe('needsSignIn', () => {
  // [isPublic, sessionValid, refused]
  test.each([
    [true, true, false],
    [true, false, false],
    [false, true, false],
    [false, false, true],
  ])('isPublic=%p sessionValid=%p refused=%p', (isPublic, sessionValid, refused) => {
    expect(needsSignIn({ isPublic, sessionValid })).toBe(refused)
  })
})
