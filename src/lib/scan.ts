import type { ScanCounts, ScanItem, ScanResult, ScanSeverity, ScanSummary } from '@/lib/types'

// Vulnerability scans, the pure parts: read Trivy's JSON report, sort the findings, pick the badge
// text, and keep the stored results to a fixed size. No I/O here, so the unit tests use plain fixtures.
// The server side (running Trivy, the files) is in src/server/scan.server.ts.

/** The most findings one scan keeps. The counts still cover every finding. */
export const MAX_SCAN_ITEMS = 500
/** The most scans kept in the data folder. The oldest go first. */
export const MAX_STORED_SCANS = 200
/** The longest title kept for a finding. */
const MAX_TITLE = 200

/** Trivy's report, only the fields pow/dock reads. Each one can be missing. */
interface TrivyVulnerability {
  VulnerabilityID?: string
  PkgName?: string
  InstalledVersion?: string
  FixedVersion?: string
  Severity?: string
  Title?: string
  PrimaryURL?: string
}

interface TrivyReport {
  Results?: { Vulnerabilities?: TrivyVulnerability[] | null }[] | null
}

/** Severity order: the most serious first. */
const RANK: Record<ScanSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 }

/** The severities from most to least serious, as the counts are listed. */
export const SEVERITY_ORDER: readonly ScanSeverity[] = ['critical', 'high', 'medium', 'low', 'unknown']

export function emptyCounts(): ScanCounts {
  return { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 }
}

/** Trivy's word for a severity, in pow/dock's lower case. Any other word counts as unknown. */
export function severityOf(value: string | undefined): ScanSeverity {
  switch (value?.toUpperCase()) {
    case 'CRITICAL':
      return 'critical'
    case 'HIGH':
      return 'high'
    case 'MEDIUM':
      return 'medium'
    case 'LOW':
      return 'low'
    default:
      return 'unknown'
  }
}

/** Findings in the order the list shows them: severity, then the ones with a fix, then the package. */
export function compareItems(a: ScanItem, b: ScanItem): number {
  if (RANK[a.severity] !== RANK[b.severity]) return RANK[a.severity] - RANK[b.severity]
  if ((a.fixed !== null) !== (b.fixed !== null)) return a.fixed !== null ? -1 : 1
  return a.pkg.localeCompare(b.pkg) || a.id.localeCompare(b.id)
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

/**
 * The scan result of one image, from the parsed JSON of `trivy image --format json`. A finding
 * without a CVE id is skipped. The counts and the fixable count cover every finding, and the list keeps
 * the first MAX_SCAN_ITEMS of the sorted findings.
 */
export function parseTrivyReport(raw: unknown, imageId: string, scannedAt: string): ScanResult {
  const report: TrivyReport = typeof raw === 'object' && raw !== null ? raw : {}
  const counts = emptyCounts()
  const items: ScanItem[] = []
  let fixable = 0
  const results = Array.isArray(report.Results) ? report.Results : []
  for (const result of results) {
    const vulns = Array.isArray(result?.Vulnerabilities) ? result.Vulnerabilities : []
    for (const vuln of vulns) {
      if (!vuln.VulnerabilityID) continue
      const severity = severityOf(vuln.Severity)
      counts[severity] += 1
      const fixed = vuln.FixedVersion ? vuln.FixedVersion : null
      if (fixed !== null) fixable += 1
      items.push({
        id: vuln.VulnerabilityID,
        severity,
        pkg: vuln.PkgName ?? '',
        installed: vuln.InstalledVersion ?? '',
        fixed,
        title: truncate(vuln.Title ?? '', MAX_TITLE),
        url: vuln.PrimaryURL ? vuln.PrimaryURL : null,
      })
    }
  }
  items.sort(compareItems)
  return { imageId, scannedAt, counts, fixable, items: items.slice(0, MAX_SCAN_ITEMS) }
}

/** The numbers of a scan, without the findings. */
export function summaryOf(result: ScanResult): ScanSummary {
  return { imageId: result.imageId, scannedAt: result.scannedAt, counts: result.counts, fixable: result.fixable }
}

/** The most serious severity that has findings (unknown does not count), or null when there are none. */
export function worstSeverity(counts: ScanCounts): ScanSeverity | null {
  return SEVERITY_ORDER.find((severity) => severity !== 'unknown' && counts[severity] > 0) ?? null
}

/** The badge in the Images list: the worst count ("2 critical"), or "No known issues" when there are none. */
export function scanBadge(counts: ScanCounts): { label: string; tone: 'critical' | 'high' | 'low' | 'none' } {
  const worst = worstSeverity(counts)
  if (worst === null) return { label: 'No known issues', tone: 'none' }
  const tone = worst === 'critical' || worst === 'high' ? worst : 'low'
  return { label: `${counts[worst]} ${worst}`, tone }
}

/** The counts as text for a summary line: "2 critical, 5 high". Only the severities with findings. */
export function countsText(counts: ScanCounts): string {
  const parts = SEVERITY_ORDER.filter((severity) => counts[severity] > 0).map(
    (severity) => `${counts[severity]} ${severity}`,
  )
  return parts.length > 0 ? parts.join(', ') : 'No known issues'
}

/**
 * The findings the dialog shows by default: Critical and High with a fix. With showAll, every finding.
 */
export function visibleItems(items: readonly ScanItem[], showAll: boolean): ScanItem[] {
  if (showAll) return [...items]
  return items.filter((item) => (item.severity === 'critical' || item.severity === 'high') && item.fixed !== null)
}

/**
 * Keeps the stored scans of images that still exist (`existingIds`, when given), then the newest
 * MAX_STORED_SCANS by scan time. Returns a new map and whether anything was dropped.
 */
export function pruneScans(
  scans: Readonly<Record<string, ScanResult>>,
  existingIds?: ReadonlySet<string>,
): { scans: Record<string, ScanResult>; changed: boolean } {
  let entries = Object.entries(scans)
  const before = entries.length
  if (existingIds) entries = entries.filter(([id]) => existingIds.has(id))
  entries.sort(([, a], [, b]) => b.scannedAt.localeCompare(a.scannedAt))
  entries = entries.slice(0, MAX_STORED_SCANS)
  return { scans: Object.fromEntries(entries), changed: entries.length !== before }
}

/** The summaries of stored scans, by image id. */
export function summariesOf(scans: Readonly<Record<string, ScanResult>>): Record<string, ScanSummary> {
  return Object.fromEntries(Object.entries(scans).map(([id, result]) => [id, summaryOf(result)]))
}

function isCounts(value: unknown): value is ScanCounts {
  if (typeof value !== 'object' || value === null) return false
  return SEVERITY_ORDER.every((severity) => typeof (value as Record<string, unknown>)[severity] === 'number')
}

function isItem(value: unknown): value is ScanItem {
  if (typeof value !== 'object' || value === null) return false
  const item = value as Record<string, unknown>
  return (
    typeof item.id === 'string' &&
    typeof item.pkg === 'string' &&
    typeof item.installed === 'string' &&
    typeof item.title === 'string' &&
    (item.fixed === null || typeof item.fixed === 'string') &&
    (item.url === null || typeof item.url === 'string') &&
    SEVERITY_ORDER.includes(item.severity as ScanSeverity)
  )
}

/**
 * The stored scans (scans.json) read back. An entry that does not have the right shape is dropped,
 * so one damaged scan never hides the others.
 */
export function parseStoredScans(value: unknown): Record<string, ScanResult> {
  const out: Record<string, ScanResult> = {}
  const scans = typeof value === 'object' && value !== null ? (value as { scans?: unknown }).scans : undefined
  if (typeof scans !== 'object' || scans === null) return out
  for (const [id, raw] of Object.entries(scans)) {
    if (typeof raw !== 'object' || raw === null) continue
    const scan = raw as Record<string, unknown>
    if (typeof scan.scannedAt !== 'string' || typeof scan.fixable !== 'number' || !isCounts(scan.counts)) continue
    if (!Array.isArray(scan.items) || !scan.items.every(isItem)) continue
    out[id] = { imageId: id, scannedAt: scan.scannedAt, counts: scan.counts, fixable: scan.fixable, items: scan.items }
  }
  return out
}

/**
 * The message for a failed Trivy run: its last FATAL or ERROR line, or its last line. Trivy's
 * stderr is only text, so it is cut to 300 characters here.
 */
export function failureMessage(stderr: string): string {
  const lines = stderr
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  const problem = [...lines].reverse().find((line) => /FATAL|ERROR/.test(line)) ?? lines.at(-1) ?? ''
  const text = problem.replace(/^\S+\s+(FATAL|ERROR)\s+/, '')
  return truncate(text || 'Trivy could not scan the image.', 300)
}
