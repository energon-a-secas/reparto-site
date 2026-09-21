// ── Calendar ─────────────────────────────────────────────────
// Lays the sprints on real dates and counts each person's focus days after
// public holidays, team days off and vacations. Pure: holidays come in
// through a lookup, so test/calendar.test.mjs runs it under Node.
//
// A week is any 7-day block from the sprint's start. Its working days are
// the first `daysPerWeek` weekdays (Mon to Fri at 5). A day off on a
// weekend costs nothing. The meeting day comes out of every week that still
// has a working day left, so a week with one holiday gives 5 - 1 - 1 = 3.

const DAY = 86400000

export const parseISO = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null
  const d = new Date(`${s}T00:00:00Z`)
  return Number.isNaN(d.getTime()) ? null : d
}
export const iso = d => d.toISOString().slice(0, 10)
export const addDays = (d, n) => new Date(d.getTime() + n * DAY)

/** Monday is 1, Sunday 7; a 5-day week works on 1..5. */
const weekday = d => d.getUTCDay() || 7
const isWorkday = (d, daysPerWeek) => weekday(d) <= daysPerWeek

/** The first Monday on or after the start of next quarter: a plan's natural day one. */
export function nextQuarterStart(today = new Date()) {
  const y = today.getUTCFullYear(), q = Math.floor(today.getUTCMonth() / 3)
  let d = new Date(Date.UTC(q === 3 ? y + 1 : y, ((q + 1) % 4) * 3, 1))
  while (weekday(d) !== 1) d = addDays(d, 1)
  return iso(d)
}

/** Sprint windows, `to` exclusive. */
export function sprintWindows(s) {
  const start = parseISO(s.startDate)
  if (!start) return []
  const len = s.weeksPerSprint * 7
  return Array.from({ length: s.sprints }, (_, i) => ({ i, from: addDays(start, i * len), to: addDays(start, (i + 1) * len) }))
}

export function planRange(s) {
  const w = sprintWindows(s)
  return w.length ? { from: w[0].from, to: w[w.length - 1].to, last: addDays(w[w.length - 1].to, -1) } : null
}

/**
 * Every day off that touches this person, keyed by ISO date. Public
 * holidays follow the person's country, or the team's when they have none.
 * `holidays(country, year)` returns [[iso, name, localName?], ...] or null.
 */
export function daysOffFor(person, doc, holidays) {
  const s = doc.settings, range = planRange(s)
  const off = new Map()
  if (!range) return off
  const country = person.country || s.country
  if (country) {
    for (let y = range.from.getUTCFullYear(); y <= range.last.getUTCFullYear(); y++) {
      for (const [date, name, local] of holidays(country, y) || []) off.set(date, { kind: 'holiday', label: local || name })
    }
  }
  for (const t of doc.daysOff || []) if (!off.has(t.date)) off.set(t.date, { kind: 'team', label: t.label || 'Team day off' })
  for (const v of person.vacations || []) {
    const a = parseISO(v.from), b = parseISO(v.to)
    if (!a || !b) continue
    for (let d = a; d <= b; d = addDays(d, 1)) if (!off.has(iso(d))) off.set(iso(d), { kind: 'vacation', label: 'Vacation' })
  }
  return off
}

/**
 * Per-sprint focus days and points for one person, plus what they lost.
 * Points a sprint are the focus days times points a day, held to the sprint
 * cap when one is set.
 */
export function personSprints(person, doc, holidays) {
  const s = doc.settings
  const off = daysOffFor(person, doc, holidays)
  const lost = { holiday: 0, team: 0, vacation: 0 }
  const sprints = sprintWindows(s).map(w => {
    let focus = 0
    for (let wk = w.from; wk < w.to; wk = addDays(wk, 7)) {
      let avail = 0
      for (let d = wk; d < addDays(wk, 7) && d < w.to; d = addDays(d, 1)) {
        if (!isWorkday(d, s.daysPerWeek)) continue
        const o = off.get(iso(d))
        if (o) lost[o.kind] += 1; else avail += 1
      }
      focus += Math.max(0, avail - (s.meetingDay && avail > 0 ? 1 : 0))
    }
    const raw = focus * s.pointsPerDay
    return { ...w, focus, points: s.sprintCap > 0 ? Math.min(s.sprintCap, raw) : raw }
  })
  return { sprints, lost }
}

/** Working days a set of dates takes out of the plan (weekends and out-of-range days cost nothing). */
export function workdaysIn(dates, s) {
  const range = planRange(s)
  if (!range) return 0
  return dates.filter(x => {
    const d = parseISO(x)
    return d && d >= range.from && d < range.to && isWorkday(d, s.daysPerWeek)
  }).length
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** "5 Oct" or "5 Oct 2026". Fixed English so the page reads the same everywhere. */
export function fmtDay(d, withYear = false) {
  if (typeof d === 'string') d = parseISO(d)
  if (!d) return ''
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${withYear ? ` ${d.getUTCFullYear()}` : ''}`
}
