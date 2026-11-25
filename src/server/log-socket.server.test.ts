import { describe, expect, test } from 'bun:test'
import { logSocketTarget, parseLogParams } from './log-socket.server'

describe('logSocketTarget', () => {
  test('a container log path names the container', () => {
    expect(logSocketTarget('/api/containers/abc123def456/logs')).toEqual({ kind: 'container', id: 'abc123def456' })
  })

  test('a project log path names the project', () => {
    expect(logSocketTarget('/api/projects/shop/logs')).toEqual({ kind: 'project', name: 'shop' })
  })

  test('other paths are not log paths', () => {
    expect(logSocketTarget('/api/containers/abc123def456/terminal')).toBeNull()
    expect(logSocketTarget('/api/containers/abc123def456')).toBeNull()
    expect(logSocketTarget('/api/images/abc/logs')).toBeNull()
    expect(logSocketTarget('/api/containers/a/b/logs')).toBeNull()
  })
})

describe('parseLogParams', () => {
  const container = { kind: 'container', id: 'abc123def456' } as const
  const project = { kind: 'project', name: 'shop' } as const

  test('a container defaults to 500 lines with timestamps', () => {
    expect(parseLogParams(container, new URLSearchParams())).toEqual({ tail: 500, timestamps: true })
  })

  test('a project defaults to 200 lines', () => {
    expect(parseLogParams(project, new URLSearchParams())).toEqual({ tail: 200, timestamps: true })
  })

  test('tail accepts 0 and 10000, and rejects anything else', () => {
    expect(parseLogParams(container, new URLSearchParams('tail=0'))).toEqual({ tail: 0, timestamps: true })
    expect(parseLogParams(container, new URLSearchParams('tail=10000'))).toEqual({ tail: 10000, timestamps: true })
    for (const tail of ['10001', '-1', '1.5', 'all', '']) {
      expect(parseLogParams(container, new URLSearchParams({ tail }))).toEqual({
        error: 'tail must be a whole number from 0 to 10000.',
      })
    }
  })

  test('timestamps is 0 or 1', () => {
    expect(parseLogParams(container, new URLSearchParams('timestamps=0'))).toEqual({ tail: 500, timestamps: false })
    expect(parseLogParams(container, new URLSearchParams('timestamps=yes'))).toEqual({
      error: 'timestamps must be 1 or 0.',
    })
  })
})
