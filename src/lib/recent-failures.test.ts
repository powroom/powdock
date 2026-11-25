import { describe, expect, test } from 'bun:test'
import {
  agoMsOf,
  bootTimeFrom,
  exitCandidates,
  exitOf,
  failureOf,
  finishedAfterBoot,
  MAX_INSPECTED,
  OOM_REASON,
  type ExitedCandidate,
} from './recent-failures'
import type { ContainerState } from './types'

const NOW = Date.parse('2026-11-24T08:00:00Z')
const BOOT = Date.parse('2026-11-24T01:04:00Z')

function listed(id: string, status: string, state: ContainerState = 'exited') {
  return { id, name: `c-${id}`, state, status }
}

function candidate(overrides: Partial<ExitedCandidate> = {}): ExitedCandidate {
  return { id: 'a', name: 'app', code: 1, agoMs: 2 * 60 * 60 * 1000, ...overrides }
}

describe('ago and exit text', () => {
  test('Docker status text is read', () => {
    expect(exitOf('Exited (137) 2 hours ago')).toEqual({ code: 137, agoMs: 7_200_000 })
    expect(exitOf('Exited (0) About an hour ago')).toEqual({ code: 0, agoMs: 3_600_000 })
    expect(exitOf('Up 2 hours')).toBeNull()
    expect(agoMsOf('yesterday')).toBeNull()
    expect(agoMsOf('Less than a second ago')).toBe(0)
  })
})

describe('exitCandidates', () => {
  test('normal stops are not candidates: code 0, Ctrl+C (130) and docker stop (143)', () => {
    const found = exitCandidates([
      listed('zero', 'Exited (0) 1 hour ago'),
      listed('ctrlc', 'Exited (130) 1 hour ago'),
      listed('term', 'Exited (143) 2 hours ago'),
    ])
    expect(found).toEqual([])
  })

  test('running containers, old stops and unknown text are not candidates', () => {
    const found = exitCandidates([
      listed('up', 'Up 3 hours', 'running'),
      listed('old', 'Exited (1) 3 days ago'),
      listed('odd', 'Exited (1) at some point'),
    ])
    expect(found).toEqual([])
  })

  test('a non-zero stop in the last day is a candidate, the most recent first, at most 10', () => {
    const many = Array.from({ length: 12 }, (_, index) => listed(`c${index}`, `Exited (1) ${index + 3} hours ago`))
    const found = exitCandidates([
      listed('two', 'Exited (2) 2 hours ago'),
      listed('one', 'Exited (1) 1 hour ago'),
      ...many,
    ])
    expect(found).toHaveLength(MAX_INSPECTED)
    expect(found[0]?.id).toBe('one')
    expect(found[1]?.id).toBe('two')
  })
})

describe('bootTimeFrom', () => {
  test('the boot time is now minus the uptime in the first number of /proc/uptime', () => {
    expect(bootTimeFrom('3600.50 7000.10\n', NOW)).toBe(NOW - 3_600_500)
  })

  test('an unreadable or empty or odd file gives null, so no boot filter is applied', () => {
    expect(bootTimeFrom(null, NOW)).toBeNull()
    expect(bootTimeFrom('', NOW)).toBeNull()
    expect(bootTimeFrom('soon', NOW)).toBeNull()
  })
})

describe('finishedAfterBoot', () => {
  test('a stop before the boot does not count, a stop after it does', () => {
    expect(finishedAfterBoot('2026-11-24T00:56:20Z', BOOT)).toBe(false)
    expect(finishedAfterBoot('2026-11-24T05:56:20Z', BOOT)).toBe(true)
  })

  test('no boot time means no filter; a missing finish time with a boot time does not count', () => {
    expect(finishedAfterBoot('2026-11-24T00:56:20Z', null)).toBe(true)
    expect(finishedAfterBoot(null, BOOT)).toBe(false)
    expect(finishedAfterBoot('0001-01-01T00:00:00Z', BOOT)).toBe(false)
  })
})

describe('failureOf', () => {
  const finishedRecently = { oomKilled: false, finishedAt: '2026-11-24T05:56:20Z' }

  test('a non-zero code after the boot is shown with its age', () => {
    expect(failureOf(candidate({ code: 255 }), finishedRecently, BOOT, NOW)).toEqual({
      id: 'a',
      name: 'app',
      reason: 'Stopped with code 255, 2h ago',
    })
  })

  test('an out-of-memory kill is shown as such, whatever the code', () => {
    const oom = { oomKilled: true, finishedAt: '2026-11-24T05:56:20Z' }
    expect(failureOf(candidate({ code: 137 }), oom, BOOT, NOW)?.reason).toBe(OOM_REASON)
  })

  test('a 137 that was not an out-of-memory kill (docker stop after its timeout) is not shown', () => {
    expect(failureOf(candidate({ code: 137 }), finishedRecently, BOOT, NOW)).toBeNull()
  })

  test('a stop before the last boot is never shown, for a code or for an out-of-memory kill', () => {
    const beforeBoot = { oomKilled: false, finishedAt: '2026-11-24T00:56:20Z' }
    expect(failureOf(candidate({ code: 255 }), beforeBoot, BOOT, NOW)).toBeNull()
    expect(
      failureOf(candidate({ code: 137 }), { oomKilled: true, finishedAt: '2026-11-24T00:56:20Z' }, BOOT, NOW),
    ).toBeNull()
  })

  test('without a boot time the boot filter is skipped', () => {
    const beforeBoot = { oomKilled: false, finishedAt: '2026-11-24T00:56:20Z' }
    expect(failureOf(candidate({ code: 255 }), beforeBoot, null, NOW)?.reason).toBe('Stopped with code 255, 2h ago')
  })
})
