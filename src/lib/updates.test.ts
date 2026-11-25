import { describe, expect, test } from 'bun:test'
import {
  checkReference,
  compareDigests,
  emptyStoredUpdates,
  isCheckDue,
  MIN_CHECK_GAP_MS,
  normalizeReference,
  normalizeRepository,
  parseRepoDigest,
  parseStoredUpdates,
  planChecks,
  repositoryOf,
  isImageIdText,
  updateImageIds,
  type UpdateResult,
} from './updates'

const OLD = 'sha256:98ad9d1a2be345201bb0709b0d38655eb1b370145c7d94ca1fe9c421f76e245a'
const NEW = 'sha256:73aaf090f3d85aa34ee199857f03fa3a95c8ede2ffd4cc2cdb5b94e566b11662'

describe('normalizeRepository', () => {
  test('adds Docker Hub and the library namespace to a bare name', () => {
    expect(normalizeRepository('nginx')).toBe('docker.io/library/nginx')
    expect(normalizeRepository('docker.io/nginx')).toBe('docker.io/library/nginx')
    expect(normalizeRepository('library/nginx')).toBe('docker.io/library/nginx')
  })

  test('keeps other registries and their paths', () => {
    expect(normalizeRepository('ghcr.io/acme/api')).toBe('ghcr.io/acme/api')
    expect(normalizeRepository('localhost:5000/team/app')).toBe('localhost:5000/team/app')
    expect(normalizeRepository('acme/api')).toBe('docker.io/acme/api')
  })

  test('maps the old Docker Hub host names to docker.io', () => {
    expect(normalizeRepository('index.docker.io/library/redis')).toBe('docker.io/library/redis')
  })
})

describe('normalizeReference', () => {
  test('adds latest when there is no tag', () => {
    expect(normalizeReference('nginx')).toBe('docker.io/library/nginx:latest')
  })

  test('keeps a tag and reads a registry port as part of the host, not as a tag', () => {
    expect(normalizeReference('nginx:1.27')).toBe('docker.io/library/nginx:1.27')
    expect(normalizeReference('localhost:5000/app')).toBe('localhost:5000/app:latest')
    expect(normalizeReference('localhost:5000/app:v2')).toBe('localhost:5000/app:v2')
  })

  test('skips the references that are not tagged names', () => {
    expect(normalizeReference(OLD)).toBeNull()
    expect(normalizeReference('<none>:<none>')).toBeNull()
    expect(normalizeReference('<none>')).toBeNull()
    expect(normalizeReference('nginx@sha256:' + 'a'.repeat(64))).toBeNull()
    expect(normalizeReference('')).toBeNull()
  })
})

describe('repositoryOf and parseRepoDigest', () => {
  test('cuts the tag off a normalized reference', () => {
    expect(repositoryOf('docker.io/library/nginx:1.27')).toBe('docker.io/library/nginx')
    expect(repositoryOf('localhost:5000/app:v2')).toBe('localhost:5000/app')
  })

  test('reads a RepoDigests entry', () => {
    expect(parseRepoDigest(`busybox@${OLD}`)).toEqual({ repository: 'docker.io/library/busybox', digest: OLD })
    expect(parseRepoDigest(`ghcr.io/acme/api@${NEW}`)).toEqual({ repository: 'ghcr.io/acme/api', digest: NEW })
    expect(parseRepoDigest('busybox:1.36')).toBeNull()
  })
})

describe('compareDigests', () => {
  test('current when the registry digest is one of the local digests', () => {
    expect(compareDigests(NEW, [`busybox@${OLD}`, `busybox@${NEW}`], 'docker.io/library/busybox')).toBe('current')
  })

  test('update when the repository has digests and none matches', () => {
    expect(compareDigests(NEW, [`busybox@${OLD}`], 'docker.io/library/busybox')).toBe('update')
  })

  test('compares only the digests of the same repository', () => {
    // the same digest under another repository does not count
    expect(compareDigests(NEW, [`other/busybox@${NEW}`], 'docker.io/library/busybox')).toBe('unknown')
    expect(compareDigests(NEW, [`ghcr.io/acme/busybox@${NEW}`], 'docker.io/acme/busybox')).toBe('unknown')
  })

  test('unknown when the image has no digest for the repository', () => {
    expect(compareDigests(NEW, [], 'docker.io/library/busybox')).toBe('unknown')
  })
})

describe('planChecks', () => {
  const images = [
    { id: OLD, repoDigests: [`busybox@${OLD}`] },
    { id: 'sha256:local', repoDigests: [] },
  ]

  test('lists each tagged reference once, with the image the container runs', () => {
    const items = planChecks(
      [
        { image: 'busybox:1.36', imageId: OLD },
        { image: 'busybox:1.36', imageId: OLD },
        { image: 'busybox', imageId: OLD },
      ],
      images,
    )
    expect(items).toEqual([
      {
        reference: 'docker.io/library/busybox:1.36',
        repository: 'docker.io/library/busybox',
        images: [{ id: OLD, repoDigests: [`busybox@${OLD}`] }],
      },
      {
        reference: 'docker.io/library/busybox:latest',
        repository: 'docker.io/library/busybox',
        images: [{ id: OLD, repoDigests: [`busybox@${OLD}`] }],
      },
    ])
  })

  test('a reference keeps every distinct image it runs under', () => {
    const items = planChecks(
      [
        { image: 'busybox:1.36', imageId: OLD },
        { image: 'busybox:1.36', imageId: NEW },
      ],
      [
        { id: OLD, repoDigests: [`busybox@${OLD}`] },
        { id: NEW, repoDigests: [`busybox@${NEW}`] },
      ],
    )
    expect(items).toHaveLength(1)
    expect(items[0]?.images.map((image) => image.id)).toEqual([OLD, NEW])
  })

  test('skips image IDs, digests, images built here and images that are not listed', () => {
    const items = planChecks(
      [
        { image: OLD, imageId: OLD },
        { image: 'myapp:dev', imageId: 'sha256:local' },
        { image: 'busybox:1.36', imageId: 'sha256:gone' },
        { image: 'nginx@sha256:' + 'b'.repeat(64), imageId: OLD },
      ],
      images,
    )
    expect(items).toEqual([])
  })
})

describe('checkReference', () => {
  const item = {
    reference: 'docker.io/library/busybox:1.36',
    repository: 'docker.io/library/busybox',
    images: [
      { id: OLD, repoDigests: [`busybox@${OLD}`] },
      { id: NEW, repoDigests: [`busybox@${NEW}`] },
    ],
  }

  test('update, naming the images behind, when one image of the reference is behind', () => {
    expect(checkReference(NEW, item)).toEqual({ status: 'update', outdatedImageIds: [OLD] })
  })

  test('current when every image of the reference matches the registry', () => {
    expect(checkReference(NEW, { ...item, images: [item.images[1] as (typeof item.images)[number]] })).toEqual({
      status: 'current',
      outdatedImageIds: [],
    })
  })

  test('unknown when no image can be compared', () => {
    expect(checkReference(NEW, { ...item, images: [{ id: OLD, repoDigests: [] }] })).toEqual({
      status: 'unknown',
      outdatedImageIds: [],
    })
  })
})

describe('isCheckDue', () => {
  const now = 10_000_000_000_000

  test('due when no check has run', () => {
    expect(isCheckDue(null, now)).toBe(true)
  })

  test('not due for a check less than an hour old', () => {
    expect(isCheckDue(now - MIN_CHECK_GAP_MS + 1, now)).toBe(false)
  })

  test('due once an hour has passed', () => {
    expect(isCheckDue(now - MIN_CHECK_GAP_MS, now)).toBe(true)
  })
})

describe('parseStoredUpdates', () => {
  const good: UpdateResult = {
    reference: 'docker.io/library/busybox:1.36',
    status: 'update',
    checkedAt: '2026-11-24T10:00:00.000Z',
  }

  test('keeps the valid results and drops the damaged ones', () => {
    const parsed = parseStoredUpdates({
      lastCheckedAt: '2026-11-24T10:00:00.000Z',
      results: {
        [good.reference]: good,
        'docker.io/library/nginx:1.27': { reference: 'docker.io/library/nginx:1.27', status: 'maybe', checkedAt: 'x' },
        'docker.io/library/redis:7': { reference: 'other', status: 'current', checkedAt: 'x' },
      },
    })
    expect(parsed).toEqual({ lastCheckedAt: '2026-11-24T10:00:00.000Z', results: { [good.reference]: good } })
  })

  test('an unreadable file gives an empty state', () => {
    expect(parseStoredUpdates(null)).toEqual(emptyStoredUpdates())
    expect(parseStoredUpdates('text')).toEqual(emptyStoredUpdates())
    expect(parseStoredUpdates({ results: [] })).toEqual({ lastCheckedAt: null, results: {} })
  })
})

describe('updateImageIds and isImageIdText', () => {
  const results: Record<string, UpdateResult> = {
    'docker.io/library/busybox:1.36': {
      reference: 'docker.io/library/busybox:1.36',
      status: 'update',
      checkedAt: 'x',
      outdatedImageIds: [OLD],
    },
    'docker.io/library/nginx:1.27': { reference: 'docker.io/library/nginx:1.27', status: 'current', checkedAt: 'x' },
    'ghcr.io/acme/api:v2': { reference: 'ghcr.io/acme/api:v2', status: 'unknown', checkedAt: 'x', error: 'denied' },
  }

  test('lists the image IDs that are behind, from the results that say update', () => {
    expect([...updateImageIds(results)]).toEqual([OLD])
  })

  test('recognizes a container image shown as an ID, and not a name', () => {
    expect(isImageIdText('98ad9d1a2be3')).toBe(true)
    expect(isImageIdText(OLD)).toBe(true)
    expect(isImageIdText('busybox:1.36')).toBe(false)
    expect(isImageIdText('nginx')).toBe(false)
  })
})
