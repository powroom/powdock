import { describe, expect, test } from 'bun:test'
import type { ContainerSummary } from '@/lib/types'
import {
  containerLabel,
  containerTone,
  currentProjectOf,
  idleOnly,
  parseNameList,
  projectTone,
  toggleName,
  withName,
} from './sidebar-tree'

function container(overrides: Partial<ContainerSummary> & { name: string }): ContainerSummary {
  return {
    id: `${overrides.name}-id`,
    shortId: overrides.name.slice(0, 12),
    image: 'nginx:1.27',
    imageId: '',
    state: 'running',
    status: 'Up 1 hour',
    createdAt: '2026-11-01T00:00:00.000Z',
    ports: [],
    project: null,
    service: null,
    isSelf: false,
    ...overrides,
  }
}

const WEB = container({ name: 'shop-web-1', project: 'shop', service: 'web' })
const DB = container({ name: 'shop-db-1', project: 'shop', service: 'db', state: 'exited' })
const CACHE = container({ name: 'shop-cache-1', project: 'shop', service: 'cache', state: 'paused' })
const LOOSE = container({ name: 'redis-scratch', state: 'restarting' })

describe('state dots', () => {
  test('a container is green while it runs, amber when paused or restarting, grey otherwise', () => {
    expect(containerTone(WEB)).toBe('success')
    expect(containerTone(CACHE)).toBe('warning')
    expect(containerTone(LOOSE)).toBe('warning')
    expect(containerTone(DB)).toBe('muted')
    expect(containerTone(container({ name: 'x', state: 'created' }))).toBe('muted')
  })

  test('a project is green when any container runs, grey when none runs', () => {
    expect(projectTone([WEB, container({ name: 'shop-api-1', state: 'running' })])).toBe('success')
    expect(projectTone([WEB, DB])).toBe('success')
    expect(projectTone([DB, CACHE])).toBe('muted')
    expect(projectTone([])).toBe('muted')
  })
})

describe('labels', () => {
  test('the Compose service is the label, the container name is the fallback', () => {
    expect(containerLabel(WEB)).toBe('web')
    expect(containerLabel(LOOSE)).toBe('redis-scratch')
    expect(containerLabel(container({ name: 'acme-portal', service: '' }))).toBe('acme-portal')
  })
})

describe('expanded projects', () => {
  test('toggling adds or removes one project', () => {
    expect(toggleName(['shop'], 'acme')).toEqual(['shop', 'acme'])
    expect(toggleName(['shop', 'acme'], 'shop')).toEqual(['acme'])
  })

  test('the project of the open page is added once', () => {
    expect(withName(['acme'], 'shop')).toEqual(['acme', 'shop'])
    const list = ['shop']
    expect(withName(list, 'shop')).toBe(list)
    expect(withName(list, null)).toBe(list)
  })
})

describe('stored lists', () => {
  test('reads a JSON array of strings and drops anything else', () => {
    expect(parseNameList('["shop",3,"acme"]')).toEqual(['shop', 'acme'])
    expect(parseNameList('[]')).toEqual([])
    expect(parseNameList(null)).toBeNull()
    expect(parseNameList('{"shop":true}')).toBeNull()
    expect(parseNameList('not json')).toBeNull()
  })
})

describe('the open page', () => {
  const containers = [WEB, DB, container({ name: 'acme-portal', id: 'portal-id', project: 'acme' })]

  test('a project page names its project', () => {
    expect(currentProjectOf({ projectName: 'shop' }, containers)).toBe('shop')
  })

  test('a container page takes the project of that container', () => {
    expect(currentProjectOf({ containerId: WEB.id }, containers)).toBe('shop')
    expect(currentProjectOf({ containerId: 'portal-id' }, containers)).toBe('acme')
  })

  test('a loose container, an unknown id or another page has no project', () => {
    expect(currentProjectOf({ containerId: LOOSE.id }, [LOOSE])).toBeNull()
    expect(currentProjectOf({ containerId: 'missing' }, containers)).toBeNull()
    expect(currentProjectOf({}, containers)).toBeNull()
  })
})

describe('idle projects', () => {
  test('keeps only the remembered projects that have no containers now', () => {
    const idle = [{ name: 'shop' }, { name: 'blog' }, { name: 'wiki' }]
    expect(idleOnly(idle, ['shop'])).toEqual([{ name: 'blog' }, { name: 'wiki' }])
    expect(idleOnly(idle, [])).toEqual(idle)
  })
})
