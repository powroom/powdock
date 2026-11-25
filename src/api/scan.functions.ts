import { createServerFn } from '@tanstack/react-start'
import type { ScanResult, ScanStatus, ScanSummary } from '@/lib/types'
import { scanValidators } from './validators'

// Every function here needs a session: the global middleware in src/start.ts rejects them without one.
// The scanner lives in src/server/scan.server.ts.

/** Whether Trivy is installed, and which scans run or wait. */
export const scanStatusFn = createServerFn({ method: 'GET' }).handler(async (): Promise<ScanStatus> => {
  const { scanStatus } = await import('@/server/scan.server')
  const { withClientErrors } = await import('@/lib/redact')
  return withClientErrors(() => scanStatus(), 'Could not read the scan status.')
})

/** The numbers of every stored scan, by image id (for the badges on the Images and Containers pages). */
export const scanSummariesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Record<string, ScanSummary>> => {
    const { scanSummaries } = await import('@/server/scan.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => scanSummaries(), 'Could not read the scan results.')
  },
)

/** The stored result of one image, or null when it was never scanned. */
export const scanResultFn = createServerFn({ method: 'POST' })
  .validator(scanValidators().imageInput)
  .handler(async ({ data }): Promise<ScanResult | null> => {
    const { scanResult } = await import('@/server/scan.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => scanResult(data.id), 'Could not read the scan result.')
  })

/** Scans one image. Starts the scan, or joins the one that runs; returns when it is done. */
export const scanImageFn = createServerFn({ method: 'POST' })
  .validator(scanValidators().imageInput)
  .handler(async ({ data }): Promise<ScanResult> => {
    const { scanImage } = await import('@/server/scan.server')
    const { withClientErrors } = await import('@/lib/redact')
    return withClientErrors(() => scanImage(data.id), 'Could not scan the image.')
  })
