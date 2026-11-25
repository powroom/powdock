import { expect, test } from 'bun:test'
import * as simpleIcons from 'simple-icons'
import { ICON_SET_VERSION, IMAGE_ICON_HEX } from './image-icon-colors'

const installed = JSON.parse(
  await Bun.file(new URL('../../node_modules/simple-icons/package.json', import.meta.url)).text(),
) as { version: string }

test('the icon set version is the installed simple-icons version', () => {
  expect(ICON_SET_VERSION).toBe(installed.version)
})

test('every image icon color is the simple-icons hex of its key', () => {
  const icons = simpleIcons as unknown as Record<string, { hex: string } | undefined>
  for (const [key, hex] of Object.entries(IMAGE_ICON_HEX)) {
    // The export of a key is "si" with the key's first letter in upper case, such as siPostgresql.
    expect(icons[`si${key.charAt(0).toUpperCase()}${key.slice(1)}`]?.hex, key).toBe(hex)
  }
})
