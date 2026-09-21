// ── Capacity arithmetic ──────────────────────────────────────
// Pure functions: no DOM, no state import, so test/capacity.test.mjs can run
// them under Node. Everything the page shows as a number comes from here.
//
// The chain, with the defaults:
//   focus days a week  = 5 working days - 1 meeting day            = 4
//   points a sprint    = 2 weeks x 4 focus days x 1 point a day      = 8
//   before days off    = 8 points x 4 sprints                        = 32
//   raw per engineer   = 32 - holidays and team days off (calendar.js) = 31 in Chile
//   planned            = raw rounded onto the Fibonacci scale        = 34
//   bookable           = planned - the buffer                         = 34 at 0%
//
// Only the full-time engineer is rounded. Everyone else is their own raw
// capacity scaled by the same factor (34 / 31) and the same buffer, so a
// vacation day, a load step or a holiday moves a person smoothly instead of
// jumping them from 34 to 21 at a Fibonacci boundary.

import { personSprints, nextQuarterStart } from './calendar.js'

/** The estimation scale. A deliverable is sized with one of these. */
export const SCALE = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]

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
 * One person's capacity before rounding and buffer, and what the calendar
 * took from it. Sprints away and load scale the calendar's total; `factor`
 * is that scale, so a per-sprint figure is sprint.points x factor.
 */
export function personCapacity(person, doc, cal = NO_CAL) {
  const s = doc.settings
  const { sprints, lost } = personSprints(person, doc, cal.holidays)
  const total = sprints.reduce((t, x) => t + x.points, 0)
  const away = Math.min(s.sprints, Math.max(0, Math.round(person.sprintsOff || 0)))
  const factor = (s.sprints ? (s.sprints - away) / s.sprints : 0) * ((person.load ?? 100) / 100)
  return { raw: total * factor, total, lost, away, sprints, factor }
}

/**
 * A person's bookable points from their raw capacity: the full-timer's
 * rounding factor, then the buffer. raw x unit / unitRaw is exact for the
 * full-timer (49.4999 was rounding a full-timer one below bookable), and a
 * calendar that leaves the full-timer nothing falls back to everyone's own raw.
 */
export const capFromRaw = (raw, a) =>
  Math.round((a.unitRaw > 0 && a.unit > 0 ? (raw * a.unit) / a.unitRaw : raw) * a.keep)

/** A full-time engineer on the team calendar, no vacations. Gaps are expressed in these. */
const FULL_TIME = Object.freeze({ load: 100, sprintsOff: 0, country: '', vacations: [] })

/**
 * Every derived number the page and the flags read, computed once per render.
 * Unsized deliverables (estimate null) add nothing to demand: they are a
 * missing-data flag, not a zero.
 */
export function analyze(doc, cal = NO_CAL) {
  const s = doc.settings
  const ft = personCapacity(FULL_TIME, doc, cal)
  const unitRaw = ft.raw
  const unit = roundFib(unitRaw, s.rounding)
  const scale = { unit, unitRaw, k: unitRaw > 0 && unit > 0 ? unit / unitRaw : 1, keep: 1 - (s.buffer || 0) / 100 }
  const bookable = capFromRaw(unitRaw, scale)
  const people = new Map()
  const exactSprint = Array.from({ length: s.sprints }, () => 0)
  for (const p of doc.people) {
    const pc = personCapacity(p, doc, cal)
    people.set(p.id, { raw: pc.raw, lost: pc.lost, away: pc.away, cap: capFromRaw(pc.raw, scale), used: 0, pct: 0, count: 0 })
    pc.sprints.forEach((x, i) => { exactSprint[i] += x.points * pc.factor * scale.k * scale.keep })
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
  const base = sprintPoints(s) * s.sprints
  return {
    sprint: sprintPoints(s), derived: sprintDerived(s), focus: focusDays(s),
    base,                                   // 8 x 4 = 32, before the calendar
    offPts: base - ft.total,                // what holidays and team days took from a full-timer
    offDays: ft.lost.holiday + ft.lost.team,
    unitRaw, unit,                          // 31 raw, 34 planned: the one number that is rounded
    k: scale.k, keep: scale.keep,           // everyone else: raw x k x keep
    bookable, held: unit - bookable,        // one engineer after the buffer: gaps are counted in these
    perSprint: apportion(capacity, exactSprint),   // team points per sprint, adding up to the team capacity
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
    const pts = splitPoints(people.get(pid)?.cap ?? 0, list.map(x => x.pct))
    list.forEach((x, i) => out.set(x.key, { points: pts[i], pct: x.pct, fixed: false }))
  }
  return out
}

/** Share `total` whole points across sprints in proportion to their exact values (largest remainder), so the strip adds up to the team capacity. */
function apportion(total, exact) {
  const sum = exact.reduce((t, x) => t + x, 0)
  return sum > 0 ? splitPoints(total, exact.map(x => (x / sum) * 100)) : exact.map(() => 0)
}

/** Largest remainder: whole points for each percentage of `cap`, adding up to round(cap x total% / 100). */
export function splitPoints(cap, pcts) {
  const exact = pcts.map(p => (cap * p) / 100)
  const floors = exact.map(Math.floor)
  const target = Math.round(exact.reduce((t, x) => t + x, 0))
  let left = target - floors.reduce((t, x) => t + x, 0)
  const order = exact.map((x, i) => [x - floors[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1])
  for (const [, i] of order) { if (left <= 0) break; floors[i] += 1; left -= 1 }
  return floors
}

const withShare = (doc, delivId, personId, pct) => {
  const next = structuredClone(doc)
  const m = next.deliverables.find(d => d.id === delivId)?.members.find(x => x.person === personId)
  if (m) { m.pct = pct; delete m.points } else next.deliverables.find(d => d.id === delivId)?.members.push({ person: personId, pct })
  return next
}

/** The range a stored share percentage lives in (state.js and normalizeDoc clamp to it). */
export const PCT_MIN = 0.01, PCT_MAX = 400
const clampPct = x => Math.round(Math.min(PCT_MAX, Math.max(PCT_MIN, x)) * 100) / 100

/**
 * The percentage that gives a share exactly `points`, without moving the
 * person's other percentage shares. Largest-remainder rounding can land a
 * plain points / cap a point off, so this walks the 0.01% grid across the
 * half-point window around it, nearest first, and checks each candidate with
 * splitPoints over that one person's shares. Candidates are clamped to what
 * storage keeps, so the answer survives a save. Falls back to points / cap.
 */
export function pctForPoints(doc, cal, delivId, personId, points) {
  const a = analyze(doc, cal)
  const cap = a.people.get(personId)?.cap ?? 0
  if (!cap) return clampPct(pctFor(points, cap) || PCT_MIN)
  // The person's percentage shares plus the target card (which may be new, fixed or a percentage):
  // those are what largest remainder rounds together.
  const mine = doc.deliverables.filter(d => d.id === delivId || d.members.some(m => m.person === personId && m.pct != null))
  const at = mine.findIndex(d => d.id === delivId)
  const list = mine.map(d => d.members.find(m => m.person === personId)?.pct ?? 0)
  const want = mine.map(d => (d.id === delivId ? points : a.shares.get(shareKey(d.id, personId))?.points ?? 0))
  const centre = pctFor(points, cap)
  const lo = Math.max(PCT_MIN, pctFor(points - 0.5, cap)), hi = Math.min(PCT_MAX, pctFor(points + 0.5, cap))
  const steps = Math.ceil((hi - lo) * 100) + 2
  for (let i = 0; i <= steps; i++) {
    for (const sign of i ? [-1, 1] : [1]) {
      const cand = clampPct(centre + (sign * i) / 100)
      if (cand < lo - 0.01 || cand > hi + 0.01) continue
      list[at] = cand
      const pts = splitPoints(cap, list)
      if (pts.every((x, j) => x === want[j])) return cand
    }
  }
  return clampPct(centre)
}

/**
 * Pin a person's shares to the points they had: after a share is removed or
 * merged, largest remainder can move a point between their other cards.
 * `wanted` is Map(delivId -> points); fixed-points shares are left alone.
 */
export function pinShares(doc, cal, personId, wanted) {
  let work = doc
  for (const [delivId, pts] of wanted) {
    const m = work.deliverables.find(d => d.id === delivId)?.members.find(x => x.person === personId)
    if (!m || m.pct == null) continue
    const now = analyze(work, cal).shares.get(shareKey(delivId, personId))?.points
    if (now !== pts) work = withShare(work, delivId, personId, pctForPoints(work, cal, delivId, personId, pts))
  }
  return work
}

/**
 * The members a deliverable keeps after trimming it to its estimate: cut
 * from the last share first, each remaining share set to the exact
 * percentage that gives its new points. Pure; the caller swaps them in.
 */
export function trimShares(doc, cal, delivId) {
  let work = structuredClone(doc)
  const d = () => work.deliverables.find(x => x.id === delivId)
  if (!d()?.estimate) return d()?.members || []
  let extra = analyze(work, cal).deliverables.get(delivId).got - d().estimate
  for (const m of [...d().members].reverse()) {
    if (extra <= 0) break
    const a = analyze(work, cal)
    const pts = a.shares.get(shareKey(delivId, m.person)).points
    const cap = a.people.get(m.person)?.cap ?? 0
    const cut = Math.min(extra, pts)
    extra -= cut
    // What this person has on their other cards, so removing or resizing this share cannot move them.
    const others = new Map(work.deliverables.filter(x => x.id !== delivId && x.members.some(y => y.person === m.person))
      .map(x => [x.id, a.shares.get(shareKey(x.id, m.person)).points]))
    if (cut === pts) {
      d().members = d().members.filter(x => x.person !== m.person)
    } else if (!cap || ((pts - cut) / cap) * 100 > PCT_MAX) {
      // No capacity to take a percentage of, or more than the stored range: keep it as fixed points.
      const mm = d().members.find(x => x.person === m.person); delete mm.pct; mm.points = pts - cut
    } else {
      work = withShare(work, delivId, m.person, pctForPoints(work, cal, delivId, m.person, pts - cut))
    }
    work = pinShares(work, cal, m.person, others)
  }
  return d().members
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
