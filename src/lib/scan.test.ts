import { describe, expect, test } from 'bun:test'
import fixture from './__fixtures__/trivy-redis-7-alpine.json'
import {
  compareItems,
  countsText,
  emptyCounts,
  failureMessage,
  MAX_SCAN_ITEMS,
  MAX_STORED_SCANS,
  parseStoredScans,
  parseTrivyReport,
  pruneScans,
  scanBadge,
  severityOf,
  summariesOf,
  visibleItems,
  worstSeverity,
} from './scan'
import type { ScanItem, ScanResult } from './types'

// The fixture is trimmed from real `trivy image --format json` output (redis:7-alpine and alpine:3.22).
// The tests never run Trivy.

const IMAGE = 'sha256:858f009f9709ce576febc734aa78b8f6d624b82571f9ddb6bda4377c833b3499'
const AT = '2026-11-24T10:00:00.000Z'

function item(overrides: Partial<ScanItem>): ScanItem {
  return {
    id: 'CVE-2026-0001',
    severity: 'high',
    pkg: 'pkg',
    installed: '1.0',
    fixed: '1.1',
    title: '',
    url: null,
    ...overrides,
  }
}

describe('parseTrivyReport', () => {
  test('counts every finding by severity and counts the fixable ones', () => {
    const result = parseTrivyReport(fixture, IMAGE, AT)
    expect(result.imageId).toBe(IMAGE)
    expect(result.scannedAt).toBe(AT)
    expect(result.counts).toEqual({ critical: 0, high: 2, medium: 3, low: 1, unknown: 0 })
    expect(result.fixable).toBe(6)
    expect(result.items).toHaveLength(6)
  })

  test('maps the fields of each finding', () => {
    const libssl = parseTrivyReport(fixture, IMAGE, AT).items.find((entry) => entry.pkg === 'libssl3')
    expect(libssl).toEqual({
      id: 'CVE-2026-84782',
      severity: 'high',
      pkg: 'libssl3',
      installed: '3.3.7-r1',
      fixed: '3.3.7-r2',
      title: 'openssl: compat-openssl: openssl: Information disclosure via DTLS handshake retransmission',
      url: 'https://avd.aquasec.com/nvd/cve-2026-84782',
    })
  })

  test('sorts by severity, then fixes first, then package', () => {
    const order = parseTrivyReport(fixture, IMAGE, AT).items.map((entry) => `${entry.severity}:${entry.pkg}`)
    expect(order).toEqual([
      'high:libcrypto3',
      'high:libssl3',
      'medium:libcrypto3',
      'medium:libcrypto3',
      'medium:zlib',
      'low:libcrypto3',
    ])
  })

  test('a report without results is an empty scan', () => {
    expect(parseTrivyReport({ Results: null }, IMAGE, AT)).toEqual({
      imageId: IMAGE,
      scannedAt: AT,
      counts: emptyCounts(),
      fixable: 0,
      items: [],
    })
    expect(parseTrivyReport(null, IMAGE, AT).items).toEqual([])
    expect(parseTrivyReport({ Results: [{ Target: 'x', Class: 'secret' }] }, IMAGE, AT).counts).toEqual(emptyCounts())
  })

  test('a finding without a CVE id is skipped, and a missing severity counts as unknown', () => {
    const raw = {
      Results: [
        {
          Vulnerabilities: [
            { PkgName: 'a', Severity: 'HIGH' },
            { VulnerabilityID: 'CVE-1', PkgName: 'b' },
          ],
        },
      ],
    }
    const result = parseTrivyReport(raw, IMAGE, AT)
    expect(result.counts.high).toBe(0)
    expect(result.counts.unknown).toBe(1)
    expect(result.items).toEqual([
      { id: 'CVE-1', severity: 'unknown', pkg: 'b', installed: '', fixed: null, title: '', url: null },
    ])
  })

  test('keeps at most MAX_SCAN_ITEMS findings, but the counts cover all of them', () => {
    const vulns = Array.from({ length: MAX_SCAN_ITEMS + 25 }, (_, index) => ({
      VulnerabilityID: `CVE-${index}`,
      PkgName: `p${index}`,
      Severity: 'LOW',
      FixedVersion: '',
    }))
    const result = parseTrivyReport({ Results: [{ Vulnerabilities: vulns }] }, IMAGE, AT)
    expect(result.items).toHaveLength(MAX_SCAN_ITEMS)
    expect(result.counts.low).toBe(MAX_SCAN_ITEMS + 25)
    expect(result.fixable).toBe(0)
  })

  test('a long title is cut to 200 characters', () => {
    const raw = { Results: [{ Vulnerabilities: [{ VulnerabilityID: 'CVE-1', Title: 'x'.repeat(400) }] }] }
    const [only] = parseTrivyReport(raw, IMAGE, AT).items
    expect(only?.title.length).toBe(200)
    expect(only?.title.endsWith('…')).toBe(true)
  })
})

describe('severityOf', () => {
  test('reads Trivy words in any case, and anything else is unknown', () => {
    expect(severityOf('CRITICAL')).toBe('critical')
    expect(severityOf('medium')).toBe('medium')
    expect(severityOf('Low')).toBe('low')
    expect(severityOf('NEGLIGIBLE')).toBe('unknown')
    expect(severityOf(undefined)).toBe('unknown')
  })
})

describe('compareItems', () => {
  test('severity beats the fix, and the fix beats the package name', () => {
    const list = [
      item({ severity: 'medium', pkg: 'a', fixed: '1' }),
      item({ severity: 'critical', pkg: 'z', fixed: null }),
      item({ severity: 'critical', pkg: 'b', fixed: '2' }),
      item({ severity: 'critical', pkg: 'a', fixed: null }),
    ].sort(compareItems)
    expect(list.map((entry) => `${entry.severity}/${entry.pkg}/${entry.fixed}`)).toEqual([
      'critical/b/2',
      'critical/a/null',
      'critical/z/null',
      'medium/a/1',
    ])
  })
})

describe('badges and counts', () => {
  test('the badge is the worst count, or no known issues', () => {
    expect(scanBadge({ critical: 2, high: 5, medium: 0, low: 0, unknown: 0 })).toEqual({
      label: '2 critical',
      tone: 'critical',
    })
    expect(scanBadge({ critical: 0, high: 5, medium: 9, low: 0, unknown: 0 })).toEqual({
      label: '5 high',
      tone: 'high',
    })
    expect(scanBadge({ critical: 0, high: 0, medium: 0, low: 3, unknown: 0 })).toEqual({ label: '3 low', tone: 'low' })
    expect(scanBadge({ critical: 0, high: 0, medium: 0, low: 0, unknown: 4 })).toEqual({
      label: 'No known issues',
      tone: 'none',
    })
    expect(scanBadge(emptyCounts())).toEqual({ label: 'No known issues', tone: 'none' })
  })

  test('the worst severity ignores unknown', () => {
    expect(worstSeverity({ critical: 0, high: 0, medium: 1, low: 0, unknown: 9 })).toBe('medium')
    expect(worstSeverity(emptyCounts())).toBeNull()
  })

  test('the summary line lists only the severities with findings', () => {
    expect(countsText({ critical: 2, high: 5, medium: 0, low: 0, unknown: 0 })).toBe('2 critical, 5 high')
    expect(countsText(emptyCounts())).toBe('No known issues')
  })
})

describe('visibleItems', () => {
  const list = [
    item({ id: 'A', severity: 'critical', fixed: null }),
    item({ id: 'B', severity: 'critical', fixed: '1' }),
    item({ id: 'C', severity: 'high', fixed: '1' }),
    item({ id: 'D', severity: 'medium', fixed: '1' }),
  ]

  test('by default only Critical and High with a fix', () => {
    expect(visibleItems(list, false).map((entry) => entry.id)).toEqual(['B', 'C'])
  })

  test('with showAll every finding', () => {
    expect(visibleItems(list, true).map((entry) => entry.id)).toEqual(['A', 'B', 'C', 'D'])
  })
})

describe('pruneScans and summaries', () => {
  function scan(id: string, scannedAt: string): ScanResult {
    return { imageId: id, scannedAt, counts: emptyCounts(), fixable: 0, items: [] }
  }

  test('drops the scans of images that no longer exist', () => {
    const stored = { a: scan('a', AT), b: scan('b', AT) }
    const pruned = pruneScans(stored, new Set(['a']))
    expect(Object.keys(pruned.scans)).toEqual(['a'])
    expect(pruned.changed).toBe(true)
    expect(pruneScans(stored, new Set(['a', 'b'])).changed).toBe(false)
  })

  test('keeps the newest MAX_STORED_SCANS scans', () => {
    const stored: Record<string, ScanResult> = {}
    for (let index = 0; index < MAX_STORED_SCANS + 3; index++) {
      const id = `id${index}`
      stored[id] = scan(id, new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString())
    }
    const pruned = pruneScans(stored)
    expect(Object.keys(pruned.scans)).toHaveLength(MAX_STORED_SCANS)
    expect(pruned.scans).not.toHaveProperty('id0')
    expect(pruned.scans).toHaveProperty(`id${MAX_STORED_SCANS + 2}`)
    expect(pruned.changed).toBe(true)
  })

  test('summaries leave the findings out', () => {
    const result = parseTrivyReport(fixture, IMAGE, AT)
    const summaries = summariesOf({ [IMAGE]: result })
    expect(summaries[IMAGE]).toEqual({ imageId: IMAGE, scannedAt: AT, counts: result.counts, fixable: 6 })
  })
})

describe('parseStoredScans', () => {
  test('reads back what was stored and drops a damaged entry', () => {
    const stored = parseTrivyReport(fixture, IMAGE, AT)
    const back = parseStoredScans({ scans: { [IMAGE]: stored, broken: { scannedAt: AT } } })
    expect(Object.keys(back)).toEqual([IMAGE])
    expect(back[IMAGE]).toEqual(stored)
  })

  test('anything that is not the file format is empty', () => {
    expect(parseStoredScans(null)).toEqual({})
    expect(parseStoredScans({ scans: 'x' })).toEqual({})
    expect(parseStoredScans([])).toEqual({})
  })
})

describe('failureMessage', () => {
  test('uses the last FATAL line, without the log prefix', () => {
    const stderr = [
      '2026-11-24T10:00:00Z INFO  Vulnerability scanning is enabled',
      '2026-11-24T10:00:05Z FATAL image scan error: unable to find the image',
    ].join('\n')
    expect(failureMessage(stderr)).toBe('image scan error: unable to find the image')
  })

  test('falls back to the last line, and to a fixed text for empty output', () => {
    expect(failureMessage('first\nsecond\n')).toBe('second')
    expect(failureMessage('  \n')).toBe('Trivy could not scan the image.')
  })
})
