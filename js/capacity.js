// ── Capacity arithmetic ──────────────────────────────────────
// Pure functions: no DOM, no state import, so test/capacity.test.mjs can run
// them under Node. Everything the page shows as a number comes from here.
//
// The chain, with the defaults:
//   focus days a week  = 5 working days - 1 meeting day            = 4
//   points a sprint    = 2 weeks x 4 focus days x 1 point a day      = 8
//   before days off    = 8 points x 4 sprints                        = 32
//   raw per engineer   = 32 - holidays, team days off, vacations    (calendar.js)
//   planned            = raw rounded onto the Fibonacci scale        = 34

import { personSprints, nextQuarterStart } from './calendar.js'

/** The estimation scale. A deliverable is sized with one of these. */
export const SCALE = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

const FIB = (() => {
  const out = [1, 2]
  while (out[out.length - 1] < 1e6) out.push(out[out.length - 1] + out[out.length - 2])
  return out
})()

export const DEFAULT_SETTINGS = Object.freeze({
  startDate: '',        // ISO Monday the first sprint starts; '' = next quarter's first Monday
  countries: [],        // ISO 3166 codes the team spans; the first is the default for anyone without one
  weeksPerSprint: 2,
  daysPerWeek: 5,
  meetingDay: true,     // one day a week goes to meetings and does not count
  pointsPerDay: 1,      // a story point is one focus day
  sprintCap: 0,         // 0 = derive it from the focus days
  sprints: 4,           // sprints in this plan (two months of two-week sprints)
  buffer: 0,            // % held back for support and unplanned work
  rounding: 'nearest',  // nearest | up | down | none
})

export const ROUNDING = {
  nearest: 'nearest Fibonacci',
  up: 'next Fibonacci up',
  down: 'Fibonacci below (safe)',
  none: 'no rounding',
}

export function fibFloor(n) {
  if (!(n >= 1)) return 0
  let best = 1
  for (const f of FIB) { if (f > n) break; best = f }
  return best
}

export function fibCeil(n) {
  if (!(n > 0)) return 0
  for (const f of FIB) if (f >= n) return f
  return FIB[FIB.length - 1]
}

/** Nearer of the two neighbours; a tie goes up, as in 32 -> 34 not 21. */
export function fibNearest(n) {
  if (!(n > 0)) return 0
  const lo = fibFloor(n), hi = fibCeil(n)
  if (!lo) return hi
  return n - lo < hi - n ? lo : hi
}

export function roundFib(n, mode = 'nearest') {
  if (!(n > 0)) return 0
  if (mode === 'up') return fibCeil(n)
  if (mode === 'down') return fibFloor(n)
  if (mode === 'none') return Math.round(n)
  return fibNearest(n)
}

export const isFib = n => FIB.includes(n)

/** One step along the Fibonacci scale from n, in either direction. */
export function fibStep(n, dir) {
  if (dir > 0) return n < 1 ? 1 : FIB.find(f => f > n)
  const below = FIB.filter(f => f < n)
  return below.length ? below[below.length - 1] : 0
}

/** Preset horizons, derived from the sprint length: 12 weeks and 8 weeks. */
export const horizons = s => [
  { key: 'quarter', label: 'Quarter', sprints: Math.max(1, Math.floor(12 / s.weeksPerSprint)) },
  { key: 'two-months', label: 'Two months', sprints: Math.max(1, Math.floor(8 / s.weeksPerSprint)) },
]

export const focusDays = s => Math.max(0, s.daysPerWeek - (s.meetingDay ? 1 : 0))

/** Points one sprint can hold for one engineer, before any cap. */
export const sprintDerived = s => s.weeksPerSprint * focusDays(s) * s.pointsPerDay

/** The cap is a ceiling: it can hold a sprint below what the focus days give, never lift it above. */
export const sprintPoints = s => (s.sprintCap > 0 ? Math.min(s.sprintCap, sprintDerived(s)) : sprintDerived(s))

/** No holiday data: every lookup comes back empty. Node tests and first paint use it. */
export const NO_CAL = Object.freeze({ holidays: () => null, status: () => 'none' })

/**
 * One person's capacity before rounding, and what the calendar took from it.
 * Sprints away scale the total; load and buffer come last.
 */
export function personCapacity(person, doc, cal = NO_CAL) {
  const s = doc.settings
  const { sprints, lost } = personSprints(person, doc, cal.holidays)
  const total = sprints.reduce((t, x) => t + x.points, 0)
  const away = Math.min(s.sprints, Math.max(0, Math.round(person.sprintsOff || 0)))
  const share = s.sprints ? (s.sprints - away) / s.sprints : 0
  const raw = total * share * ((person.load ?? 100) / 100) * (1 - (s.buffer || 0) / 100)
  return { raw, total, lost, away }
}

export const capacityOf = (person, doc, cal) => roundFib(personCapacity(person, doc, cal).raw, doc.settings.rounding)

/** A full-time engineer on the team calendar, no vacations. Gaps are expressed in these. */
const FULL_TIME = Object.freeze({ load: 100, sprintsOff: 0, country: '', vacations: [] })

/**
 * Every derived number the page and the flags read, computed once per render.
 * Unsized deliverables (estimate null) add nothing to demand: they are a
 * missing-data flag, not a zero.
 */
export function analyze(doc, cal = NO_CAL) {
  const s = doc.settings
  const people = new Map()
  for (const p of doc.people) {
    const pc = personCapacity(p, doc, cal)
    people.set(p.id, { raw: pc.raw, lost: pc.lost, away: pc.away, cap: roundFib(pc.raw, s.rounding), used: 0, pct: 0, count: 0 })
  }
  const shares = shareAnalysis(doc, people)
  const deliverables = new Map()
  let demand = 0, allocated = 0, shortfall = 0, unsized = 0
  for (const d of doc.deliverables) {
    let got = 0
    for (const m of d.members) {
      const sh = shares.get(shareKey(d.id, m.person))
      if (!sh) continue
      got += sh.points
      const p = people.get(m.person)
      if (p) { p.used += sh.points; p.pct += sh.pct; p.count += 1 }
    }
    allocated += got
    if (d.estimate) demand += d.estimate; else unsized += 1
    const gap = d.estimate ? d.estimate - got : 0
    if (gap > 0) shortfall += gap
    deliverables.set(d.id, { estimate: d.estimate, got, gap })
  }
  let capacity = 0, raw = 0, openCap = 0, free = 0, over = 0
  for (const p of doc.people) {
    const a = people.get(p.id)
    a.free = a.cap - a.used
    capacity += a.cap; raw += a.raw
    if (p.open) openCap += a.cap
    if (a.free > 0) free += a.free; else over += -a.free
  }
  const ft = personCapacity(FULL_TIME, doc, cal)
  const base = sprintPoints(s) * s.sprints
  return {
    sprint: sprintPoints(s), derived: sprintDerived(s), focus: focusDays(s),
    base,                                   // 8 x 4 = 32, before the calendar
    offPts: base - ft.total,                // what holidays and team days took from a full-timer
    offDays: ft.lost.holiday + ft.lost.team,
    unitRaw: ft.raw, unit: roundFib(ft.raw, s.rounding),
    people, deliverables, shares, capacity, raw, openCap, hiredCap: capacity - openCap,
    demand, allocated, shortfall, unsized, free, over,
    calendar: calendarStatus(doc, cal),
  }
}

// ── Shares ───────────────────────────────────────────────────
// A share is a percentage of the person's planned capacity (`pct`), so it
// follows that capacity when a vacation, a holiday or the sprint count moves
// it: 50% of Ana is 17 points at 34 and 10 at 21. A share saved before
// percentages existed carries fixed `points` instead and keeps them until it
// is edited.

export const shareKey = (delivId, personId) => `${delivId}:${personId}`

/**
 * Points for every share. One person's percentage shares are rounded
 * together by largest remainder, so they add up to exactly
 * round(cap x total% / 100): 3 x 33.33% of 34 is 11 + 11 + 12, never 33 or 36.
 */
export function shareAnalysis(doc, people) {
  const out = new Map()
  const byPerson = new Map()
  for (const d of doc.deliverables) {
    for (const m of d.members) {
      const cap = people.get(m.person)?.cap ?? 0
      if (m.pct == null) {
        out.set(shareKey(d.id, m.person), { points: m.points || 0, pct: cap ? ((m.points || 0) / cap) * 100 : 0, fixed: true })
      } else {
        if (!byPerson.has(m.person)) byPerson.set(m.person, [])
        byPerson.get(m.person).push({ key: shareKey(d.id, m.person), pct: m.pct })
      }
    }
  }
  for (const [pid, list] of byPerson) {
    const cap = people.get(pid)?.cap ?? 0
    const exact = list.map(x => (cap * x.pct) / 100)
    const floors = exact.map(Math.floor)
    const target = Math.round(exact.reduce((t, x) => t + x, 0))
    let left = target - floors.reduce((t, x) => t + x, 0)
    const order = exact.map((x, i) => [x - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
    for (const [, i] of order) { if (left <= 0) break; floors[i] += 1; left -= 1 }
    list.forEach((x, i) => out.set(x.key, { points: floors[i], pct: x.pct, fixed: false }))
  }
  return out
}

/** A percentage that gives `points` of a capacity, kept to two decimals. */
export const pctFor = (points, cap) => (cap > 0 ? Math.round((points / cap) * 10000) / 100 : 0)

/** Which holiday calendars the plan needs, and whether each one arrived. */
function calendarStatus(doc, cal) {
  const codes = new Set([...(doc.settings.countries || []), ...doc.people.map(p => p.country)].filter(Boolean))
  const out = { needed: [...codes], failed: [], loading: [] }
  for (const c of codes) {
    const st = cal.status(c)
    if (st === 'failed') out.failed.push(c)
    else if (st === 'loading') out.loading.push(c)
  }
  return out
}

export const defaultStart = () => nextQuarterStart()

/** Points expressed as engineers, one decimal: 21 of a 34 unit is 0.6. */
export function asEngineers(points, unit) {
  if (!unit) return 0
  return Math.round((points / unit) * 10) / 10
}
