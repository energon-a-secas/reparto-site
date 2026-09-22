// ── Quarters ─────────────────────────────────────────────────
// Plans are laid on fiscal quarters. `fiscalStart` is the month (1 to 12)
// the fiscal year starts in; a fiscal year is named by the calendar year it
// ends in, the common convention: with an October start, 1 Oct 2026 to
// 30 Sep 2027 is FY27, so September 2026 is Q4 FY26 and October to December
// 2026 is Q1 FY27. A January start is plain calendar quarters ("Q4 2026").
// Pure: dates in, dates and labels out, all UTC like calendar.js.

import { addDays, iso } from './calendar.js'

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = MONTH_NAMES.map(m => m.slice(0, 3))

const utc = (y, m, d = 1) => new Date(Date.UTC(y, m, d))

/** The fiscal quarter a date falls in: { q, fy, from, to (exclusive), label }. */
export function quarterOf(date, fiscalStart = 1) {
  const m0 = fiscalStart - 1
  const y = date.getUTCFullYear(), m = date.getUTCMonth()
  const offset = (m - m0 + 12) % 12
  const q = Math.floor(offset / 3) + 1
  const fyStartYear = m >= m0 ? y : y - 1
  const from = utc(fyStartYear, m0 + (q - 1) * 3)          // Date.UTC rolls month 12+ into the next year
  const to = utc(fyStartYear, m0 + q * 3)
  const fy = m0 === 0 ? fyStartYear : fyStartYear + 1
  return { q, fy, from, to, label: quarterLabel(q, fy, fiscalStart) }
}

export const quarterLabel = (q, fy, fiscalStart = 1) => (fiscalStart === 1 ? `Q${q} ${fy}` : `Q${q} FY${String(fy).slice(-2)}`)

/** The quarter after (n > 0) or before (n < 0) the one a date falls in. */
export function shiftQuarter(quarter, n, fiscalStart = 1) {
  const d = utc(quarter.from.getUTCFullYear(), quarter.from.getUTCMonth() + n * 3)
  return quarterOf(d, fiscalStart)
}

/** "Oct to Dec 2026", or "Nov 2026 to Jan 2027" across a year. */
export function quarterMonths(quarter) {
  const a = quarter.from, b = addDays(quarter.to, -1)
  return a.getUTCFullYear() === b.getUTCFullYear()
    ? `${SHORT[a.getUTCMonth()]} to ${SHORT[b.getUTCMonth()]} ${b.getUTCFullYear()}`
    : `${SHORT[a.getUTCMonth()]} ${a.getUTCFullYear()} to ${SHORT[b.getUTCMonth()]} ${b.getUTCFullYear()}`
}

/** The first Monday on or after a quarter's first day: a plan's natural day one. */
export function quarterStartMonday(quarter) {
  let d = quarter.from
  while ((d.getUTCDay() || 7) !== 1) d = addDays(d, 1)
  return iso(d)
}

/** How many whole sprints fit between a start date and the end of a quarter: 6 two-week sprints from 5 Oct to 31 Dec. */
export function sprintsToEnd(quarter, from, weeksPerSprint) {
  return Math.max(1, Math.floor(Math.round((quarter.to - from) / 86400000) / (weeksPerSprint * 7)))
}

/** The quarters a picker offers: from `before` quarters ago to `after` ahead of today's. */
export function quartersAround(today, fiscalStart = 1, before = 1, after = 6) {
  const here = quarterOf(today, fiscalStart)
  return Array.from({ length: before + after + 1 }, (_, i) => shiftQuarter(here, i - before, fiscalStart))
}

/** What a plan covers, by quarter: "Q1 FY27", or "Q1 to Q2 FY27", or "Q4 FY26 to Q1 FY27". */
export function planQuarters(range, fiscalStart = 1) {
  if (!range) return ''
  const a = quarterOf(range.from, fiscalStart), b = quarterOf(range.last, fiscalStart)
  if (a.label === b.label) return a.label
  return a.fy === b.fy && fiscalStart !== 1 ? `Q${a.q} to Q${b.q} FY${String(b.fy).slice(-2)}`
    : a.fy === b.fy ? `Q${a.q} to Q${b.q} ${b.fy}` : `${a.label} to ${b.label}`
}

/** The calendar months a range touches, each with its first day and the day after it ends, for the map's header. */
export function monthsIn(from, to) {
  const out = []
  for (let d = utc(from.getUTCFullYear(), from.getUTCMonth()); d < to; d = utc(d.getUTCFullYear(), d.getUTCMonth() + 1)) {
    const next = utc(d.getUTCFullYear(), d.getUTCMonth() + 1)
    out.push({ label: `${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`, short: SHORT[d.getUTCMonth()], from: d < from ? from : d, to: next > to ? to : next })
  }
  return out
}
