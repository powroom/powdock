import { expect, test } from 'bun:test'
import { iconSvg } from './image-icon-paths.server'

test('a known key gives an SVG document with its path', () => {
  expect(iconSvg('postgresql')).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 24 24"><path d="M/)
})

test('an unknown key, or an Object prototype name, gives null', () => {
  expect(iconSvg('nope')).toBeNull()
  expect(iconSvg('constructor')).toBeNull()
  expect(iconSvg('__proto__')).toBeNull()
})
