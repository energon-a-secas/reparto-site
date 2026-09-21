// ── Capacity arithmetic ──────────────────────────────────────
// Pure functions: no DOM, no state import, so test/capacity.test.mjs can run
// them under Node. Everything the page shows as a number comes from here.
//
// The chain, with the defaults:
//   focus days a week  = 5 working days - 1 meeting day            = 4
//   points a sprint    = 2 weeks x 4 focus days x 1 point a day      = 8
//   raw per engineer   = 8 points x 4 sprints x 100% load            = 32
//   planned            = 32 rounded onto the Fibonacci scale         = 34

/** The estimation scale. A deliverable is sized with one of these. */
export const SCALE = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89]

const FIB = (() => {
  const out = [1, 2]
  while (out[out.length - 1] < 1e6) out.push(out[out.length - 1] + out[out.length - 2])
  return out
})()

export const DEFAULT_SETTINGS = Object.freeze({
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

/** The cap wins when one is set; otherwise the focus days decide. */
export const sprintPoints = s => (s.sprintCap > 0 ? s.sprintCap : sprintDerived(s))

export function sprintsFor(person, s) {
  const off = Math.max(0, Math.round(person.sprintsOff || 0))
  return Math.max(0, s.sprints - off)
}

/** Capacity before rounding: the number the arithmetic actually gives. */
export function rawCapacity(person, s) {
  const load = (person.load ?? 100) / 100
  const keep = 1 - (s.buffer || 0) / 100
  return sprintPoints(s) * sprintsFor(person, s) * load * keep
}

export const capacityOf = (person, s) => roundFib(rawCapacity(person, s), s.rounding)

/** A full-time engineer over the whole plan. Gaps are expressed in these. */
export const engineerUnit = s => capacityOf({ load: 100, sprintsOff: 0 }, s)

/**
 * Every derived number the page and the flags read, computed once per render.
 * Unsized deliverables (estimate null) add nothing to demand: they are a
 * missing-data flag, not a zero.
 */
export function analyze(doc) {
  const s = doc.settings
  const people = new Map()
  for (const p of doc.people) {
    const raw = rawCapacity(p, s)
    people.set(p.id, { raw, cap: roundFib(raw, s.rounding), used: 0, count: 0 })
  }
  const deliverables = new Map()
  let demand = 0, allocated = 0, shortfall = 0, unsized = 0
  for (const d of doc.deliverables) {
    let got = 0
    for (const m of d.members) {
      got += m.points
      const p = people.get(m.person)
      if (p) { p.used += m.points; p.count += 1 }
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
  const unit = engineerUnit(s)
  return {
    sprint: sprintPoints(s), derived: sprintDerived(s), focus: focusDays(s), unit,
    unitRaw: rawCapacity({ load: 100 }, s),
    people, deliverables, capacity, raw, openCap, hiredCap: capacity - openCap,
    demand, allocated, shortfall, unsized, free, over,
  }
}

/** Points expressed as engineers, one decimal: 21 of a 34 unit is 0.6. */
export function asEngineers(points, unit) {
  if (!unit) return 0
  return Math.round((points / unit) * 10) / 10
}
