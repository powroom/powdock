import { describe, expect, test } from 'bun:test'
import type { ProjectBase } from './compose'
import {
  idleProjects,
  keepExisting,
  LAST_SEEN_STEP_MS,
  observeProjects,
  rememberProject,
  type RememberedProject,
} from './projects-memory'

const NOW = new Date('2026-11-24T10:00:00.000Z')

function base(name: string, configFiles = [`/work/${name}/compose.yaml`], running = 1): ProjectBase {
  return {
    name,
    workingDir: `/work/${name}`,
    configFiles,
    services: ['web'],
    running,
    total: running,
    containsSelf: false,
  }
}

function remembered(name: string, lastSeen = NOW.toISOString()): RememberedProject {
  return {
    name,
    workingDir: `/work/${name}`,
    configFiles: [`/work/${name}/compose.yaml`],
    createdByPowdock: false,
    lastSeen,
  }
}

describe('observeProjects', () => {
  test('a new project with containers is remembered', () => {
    const result = observeProjects([], [base('web')], NOW)
    expect(result.changed).toBe(true)
    expect(result.projects).toEqual([
      {
        name: 'web',
        workingDir: '/work/web',
        configFiles: ['/work/web/compose.yaml'],
        createdByPowdock: false,
        lastSeen: NOW.toISOString(),
      },
    ])
  })

  test('a project seen again soon after is not written again', () => {
    const known = [remembered('web', new Date(NOW.getTime() - 60_000).toISOString())]
    const result = observeProjects(known, [base('web')], NOW)
    expect(result.changed).toBe(false)
  })

  test('lastSeen is refreshed after the step, and a moved folder always', () => {
    const old = new Date(NOW.getTime() - LAST_SEEN_STEP_MS).toISOString()
    expect(observeProjects([remembered('web', old)], [base('web')], NOW).changed).toBe(true)
    const moved = { ...base('web'), workingDir: '/elsewhere/web' }
    const result = observeProjects([remembered('web')], [moved], NOW)
    expect(result.changed).toBe(true)
    expect(result.projects[0]!.workingDir).toBe('/elsewhere/web')
  })

  test('keeps createdByPowdock when the project is seen again', () => {
    const made = { ...remembered('web'), createdByPowdock: true }
    const result = observeProjects([made], [base('web')], NOW)
    expect(result.projects[0]!.createdByPowdock).toBe(true)
  })

  test('a project without a folder or config files is not remembered', () => {
    expect(observeProjects([], [{ ...base('x'), workingDir: '' }], NOW).changed).toBe(false)
    expect(observeProjects([], [base('x', [])], NOW).changed).toBe(false)
  })
})

describe('idleProjects, keepExisting and rememberProject', () => {
  test('the remembered projects without containers become rows with 0 of 0', () => {
    const rows = idleProjects([remembered('db'), remembered('web')], new Set(['web']))
    expect(rows).toEqual([
      {
        name: 'db',
        workingDir: '/work/db',
        configFiles: ['/work/db/compose.yaml'],
        services: [],
        running: 0,
        total: 0,
        containsSelf: false,
      },
    ])
  })

  test('keepExisting drops a project whose config file is gone, or that has no config file', () => {
    const list = [remembered('a'), remembered('b'), { ...remembered('c'), configFiles: [] }]
    const kept = keepExisting(list, (file) => file === '/work/a/compose.yaml')
    expect(kept.map((entry) => entry.name)).toEqual(['a'])
  })

  test('rememberProject replaces a project with the same name', () => {
    const list = rememberProject([remembered('web')], { ...remembered('web'), createdByPowdock: true })
    expect(list).toHaveLength(1)
    expect(list[0]!.createdByPowdock).toBe(true)
  })
})
