import { describe, expect, test } from 'bun:test'
import { formatContainerStatus } from './container-status'

describe('formatContainerStatus: running containers', () => {
  test('seconds are "just now"', () => {
    expect(formatContainerStatus('Up Less than a second')).toBe('Up just now')
    expect(formatContainerStatus('Up 1 second')).toBe('Up just now')
    expect(formatContainerStatus('Up 45 seconds')).toBe('Up just now')
  })

  test('minutes, hours, days, weeks, months and years are short', () => {
    expect(formatContainerStatus('Up About a minute')).toBe('Up 1m')
    expect(formatContainerStatus('Up 1 minute')).toBe('Up 1m')
    expect(formatContainerStatus('Up 39 minutes')).toBe('Up 39m')
    expect(formatContainerStatus('Up About an hour')).toBe('Up 1h')
    expect(formatContainerStatus('Up 5 hours')).toBe('Up 5h')
    expect(formatContainerStatus('Up 3 days')).toBe('Up 3d')
    expect(formatContainerStatus('Up 2 weeks')).toBe('Up 14d')
    expect(formatContainerStatus('Up 4 months')).toBe('Up 4mo')
    expect(formatContainerStatus('Up 2 years')).toBe('Up 2y')
  })

  test('the health word follows " · "', () => {
    expect(formatContainerStatus('Up 2 hours (healthy)')).toBe('Up 2h · healthy')
    expect(formatContainerStatus('Up 2 hours (unhealthy)')).toBe('Up 2h · unhealthy')
    expect(formatContainerStatus('Up 2 hours (health: starting)')).toBe('Up 2h · starting')
  })

  test('a paused container says Paused, then its age', () => {
    expect(formatContainerStatus('Up 2 hours (Paused)')).toBe('Paused · 2h')
  })
})

describe('formatContainerStatus: stopped and restarting containers', () => {
  test('the exit code stays, and the age follows " · "', () => {
    expect(formatContainerStatus('Exited (143) 6 days ago')).toBe('Exited (143) · 6d ago')
    expect(formatContainerStatus('Exited (0) 18 hours ago')).toBe('Exited (0) · 18h ago')
    expect(formatContainerStatus('Exited (0) About an hour ago')).toBe('Exited (0) · 1h ago')
  })

  test('a just-now age has no "ago"', () => {
    expect(formatContainerStatus('Restarting (1) 5 seconds ago')).toBe('Restarting (1) · just now')
  })
})

describe('formatContainerStatus: unknown text', () => {
  test('text this does not know is returned unchanged', () => {
    expect(formatContainerStatus('Created')).toBe('Created')
    expect(formatContainerStatus('Removal In Progress')).toBe('Removal In Progress')
    expect(formatContainerStatus('Dead')).toBe('Dead')
    expect(formatContainerStatus('Exited (1) at some point')).toBe('Exited (1) at some point')
    expect(formatContainerStatus('Up sometime')).toBe('Up sometime')
    expect(formatContainerStatus('Foo (healthy)')).toBe('Foo (healthy)')
  })
})
