import { describe, expect, test } from 'bun:test'
import { describeError, redactSecrets } from './redact'

describe('redactSecrets', () => {
  test('hides the password in a scheme://user:password@host URL and keeps host and user', () => {
    expect(redactSecrets('clone https://app:s3cret@git.example.com/repo failed')).toBe(
      'clone https://app:***@git.example.com/repo failed',
    )
    expect(redactSecrets('https://u:p/w@x@h/path')).toBe('https://u:***@h/path')
  })

  test('leaves URLs without a password alone', () => {
    expect(redactSecrets('https://app@example.com/app')).toBe('https://app@example.com/app')
    expect(redactSecrets('https://example.com:8080/app')).toBe('https://example.com:8080/app')
  })

  test('hides password settings in env and JSON style text', () => {
    expect(redactSecrets("host=db password='a b' user=x")).toBe('host=db password=*** user=x')
    expect(redactSecrets('REGISTRY_PASSWORD=hunter2 ok')).toBe('REGISTRY_PASSWORD=*** ok')
    expect(redactSecrets('{"password": "hunter2", "user": "x"}')).toBe('{"password": ***, "user": "x"}')
    expect(redactSecrets('  password: hunter2')).toBe('  password: ***')
  })

  test('hides known secret values wherever they appear', () => {
    expect(redactSecrets('value abc123 leaked twice abc123', ['abc123'])).toBe('value *** leaked twice ***')
    expect(redactSecrets('hello', ['', undefined])).toBe('hello')
  })
})

describe('describeError', () => {
  test('returns the stack with secrets hidden, and stringifies other values', () => {
    const err = new Error('login https://app:s3cret@example.com failed')
    const text = describeError(err)
    expect(text).toContain('https://app:***@example.com')
    expect(text).not.toContain('s3cret')
    expect(describeError('password=hunter2')).toBe('password=***')
  })
})
