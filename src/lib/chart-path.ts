// Pure geometry for the hand-made SVG charts. No React here, so the tests can check the paths.

export interface Point {
  x: number
  y: number
}

/** Rounds to two decimals, so the path strings stay short. */
function num(value: number): string {
  return String(Math.round(value * 100) / 100)
}

/**
 * A smooth curve through the points (a monotone cubic, after Fritsch and Carlson). The curve passes
 * through every point and never overshoots between them, so a peak stays a peak and a flat part stays flat.
 * Returns "" for no points, and a single move for one point.
 */
export function smoothPath(points: readonly Point[]): string {
  const n = points.length
  if (n === 0) return ''
  const first = points[0] as Point
  if (n === 1) return `M${num(first.x)} ${num(first.y)}`

  // the slope of each segment
  const slopes = Array.from({ length: n - 1 }, (_, i) => {
    const a = points[i] as Point
    const b = points[i + 1] as Point
    const dx = b.x - a.x
    return dx === 0 ? 0 : (b.y - a.y) / dx
  })

  // the tangent at each point: the average of the two neighbouring slopes, or 0 at a peak or a valley
  const tangents = Array.from({ length: n }, (_, i) => {
    if (i === 0) return slopes[0] as number
    if (i === n - 1) return slopes[n - 2] as number
    const before = slopes[i - 1] as number
    const after = slopes[i] as number
    return before * after <= 0 ? 0 : (before + after) / 2
  })

  // keep each segment inside the circle of radius 3 (the Fritsch-Carlson rule), so it cannot overshoot
  for (let i = 0; i < n - 1; i++) {
    const slope = slopes[i] as number
    if (slope === 0) {
      tangents[i] = 0
      tangents[i + 1] = 0
      continue
    }
    const a = (tangents[i] as number) / slope
    const b = (tangents[i + 1] as number) / slope
    const length2 = a * a + b * b
    if (length2 > 9) {
      const k = 3 / Math.sqrt(length2)
      tangents[i] = k * a * slope
      tangents[i + 1] = k * b * slope
    }
  }

  let d = `M${num(first.x)} ${num(first.y)}`
  for (let i = 0; i < n - 1; i++) {
    const a = points[i] as Point
    const b = points[i + 1] as Point
    const third = (b.x - a.x) / 3
    const c1x = a.x + third
    const c1y = a.y + (tangents[i] as number) * third
    const c2x = b.x - third
    const c2y = b.y - (tangents[i + 1] as number) * third
    d += `C${num(c1x)} ${num(c1y)} ${num(c2x)} ${num(c2y)} ${num(b.x)} ${num(b.y)}`
  }
  return d
}

/** The area under a smooth curve: the curve, down to the baseline, back to the start, and closed. "" for fewer than two points. */
export function areaPath(points: readonly Point[], baseline: number): string {
  if (points.length < 2) return ''
  const first = points[0] as Point
  const last = points[points.length - 1] as Point
  return `${smoothPath(points)}L${num(last.x)} ${num(baseline)}L${num(first.x)} ${num(baseline)}Z`
}

/**
 * Splits a series with gaps (null points) into runs of consecutive points, so each run is drawn on its own
 * and a gap shows as a gap.
 */
export function runsOf(points: readonly (Point | null)[]): Point[][] {
  const runs: Point[][] = []
  let current: Point[] = []
  for (const point of points) {
    if (point === null) {
      if (current.length > 0) runs.push(current)
      current = []
    } else {
      current.push(point)
    }
  }
  if (current.length > 0) runs.push(current)
  return runs
}
