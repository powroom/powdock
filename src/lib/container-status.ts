// Docker's status text in the compact style: "Up 2 hours (healthy)" becomes "Up 2h · healthy". Text
// this does not know is returned unchanged. The raw text stays in the row's title.

const HEALTH_WORDS: Record<string, string> = {
  healthy: 'healthy',
  unhealthy: 'unhealthy',
  'health: starting': 'starting',
}

// "2 hours", "About an hour", "Less than a second": the count (or a/an) and the unit.
const AGE = /^(?:About |Less than )?(a|an|\d+) (second|minute|hour|day|week|month|year)s?$/

const SHORT_UNIT: Record<string, (count: number) => string> = {
  second: () => 'just now',
  minute: (count) => `${count}m`,
  hour: (count) => `${count}h`,
  day: (count) => `${count}d`,
  week: (count) => `${count * 7}d`,
  month: (count) => `${count}mo`,
  year: (count) => `${count}y`,
}

/** A Docker age in the short form, without "ago": "2h", "1m", "just now". Null for text this does not know. */
function shortAge(text: string): string | null {
  const match = AGE.exec(text)
  if (!match) return null
  const count = match[1] === 'a' || match[1] === 'an' ? 1 : Number(match[1])
  return SHORT_UNIT[match[2] ?? '']?.(count) ?? null
}

export function formatContainerStatus(status: string): string {
  const health = /^(.+) \((healthy|unhealthy|health: starting)\)$/.exec(status)
  if (health) {
    const base = formatContainerStatus(health[1] ?? '')
    return base === health[1] ? status : `${base} · ${HEALTH_WORDS[health[2] ?? ''] ?? ''}`
  }

  const paused = /^Up (.+) \(Paused\)$/.exec(status)
  if (paused) {
    const age = shortAge(paused[1] ?? '')
    return age === null ? status : `Paused · ${age}`
  }

  const up = /^Up (.+)$/.exec(status)
  if (up) {
    const age = shortAge(up[1] ?? '')
    return age === null ? status : `Up ${age}`
  }

  const stopped = /^((?:Exited|Restarting) \(-?\d+\)) (.+) ago$/.exec(status)
  if (stopped) {
    const age = shortAge(stopped[2] ?? '')
    if (age === null) return status
    return `${stopped[1]} · ${age === 'just now' ? age : `${age} ago`}`
  }

  return status
}
