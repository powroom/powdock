import { describe, expect, test } from 'bun:test'
import { parseImageReference } from './image-reference'

const DIGEST = `sha256:${'a'.repeat(64)}`

describe('parseImageReference', () => {
  test('a repository and a tag', () => {
    expect(parseImageReference('nginx:1.27')).toEqual({ fromImage: 'nginx', tag: '1.27' })
  })

  test('the tag defaults to latest', () => {
    expect(parseImageReference('nginx')).toEqual({ fromImage: 'nginx', tag: 'latest' })
    expect(parseImageReference('library/redis')).toEqual({ fromImage: 'library/redis', tag: 'latest' })
  })

  test('a registry host with a port keeps the port and is not read as a tag', () => {
    expect(parseImageReference('localhost:5000/team/app')).toEqual({
      fromImage: 'localhost:5000/team/app',
      tag: 'latest',
    })
    expect(parseImageReference('localhost:5000/team/app:2.0')).toEqual({
      fromImage: 'localhost:5000/team/app',
      tag: '2.0',
    })
  })

  test('a registry host with a dot and nested paths', () => {
    expect(parseImageReference('ghcr.io/org/team/tool:v3')).toEqual({
      fromImage: 'ghcr.io/org/team/tool',
      tag: 'v3',
    })
  })

  test('a digest is the tag value', () => {
    expect(parseImageReference(`nginx@${DIGEST}`)).toEqual({ fromImage: 'nginx', tag: DIGEST })
    expect(parseImageReference(`registry.local:5000/app@${DIGEST}`)).toEqual({
      fromImage: 'registry.local:5000/app',
      tag: DIGEST,
    })
  })

  test('a tag and a digest together are refused', () => {
    expect(() => parseImageReference(`nginx:1.27@${DIGEST}`)).toThrow('Use either a tag or a digest')
  })

  test('an invalid digest is refused', () => {
    expect(() => parseImageReference('nginx@sha256:xyz')).toThrow('The digest after @ is not valid.')
  })

  test('empty input is refused', () => {
    expect(() => parseImageReference('')).toThrow('Enter an image name')
  })

  test('spaces are refused', () => {
    expect(() => parseImageReference('my image')).toThrow('cannot contain spaces')
    expect(() => parseImageReference('nginx:1.27\t')).toThrow('cannot contain spaces')
  })

  test('empty parts are refused', () => {
    expect(() => parseImageReference('nginx:')).toThrow('The tag "" is not valid.')
    expect(() => parseImageReference(':1.27')).toThrow('The image name is missing before the tag.')
    expect(() => parseImageReference('/nginx')).toThrow('The name "(empty)" is not valid.')
    expect(() => parseImageReference('team//app')).toThrow('The name "(empty)" is not valid.')
  })

  test('a name over 255 characters is refused, and 255 is allowed', () => {
    const long = `a${'/a'.repeat(127)}`
    expect(long.length).toBe(255)
    expect(() => parseImageReference(long)).not.toThrow()
    expect(() => parseImageReference(`${long}a`)).toThrow('at most 255 characters')
  })

  test('uppercase repository names are refused', () => {
    expect(() => parseImageReference('Nginx')).toThrow('The name "Nginx" is not valid.')
  })

  test('a tag may not start with a dash or dot', () => {
    expect(() => parseImageReference('nginx:-bad')).toThrow('The tag "-bad" is not valid.')
    expect(() => parseImageReference('nginx:.bad')).toThrow('The tag ".bad" is not valid.')
  })
})
