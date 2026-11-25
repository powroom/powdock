/**
 * Keeps the result of a load for `ttlMs`. Overlapping calls share one load. A failed load is not kept,
 * so the next call asks again. `now` is passed in, so the tests can move the clock.
 */
export function createTtlCache<T>(ttlMs: number, now: () => number = () => Date.now()) {
  let entry: { value: T; at: number } | null = null
  let inFlight: Promise<T> | null = null

  return (load: () => Promise<T>): Promise<T> => {
    if (entry && now() - entry.at < ttlMs) return Promise.resolve(entry.value)
    if (inFlight) return inFlight
    const started = load()
      .then((value) => {
        entry = { value, at: now() }
        return value
      })
      .finally(() => {
        inFlight = null
      })
    inFlight = started
    return started
  }
}
