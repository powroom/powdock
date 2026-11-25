import { areaPath, runsOf, smoothPath, type Point } from './chart-path'

/** The space inside the box that the line may use, so a peak is not cut at the edge. */
export const SPARK_PAD = 1.5

/**
 * The paths of a sparkline. Each value sits at its place in the series (so a series with leading nulls keeps
 * its right edge), and a null is a gap: the line breaks there and nothing is drawn for it. No value gives no path.
 */
export function sparkPaths(
  values: readonly (number | null)[],
  width: number,
  height: number,
): { line: string; area: string }[] {
  const present = values.filter((value): value is number => value !== null)
  const max = Math.max(0, ...present)
  const bottom = height - SPARK_PAD
  const points: (Point | null)[] = values.map((value, index) => {
    if (value === null) return null
    return {
      x: values.length === 1 ? width : (index / (values.length - 1)) * width,
      y: max === 0 ? bottom : SPARK_PAD + (1 - value / max) * (height - 2 * SPARK_PAD),
    }
  })
  return runsOf(points).map((run) => ({ line: smoothPath(run), area: areaPath(run, height) }))
}
