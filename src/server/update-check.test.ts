import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import { createUpdateCheck, installMethod, parseReleaseResponse, updateCheckEnabled } from './update-check.server'

const DEFAULT_URL = 'https://api.github.com/repos/powroom/powdock/releases/latest'
const HOUR = 60 * 60 * 1000

const RELEASE = {
  tag_name: 'v0.1.1',
  html_url: 'https://github.com/powroom/powdock/releases/tag/v0.1.1',
  published_at: '2026-11-20T10:00:00Z',
  body: 'Faster table loading.',
  draft: false,
  prerelease: false,
}

/** A clock the test moves by hand. */
function fakeClock(start = 1_000_000_000) {
  let time = start
  return {
    now: () => time,
    advance: (ms: number) => {
      time += ms
    },
  }
}

interface Call {
  url: string
  headers: Record<string, string>
  signal: AbortSignal | undefined
}

/** A fetch that records each call and answers with what `answer` returns. */
function fakeFetch(answer: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
    const call: Call = {
      url: String(input),
      headers: (init?.headers ?? {}) as Record<string, string>,
      signal: init?.signal ?? undefined,
    }
    calls.push(call)
    return answer(call)
  }
  return { fetch: fetchImpl as unknown as typeof fetch, calls }
}

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } })

let errors: ReturnType<typeof spyOn>
beforeEach(() => {
  errors = spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  errors.mockRestore()
})

describe('getUpdateInfo', () => {
  test('reports a newer release, with its details', async () => {
    const fake = fakeFetch(() => json(RELEASE))
    const check = createUpdateCheck()
    const info = await check({ fetch: fake.fetch, env: {}, current: '0.1.0', now: fakeClock().now })
    expect(info).toEqual({
      current: '0.1.0',
      install: 'source',
      latest: {
        version: '0.1.1',
        url: RELEASE.html_url,
        publishedAt: RELEASE.published_at,
        notes: 'Faster table loading.',
      },
    })
  })

  test('asks GitHub with the release headers and a User-Agent that has only the version', async () => {
    const fake = fakeFetch(() => json(RELEASE))
    await createUpdateCheck()({ fetch: fake.fetch, env: {}, current: '0.1.0', now: fakeClock().now })
    expect(fake.calls).toHaveLength(1)
    expect(fake.calls[0]!.url).toBe(DEFAULT_URL)
    expect(fake.calls[0]!.headers).toEqual({
      Accept: 'application/vnd.github+json',
      'User-Agent': 'powdock/0.1.0',
    })
    expect(fake.calls[0]!.signal).toBeDefined()
  })

  test('the same version reports no update', async () => {
    const fake = fakeFetch(() => json({ ...RELEASE, tag_name: 'v0.1.0' }))
    const info = await createUpdateCheck()({ fetch: fake.fetch, env: {}, current: '0.1.0', now: fakeClock().now })
    expect(info.latest).toBeNull()
  })

  test('an older release reports no update', async () => {
    const fake = fakeFetch(() => json({ ...RELEASE, tag_name: 'v0.0.9' }))
    const info = await createUpdateCheck()({ fetch: fake.fetch, env: {}, current: '0.1.0', now: fakeClock().now })
    expect(info.latest).toBeNull()
  })

  test('drafts and prereleases are ignored', async () => {
    const prerelease = fakeFetch(() => json({ ...RELEASE, prerelease: true }))
    const draft = fakeFetch(() => json({ ...RELEASE, draft: true }))
    const options = { env: {}, current: '0.1.0', now: fakeClock().now }
    expect((await createUpdateCheck()({ ...options, fetch: prerelease.fetch })).latest).toBeNull()
    expect((await createUpdateCheck()({ ...options, fetch: draft.fetch })).latest).toBeNull()
  })

  test('disabled with POWDOCK_UPDATE_CHECK off, false or 0: no request is made', async () => {
    for (const value of ['off', 'false', '0', 'OFF']) {
      const fake = fakeFetch(() => json(RELEASE))
      const info = await createUpdateCheck()({
        fetch: fake.fetch,
        env: { POWDOCK_UPDATE_CHECK: value },
        current: '0.1.0',
        now: fakeClock().now,
      })
      expect(info.latest).toBeNull()
      expect(fake.calls).toHaveLength(0)
    }
  })

  test('the check is on when POWDOCK_UPDATE_CHECK is not set or set to anything else', () => {
    expect(updateCheckEnabled({})).toBe(true)
    expect(updateCheckEnabled({ POWDOCK_UPDATE_CHECK: 'on' })).toBe(true)
    expect(updateCheckEnabled({ POWDOCK_UPDATE_CHECK: 'off' })).toBe(false)
    expect(updateCheckEnabled({ POWDOCK_UPDATE_CHECK: ' 0 ' })).toBe(false)
  })

  test('POWDOCK_UPDATE_URL replaces the release address', async () => {
    const fake = fakeFetch(() => json(RELEASE))
    await createUpdateCheck()({
      fetch: fake.fetch,
      env: { POWDOCK_UPDATE_URL: 'http://127.0.0.1:9999/latest' },
      current: '0.1.0',
      now: fakeClock().now,
    })
    expect(fake.calls[0]!.url).toBe('http://127.0.0.1:9999/latest')
  })

  test('a failed check is cached for an hour, then tried again', async () => {
    const clock = fakeClock()
    let fail = true
    const fake = fakeFetch(() => (fail ? new Response('busy', { status: 503 }) : json(RELEASE)))
    const check = createUpdateCheck()
    const options = { fetch: fake.fetch, env: {}, current: '0.1.0', now: clock.now }

    expect((await check(options)).latest).toBeNull()
    clock.advance(HOUR - 60_000)
    expect((await check(options)).latest).toBeNull()
    expect(fake.calls).toHaveLength(1)

    clock.advance(2 * 60_000)
    fail = false
    expect((await check(options)).latest?.version).toBe('0.1.1')
    expect(fake.calls).toHaveLength(2)
  })

  test('a successful check is cached for a day', async () => {
    const clock = fakeClock()
    const fake = fakeFetch(() => json(RELEASE))
    const check = createUpdateCheck()
    const options = { fetch: fake.fetch, env: {}, current: '0.1.0', now: clock.now }

    expect((await check(options)).latest?.version).toBe('0.1.1')
    clock.advance(23 * HOUR)
    expect((await check(options)).latest?.version).toBe('0.1.1')
    expect(fake.calls).toHaveLength(1)

    clock.advance(2 * HOUR)
    await check(options)
    expect(fake.calls).toHaveLength(2)
  })

  test('malformed JSON gives no update, and the failure is cached', async () => {
    const fake = fakeFetch(() => new Response('<html>not json</html>', { status: 200 }))
    const check = createUpdateCheck()
    const options = { fetch: fake.fetch, env: {}, current: '0.1.0', now: fakeClock().now }
    expect((await check(options)).latest).toBeNull()
    expect((await check(options)).latest).toBeNull()
    expect(fake.calls).toHaveLength(1)
    expect(errors).not.toHaveBeenCalled()
  })

  test('a response missing the release fields gives no update', async () => {
    const bad = [
      { tag_name: 'v0.1.1' },
      { ...RELEASE, tag_name: 'latest' },
      { ...RELEASE, html_url: 'javascript:alert(1)' },
      { ...RELEASE, body: 42 },
      null,
    ]
    for (const data of bad) {
      const fake = fakeFetch(() => json(data))
      const info = await createUpdateCheck()({
        fetch: fake.fetch,
        env: {},
        current: '0.1.0',
        now: fakeClock().now,
      })
      expect(info.latest).toBeNull()
    }
  })

  test('a timeout or network error gives no update and does not throw', async () => {
    const timeout = new DOMException('The operation timed out.', 'TimeoutError')
    const timedOut = fakeFetch(() => Promise.reject(timeout))
    const offline = fakeFetch(() => Promise.reject(new TypeError('fetch failed')))
    const options = { env: {}, current: '0.1.0', now: fakeClock().now }
    const first = await createUpdateCheck()({ ...options, fetch: timedOut.fetch })
    const second = await createUpdateCheck()({ ...options, fetch: offline.fetch })
    expect(first.latest).toBeNull()
    expect(second.latest).toBeNull()
    expect(errors).not.toHaveBeenCalled()
  })

  test('a failed check is silent: nothing is logged', async () => {
    const fake = fakeFetch(() => new Response('no', { status: 500 }))
    const info = await createUpdateCheck()({ fetch: fake.fetch, env: {}, current: '0.1.0', now: fakeClock().now })
    expect(info.latest).toBeNull()
    expect(errors).not.toHaveBeenCalled()
  })

  test('a repository without releases (404) is no update, not a failure, and is cached for a day', async () => {
    const fake = fakeFetch(() => new Response('Not Found', { status: 404 }))
    const clock = fakeClock()
    const check = createUpdateCheck()
    const options = { fetch: fake.fetch, env: {}, current: '0.1.0', now: clock.now }
    expect((await check(options)).latest).toBeNull()
    clock.advance(2 * 60 * 60 * 1000)
    await check(options)
    expect(fake.calls).toHaveLength(1)
    expect(errors).not.toHaveBeenCalled()
  })

  test('concurrent callers share one request', async () => {
    let finish: (response: Response) => void = () => {}
    const fake = fakeFetch(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve
        }),
    )
    const check = createUpdateCheck()
    const options = { fetch: fake.fetch, env: {}, current: '0.1.0', now: fakeClock().now }
    const calls = [check(options), check(options), check(options)]
    finish(json(RELEASE))
    const results = await Promise.all(calls)
    expect(fake.calls).toHaveLength(1)
    for (const result of results) expect(result.latest?.version).toBe('0.1.1')
  })

  test('release notes are kept to 4000 characters', () => {
    const parsed = parseReleaseResponse({ ...RELEASE, body: 'x'.repeat(5000) })
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(parsed.release?.notes).toHaveLength(4000)
  })
})

describe('installMethod', () => {
  test('docker and npm come from POWDOCK_INSTALL, anything else is source', () => {
    expect(installMethod({ POWDOCK_INSTALL: 'docker' })).toBe('docker')
    expect(installMethod({ POWDOCK_INSTALL: 'npm' })).toBe('npm')
    expect(installMethod({ POWDOCK_INSTALL: 'NPM' })).toBe('npm')
    expect(installMethod({ POWDOCK_INSTALL: 'brew' })).toBe('source')
    expect(installMethod({})).toBe('source')
  })
})
