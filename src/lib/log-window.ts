// Pure math for the log list: where each row starts, and which rows a viewport shows. Rows can have
// different heights (wrapped lines), so the starts are kept in a list and searched by binary search.

/**
 * The top edge of every row, plus the bottom of the last one: offsets[i] is where row i starts,
 * offsets[count] is the total height. `heightAt` gives each row's height in pixels.
 */
export function buildOffsets(count: number, heightAt: (index: number) => number): Float64Array {
  const offsets = new Float64Array(count + 1)
  for (let index = 0; index < count; index++) {
    offsets[index + 1] = (offsets[index] ?? 0) + heightAt(index)
  }
  return offsets
}

/** A hair under a pixel, so a row that starts at the bottom edge is left out. */
const EDGE = 1e-6

/** The largest row index whose top is at or above `y` (0 when `y` is above every row). */
function rowAt(offsets: ArrayLike<number>, y: number, count: number): number {
  let low = 0
  let high = count - 1
  let found = 0
  while (low <= high) {
    const middle = (low + high) >> 1
    if ((offsets[middle] ?? 0) <= y) {
      found = middle
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return found
}

export interface RowSpan {
  /** first row to draw (inclusive) */
  start: number
  /** end of the rows to draw (exclusive) */
  end: number
}

/**
 * The rows to draw for a viewport that starts at `top` and is `height` pixels tall, with `overscan`
 * extra rows on each side. An empty list gives an empty span.
 */
export function visibleRows(offsets: ArrayLike<number>, top: number, height: number, overscan: number): RowSpan {
  const count = offsets.length - 1
  if (count <= 0) return { start: 0, end: 0 }
  const first = rowAt(offsets, Math.max(0, top), count)
  // the bottom edge is exclusive: a row that starts exactly there is not visible
  const last = rowAt(offsets, Math.max(0, top) + Math.max(0, height) - EDGE, count)
  const start = Math.max(0, first - overscan)
  const end = Math.min(count, Math.max(first + 1, last + 1) + overscan)
  return { start, end }
}
