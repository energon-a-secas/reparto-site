// ── Timeline ─────────────────────────────────────────────────
// When the work happens. A deliverable runs over a span of the plan's
// sprints (`window: { from, to }`, 1-based and inclusive; null is the whole
// plan), and a share is a percentage of the person's time during that span.
// Each person's planned capacity is split across sprints, so a share's points
// land in the sprints it covers, a sprint can be over-booked while the
// quarter as a whole is not, and a deliverable has a date its points add up
// to its estimate: the date it lands. Pure, like capacity.js.

import { parseISO, addDays } from './calendar.js'

/**
 * Largest remainder: whole numbers for exact values, adding up to the
 * rounded total of the exact values, remainders handed out biggest first
 * (ties to the earlier one). The rounding every share and sprint goes through.
 */
export function splitExact(exact) {
  const floors = exact.map(Math.floor)
  const target = Math.round(exact.reduce((t, x) => t + x, 0))
  let left = target - floors.reduce((t, x) => t + x, 0)
  const order = exact.map((x, i) => [x - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, i] of order) { if (left <= 0) break; floors[i] += 1; left -= 1 }
  return floors
}

/** Whole points for `total`, shared in proportion to `weights` and adding up to it exactly. Zeros when nothing weighs. */
export function apportionInt(total, weights) {
  const sum = weights.reduce((t, x) => t + x, 0)
  return sum > 0 ? splitExact(weights.map(w => (total * w) / sum)) : weights.map(() => 0)
}

/**
 * A deliverable's sprints, 0-based and inclusive, inside a plan of `sprints`.
 * A window past the plan (the plan got shorter) is pulled in and says so.
 */
export function spanOf(d, sprints) {
  const last = Math.max(0, sprints - 1)
  const w = d?.window
  if (!w) return { a: 0, b: last, whole: true, clamped: false }
  const a = Math.min(Math.max(0, w.from - 1), last), b = Math.min(Math.max(a, w.to - 1), last)
  return { a, b, whole: a === 0 && b === last, clamped: w.to - 1 > last || w.from - 1 > last }
}

export const spanLength = span => span.b - span.a + 1
/** "S3", "S1 to S2", or "the whole plan". */
export const spanLabel = (span, { whole = true } = {}) =>
  span.whole && whole ? 'the whole plan' : span.a === span.b ? `S${span.a + 1}` : `S${span.a + 1} to S${span.b + 1}`

/** Someone's points in a span: their per-sprint planned capacity added up. */
export const windowCap = (sprintCap, span) => {
  let t = 0
  for (let i = span.a; i <= span.b; i++) t += sprintCap[i] || 0
  return t
}

/**
 * Where a share's points fall: across its span in proportion to the person's
 * capacity in each sprint (a sprint half lost to a vacation carries half), or
 * evenly when they have none in it. Exact values, one per plan sprint.
 */
export function spread(points, sprintCap, span, n) {
  const out = Array.from({ length: n }, () => 0)
  const wc = windowCap(sprintCap, span)
  for (let i = span.a; i <= span.b && i < n; i++) out[i] = wc > 0 ? (points * (sprintCap[i] || 0)) / wc : points / spanLength(span)
  return out
}

// ── Landing dates ────────────────────────────────────────────
/** Sprint k's dates (`to` exclusive), counting on past the plan's last sprint at the same length. */
export function sprintAt(s, k) {
  const start = parseISO(s.startDate)
  if (!start) return null
  const len = s.weeksPerSprint * 7
  return { i: k, from: addDays(start, k * len), to: addDays(start, (k + 1) * len) }
}

/** The working day a fraction of the way through sprint k: 0.5 of a 10-day sprint is its 5th working day. */
function dayAt(s, k, fraction) {
  const w = sprintAt(s, k)
  if (!w) return null
  const days = []
  for (let d = w.from; d < w.to; d = addDays(d, 1)) if ((d.getUTCDay() || 7) <= s.daysPerWeek) days.push(d)
  if (!days.length) return w.from
  const at = Math.min(days.length, Math.max(1, Math.ceil(fraction * days.length - 1e-9)))
  return days[at - 1]
}

const FAR = 52       // sprints past a window beyond which "at this pace" stops meaning anything

/**
 * When a deliverable's points add up to its estimate. `perSprint` is what its
 * people put into each plan sprint (exact points). Inside its span it lands
 * on the working day the running total reaches the estimate; short of that,
 * it keeps the span's average pace past the span, and past the plan if need
 * be, and says so.
 *   { kind: 'unsized' | 'none' }                 no date to give
 *   { kind: 'on-time', sprint, date }            lands inside its span
 *   { kind: 'late', sprint, date, afterPlan }    at this pace, after its span
 *   { kind: 'far' }                               too slow to put a date on
 */
export function landing(perSprint, estimate, span, s) {
  if (!estimate) return { kind: 'unsized' }
  let total = 0
  for (let i = span.a; i <= span.b; i++) total += perSprint[i] || 0
  if (total <= 1e-9) return { kind: 'none' }
  let cum = 0
  for (let i = span.a; i <= span.b; i++) {
    const p = perSprint[i] || 0
    if (p > 1e-9 && cum + p >= estimate - 1e-6) return { kind: 'on-time', sprint: i, date: dayAt(s, i, (estimate - cum) / p) }
    cum += p
  }
  const pace = total / spanLength(span)
  const extra = (estimate - total) / pace
  const whole = Math.ceil(extra - 1e-9)
  if (whole > FAR) return { kind: 'far' }
  const sprint = span.b + whole
  return { kind: 'late', sprint, date: dayAt(s, sprint, extra - (whole - 1)), afterPlan: sprint >= s.sprints }
}
