import { describe, expect, test } from 'bun:test'
import { EMPTY_COMPOSE_FILE, newProjectNameProblem, projectFolderText } from './new-project'

describe('newProjectNameProblem', () => {
  test('accepts lowercase names with digits, dashes and underscores', () => {
    expect(newProjectNameProblem('web')).toBeNull()
    expect(newProjectNameProblem('web-2_api')).toBeNull()
    expect(newProjectNameProblem('1app')).toBeNull()
  })

  test('refuses empty names, capitals, dots, a leading dash and long names', () => {
    expect(newProjectNameProblem('')).toContain('Enter a name')
    expect(newProjectNameProblem('Web')).toContain('lowercase')
    expect(newProjectNameProblem('a.b')).toContain('lowercase')
    expect(newProjectNameProblem('-a')).toContain('lowercase')
    expect(newProjectNameProblem('a'.repeat(65))).toContain('at most 64')
  })
})

describe('projectFolderText and the empty file', () => {
  test('joins the projects folder and the name, without a doubled slash', () => {
    expect(projectFolderText('/home/me/powdock-projects/', 'web')).toBe('/home/me/powdock-projects/web')
    expect(projectFolderText('/srv', 'web')).toBe('/srv/web')
  })

  test('the empty file is five comment lines with one example service', () => {
    const lines = EMPTY_COMPOSE_FILE.split('\n')
    expect(lines.slice(0, 5).every((line) => line.startsWith('#'))).toBe(true)
    expect(lines[1]).toBe('# services:')
    expect(Bun.YAML.parse(EMPTY_COMPOSE_FILE)).toBeNull()
  })
})
