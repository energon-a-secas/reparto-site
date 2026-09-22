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

import { personSprints } from './calendar.js'
import { splitExact, spanOf, spanLength, windowCap, spread, landing } from './timeline.js'
import { quarterOf, shiftQuarter, quarterStartMonday } from './quarters.js'

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
  fiscalStart: 10,      // the month the fiscal year starts: October, so Oct to Dec 2026 is Q1 FY27 (1 is calendar quarters)
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

/**
 * An estimate for a different number of sprints: the same people at the same
 * share of their time do proportionally more or less, so a 34 over four
 * sprints is 21 over two (17, nearest on the scale, ties up). Moving without
 * resizing changes nothing. Nearest rather than up, so halving and then
 * doubling back returns to the size it started at (34, 21, 34).
 */
export function scaleEstimate(estimate, fromSprints, toSprints) {
  if (!estimate || !fromSprints || !toSprints || fromSprints === toSprints) return estimate
  const n = fibNearest(Math.max(1, (estimate * toSprints) / fromSprints))
  return Math.min(SCALE[SCALE.length - 1], n)
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
  const { sprints, lost, vacationDays } = personSprints(person, doc, cal.holidays)
  const total = sprints.reduce((t, x) => t + x.points, 0)
  const away = Math.min(s.sprints, Math.max(0, Math.round(person.sprintsOff || 0)))
  const factor = (s.sprints ? (s.sprints - away) / s.sprints : 0) * ((person.load ?? 100) / 100)
  return { raw: total * factor, total, lost, away, sprints, factor, vacationDays }
}

/**
 * A person's bookable points from their raw capacity: the full-timer's
 * rounding factor, then the buffer. raw x unit / unitRaw is exact for the
 * full-timer (49.4999 was rounding a full-timer one below bookable), and a
 * calendar that leaves the full-timer nothing falls back to everyone's own raw.
 */
export const capFromRaw = (raw, a) =>
  Math.round((a.unitRaw > 0 && a.unit > 0 ? (raw * a.unit) / a.unitRaw : raw) * a.keep)

/**
 * The planned points a person's own leave takes: vacation days, and whole
 * sprints away. Holidays and team days are everyone's, so they are not
 * leave. What the cards and flags use to say which vacation made a
 * deliverable short.
 */
function leaveOf(p, doc, cal, scale, cap, sprintCap) {
  if (!(p.vacations || []).length && !p.sprintsOff) return { vacation: 0, away: 0, capNoVacation: cap, capNoLeave: cap, sprintNoVacation: sprintCap, sprintNoLeave: sprintCap }
  const pcV = personCapacity({ ...p, vacations: [] }, doc, cal)
  const noVacation = capFromRaw(pcV.raw, scale)
  const pcL = p.sprintsOff ? personCapacity({ ...p, vacations: [], sprintsOff: 0 }, doc, cal) : pcV
  const noLeave = p.sprintsOff ? capFromRaw(pcL.raw, scale) : noVacation
  return {
    vacation: Math.max(0, noVacation - cap), away: Math.max(0, noLeave - noVacation), capNoVacation: noVacation, capNoLeave: noLeave,
    sprintNoVacation: plannedSprints(pcV, noVacation), sprintNoLeave: plannedSprints(pcL, noLeave),
  }
}

/**
 * A person's planned points per sprint, as exact shares of their capacity in
 * proportion to what the calendar gives them in each sprint. Exact, not
 * whole: rounding 34 into 9, 9, 8, 8 gave the first half of a plan a point
 * more than the second. A whole-plan share still uses the whole capacity.
 */
export function plannedSprints(pc, cap) {
  const w = pc.sprints.map(x => x.points * pc.factor)
  const sum = w.reduce((t, x) => t + x, 0)
  return sum > 0 ? w.map(x => (cap * x) / sum) : w.map(() => 0)
}

/** What a share is a percentage of: the whole capacity for the whole plan, else the span's exact points. */
const spanCap = (sprintCap, total, span) => (!span || span.whole ? total : windowCap(sprintCap, span))

/** Points someone has free in a span: each sprint's planned points less what is booked there. */
export function freeIn(pa, span) {
  let t = 0
  for (let i = span.a; i <= span.b; i++) t += Math.max(0, (pa.sprintCap[i] || 0) - (pa.booked[i] || 0))
  return Math.floor(t + 1e-9)
}

/**
 * What leave took from each percentage share, exactly: the person's shares
 * split by the same largest remainder over their capacity without the leave,
 * minus what they get now. Rounding pct x leave per card disagreed with the
 * real split and blamed leave for points it never took. Fixed points carry none.
 */
function leaveByShare(doc, people, spans) {
  const groups = new Map()
  for (const d of doc.deliverables) {
    for (const m of d.members) {
      if (m.pct == null) continue
      if (!groups.has(m.person)) groups.set(m.person, [])
      groups.get(m.person).push({ key: shareKey(d.id, m.person), pct: m.pct, span: spans.get(d.id) })
    }
  }
  const out = new Map()
  for (const [pid, list] of groups) {
    const p = people.get(pid)
    if (!p || !(p.leave.vacation || p.leave.away)) continue
    // Each share against its own span, in the capacity with and without the leave.
    const split = (caps, total) => splitExact(list.map(x => (spanCap(caps, total, x.span) * x.pct) / 100))
    const now = split(p.sprintCap, p.cap), noVac = split(p.leave.sprintNoVacation, p.leave.capNoVacation), noLeave = split(p.leave.sprintNoLeave, p.leave.capNoLeave)
    // Signed: largest remainder can hand a card a point when capacity shrinks. analyze() nets a card's
    // members before clipping, so a card is only "short because of leave" if it would be staffed without it.
    list.forEach((x, i) => out.set(x.key, { net: noLeave[i] - now[i], vacation: noVac[i] - now[i] }))
  }
  return out
}

/** A full-time engineer on the team calendar, no vacations. Gaps are expressed in these. */
const FULL_TIME = Object.freeze({ load: 100, sprintsOff: 0, country: '', vacations: [] })

/**
 * Every derived number the page and the flags read, computed once per render.
 * Unsized deliverables (estimate null) add nothing to demand: they are a
 * missing-data flag, not a zero.
 */
export function analyze(doc, cal = NO_CAL) {
  const s = doc.settings
  const n = s.sprints
  const zeros = () => Array.from({ length: n }, () => 0)
  const ft = personCapacity(FULL_TIME, doc, cal)
  const unitRaw = ft.raw
  const unit = roundFib(unitRaw, s.rounding)
  const scale = { unit, unitRaw, k: unitRaw > 0 && unit > 0 ? unit / unitRaw : 1, keep: 1 - (s.buffer || 0) / 100 }
  const bookable = capFromRaw(unitRaw, scale)
  // One full-timer's bookable points per sprint: what a deliverable's span is worth in engineers.
  const ftPoints = ft.sprints.reduce((t, x) => t + x.points, 0)
  const unitSprint = ft.sprints.map(x => (ftPoints > 0 ? (bookable * x.points) / ftPoints : 0))
  const spans = new Map(doc.deliverables.map(d => [d.id, spanOf(d, n)]))
  const people = new Map()
  const exactSprint = zeros()
  for (const p of doc.people) {
    const pc = personCapacity(p, doc, cal)
    const cap = capFromRaw(pc.raw, scale)
    const sprintCap = plannedSprints(pc, cap)
    people.set(p.id, {
      raw: pc.raw, lost: pc.lost, away: pc.away, cap, sprintCap, used: 0, pct: 0, count: 0,
      booked: zeros(), load: zeros(), active: zeros(),    // per sprint: points, percent of their time, deliverables at once
      leave: leaveOf(p, doc, cal, scale, cap, sprintCap), vacationDays: pc.vacationDays,
    })
    pc.sprints.forEach((x, i) => { exactSprint[i] += x.points * pc.factor * scale.k * scale.keep })
  }
  const shares = shareAnalysis(doc, people, spans)
  const leaveShares = leaveByShare(doc, people, spans)
  const deliverables = new Map()
  let demand = 0, allocated = 0, shortfall = 0, unsized = 0
  for (const d of doc.deliverables) {
    const span = spans.get(d.id)
    const perSprint = zeros()
    let got = 0, leaveNet = 0
    const leave = []
    for (const m of d.members) {
      const sh = shares.get(shareKey(d.id, m.person))
      if (!sh) continue
      got += sh.points
      const p = people.get(m.person)
      if (p) {
        p.used += sh.points; p.count += 1
        // Share of their whole plan: a 100% share over two of four sprints is half of it.
        p.pct += p.cap ? (sh.pct * sh.winCap) / p.cap : (sh.pct * spanLength(span)) / (n || 1)
        spread(sh.points, p.sprintCap, span, n).forEach((x, i) => { p.booked[i] += x; perSprint[i] += x })
        for (let i = span.a; i <= span.b; i++) { p.load[i] += sh.pct; p.active[i] += 1 }
      }
      const lv = leaveShares.get(shareKey(d.id, m.person))
      if (lv) {
        leaveNet += lv.net
        const lost = Math.max(0, lv.net), vacation = Math.min(Math.max(0, lv.vacation), lost)
        if (lost) leave.push({ person: m.person, vacation, away: lost - vacation })
      }
    }
    allocated += got
    if (d.estimate) demand += d.estimate; else unsized += 1
    const gap = d.estimate ? d.estimate - got : 0
    if (gap > 0) shortfall += gap
    deliverables.set(d.id, {
      estimate: d.estimate, got, gap, leave, leavePts: Math.max(0, leaveNet),
      span, perSprint, lands: landing(perSprint, d.estimate, span, s), unitWindow: span.whole ? bookable : Math.round(windowCap(unitSprint, span)),
    })
  }
  let capacity = 0, raw = 0, openCap = 0, free = 0, over = 0
  const bookedExact = zeros()
  for (const p of doc.people) {
    const a = people.get(p.id)
    a.free = a.cap - a.used
    // A sprint booked past what they have in it, by at least half a point: the quarter can add up while S1 does not.
    a.overSprints = a.booked.map((x, i) => (x - a.sprintCap[i] >= 0.5 ? i : -1)).filter(i => i >= 0)
    a.overPts = a.free < 0 ? -a.free : a.overSprints.reduce((t, i) => t + Math.round(a.booked[i] - a.sprintCap[i]), 0)
    a.over = a.free < 0 || a.overSprints.length > 0
    a.peak = n ? Math.max(0, ...a.load) : 0
    a.concurrent = n ? Math.max(0, ...a.active) : 0
    a.booked.forEach((x, i) => { bookedExact[i] += x })
    capacity += a.cap; raw += a.raw
    if (p.open) openCap += a.cap
    if (a.free > 0) free += a.free
    over += a.overPts
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
    unitSprint,                             // that engineer, sprint by sprint
    perSprint: apportion(capacity, exactSprint),   // team points per sprint, adding up to the team capacity
    bookedPerSprint: apportion(allocated, bookedExact),   // and what is booked in each, adding up to the booked total
    spans,
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
export function shareAnalysis(doc, people, spans = null) {
  const out = new Map()
  const byPerson = new Map()
  for (const d of doc.deliverables) {
    const span = spans?.get(d.id)
    for (const m of d.members) {
      const p = people.get(m.person)
      // What the share is a percentage of: the person's points in the deliverable's span (the whole plan by default).
      const winCap = !p ? 0 : p.sprintCap ? spanCap(p.sprintCap, p.cap, span) : p.cap
      if (m.pct == null) {
        out.set(shareKey(d.id, m.person), { points: m.points || 0, pct: winCap ? ((m.points || 0) / winCap) * 100 : 0, fixed: true, winCap })
      } else {
        if (!byPerson.has(m.person)) byPerson.set(m.person, [])
        byPerson.get(m.person).push({ key: shareKey(d.id, m.person), pct: m.pct, winCap })
      }
    }
  }
  for (const [, list] of byPerson) {
    const pts = splitExact(list.map(x => (x.winCap * x.pct) / 100))
    list.forEach((x, i) => out.set(x.key, { points: pts[i], pct: x.pct, fixed: false, winCap: x.winCap }))
  }
  return out
}

/** Share `total` whole points across sprints in proportion to their exact values (largest remainder), so the strip adds up to the team capacity. */
function apportion(total, exact) {
  const sum = exact.reduce((t, x) => t + x, 0)
  return sum > 0 ? splitPoints(total, exact.map(x => (x / sum) * 100)) : exact.map(() => 0)
}

/** Largest remainder: whole points for each percentage of `cap`, adding up to round(cap x total% / 100). */
export const splitPoints = (cap, pcts) => splitExact(pcts.map(p => (cap * p) / 100))

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
  const pa = a.people.get(personId)
  // A percentage of their points in this deliverable's span, not of the whole plan.
  const cap = pa ? spanCap(pa.sprintCap, pa.cap, a.spans.get(delivId)) : 0
  if (!cap) return clampPct(pctFor(points, cap) || PCT_MIN)
  // The person's percentage shares plus the target card (which may be new, fixed or a percentage):
  // those are what largest remainder rounds together, each against its own span.
  const mine = doc.deliverables.filter(d => d.id === delivId || d.members.some(m => m.person === personId && m.pct != null))
  const at = mine.findIndex(d => d.id === delivId)
  const list = mine.map(d => d.members.find(m => m.person === personId)?.pct ?? 0)
  const caps = mine.map(d => (d.id === delivId ? cap : a.shares.get(shareKey(d.id, personId))?.winCap ?? 0))
  const want = mine.map(d => (d.id === delivId ? points : a.shares.get(shareKey(d.id, personId))?.points ?? 0))
  const centre = pctFor(points, cap)
  const lo = Math.max(PCT_MIN, pctFor(points - 0.5, cap)), hi = Math.min(PCT_MAX, pctFor(points + 0.5, cap))
  const steps = Math.ceil((hi - lo) * 100) + 2
  for (let i = 0; i <= steps; i++) {
    for (const sign of i ? [-1, 1] : [1]) {
      const cand = clampPct(centre + (sign * i) / 100)
      if (cand < lo - 0.01 || cand > hi + 0.01) continue
      list[at] = cand
      const pts = splitExact(list.map((p, j) => (caps[j] * p) / 100))
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
    if (!pts) continue      // a share that gives nothing trims nothing: leave it
    const cap = a.shares.get(shareKey(delivId, m.person)).winCap      // its percentage is of the span's points
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

/** The first Monday of the quarter after today's, in the plan's fiscal calendar: a new plan's natural day one. */
export const defaultStart = (fiscalStart = DEFAULT_SETTINGS.fiscalStart, today = new Date()) =>
  quarterStartMonday(shiftQuarter(quarterOf(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())), fiscalStart), 1, fiscalStart))

/** Points expressed as engineers, one decimal: 21 of a 34 unit is 0.6. */
export function asEngineers(points, unit) {
  if (!unit) return 0
  return Math.round((points / unit) * 10) / 10
}
