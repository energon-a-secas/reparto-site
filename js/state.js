// ── State ────────────────────────────────────────────────────
// `doc` is the plan (saved, shared, exported). `ui` is the view (never saved,
// never in an undo snapshot). Every mutation is: snapshot(), mutate,
// afterChange() in render.js, which saves and repaints. Where plans are
// stored, and which one is open, is plans.js.
//
// A plan's deliverables are the work it counts. `backlog` holds the ones
// moved out of it, `when: 'later'` (a future plan) or `'done'` (shipped):
// kept with their people so moving one back restores it, and invisible to
// every number, because analyze() and the flags only read `deliverables`.

import { DEFAULT_SETTINGS, SCALE, ROUNDING, defaultStart, PCT_MIN, PCT_MAX } from './capacity.js'
import { parseISO, addDays, iso } from './calendar.js'
import { normalizePlanning } from './planning.js'

const UNDO_DEPTH = 40
const MAX_LEAVE_DAYS = 3 * 366
const MAX_ITEMS = 400          // people, and deliverables in the plan

export const state = { doc: null, planId: null }   // set by plans.js loadSaved()

export const ui = {
  carry: null,        // { person, from } while a person is picked up by click or key
  focus: null,        // { kind, ids } highlighted from a flag
  filter: 'all',      // flag category filter
  flagScope: null,    // optional { kind, id } inspected in the flags dialog
  personFilter: '',   // visible assignments only; never changes plan arithmetic
  showInfo: false,    // info-level flags are folded by default
  firstRun: false,
  view: 'cards',      // cards | table, for this plan's deliverables
  scope: 'plan',      // plan | later | done: which deliverables the board lists
  sort: { key: '', dir: 1 },   // the table's sort; '' is the plan's own order
}

// Undo and redo per plan, in memory: switching plans and back keeps both.
const histories = new Map()
let hist = { undo: [], redo: [] }
/** Point undo and redo at one plan's history (plans.js calls this on every switch). */
export function useHistory(planId) {
  if (!histories.has(planId)) histories.set(planId, { undo: [], redo: [] })
  hist = histories.get(planId)
}
export const dropHistory = planId => histories.delete(planId)

// ── Validation: one gate in front of every entry point ───────
const num = (v, lo, hi, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}
/** A string cut to `max` UTF-16 units, never leaving half an emoji (a lone high surrogate) at the end. */
const str = (v, max = 80) => {
  if (typeof v !== 'string') return ''
  const s = v.slice(0, max)
  return /[\ud800-\udbff]$/.test(s) ? s.slice(0, -1) : s
}
/**
 * Ids are keys everywhere (share keys, data-key selectors), so they keep to
 * letters, digits, - and _: "a:b" and "a" + ":b" used to collide as one share key.
 */
const safeId = v => str(String(v ?? ''), 40).replace(/[^A-Za-z0-9_-]/g, '-')
const dedupe = (list, key) => { const seen = new Set(); return list.filter(x => !seen.has(key(x)) && seen.add(key(x))) }
const date = v => (parseISO(v) ? v : '')
const code = v => (typeof v === 'string' && /^[A-Z]{2}$/.test(v) ? v : '')

/** Vacation periods: valid dates only, a reversed range swapped, at most 40 a person. */
function periods(list) {
  const out = []
  for (const v of Array.isArray(list) ? list : []) {
    let from = date(v?.from), to = date(v?.to)
    if (!from && !to) continue
    from ||= to; to ||= from
    if (to < from) [from, to] = [to, from]
    // A leave longer than three years is a typo or a hostile link; it would walk a million days on every render.
    const cap = addDays(parseISO(from), MAX_LEAVE_DAYS)
    if (parseISO(to) > cap) to = iso(cap)
    out.push({ from, to })
    if (out.length >= 40) break
  }
  return out.sort((a, b) => a.from.localeCompare(b.from))
}
let seq = 0
export const newId = prefix => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

/** Coerce anything (a saved session, an import, a share link) into a valid plan. Throws on garbage. */
export function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.people) || !Array.isArray(raw.deliverables)) {
    throw new Error('Not a Reparto plan: it needs people and deliverables lists')
  }
  const s = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) }
  const settings = {
    startDate: date(s.startDate) || defaultStart(),
    // A plan saved before multi-country holidays carries one `country`.
    countries: [...new Set((Array.isArray(raw.settings?.countries) ? raw.settings.countries : [raw.settings?.country]).map(code).filter(Boolean))].slice(0, 12),
    weeksPerSprint: Math.round(num(s.weeksPerSprint, 1, 4, 2)),
    daysPerWeek: Math.round(num(s.daysPerWeek, 1, 7, 5)),
    meetingDay: !!s.meetingDay,
    pointsPerDay: num(s.pointsPerDay, 0.5, 3, 1),
    sprintCap: num(s.sprintCap, 0, 89, 0),
    sprints: num(Math.round(s.sprints), 1, 13, 4),
    buffer: num(s.buffer, 0, 50, 0),
    // Own keys only: `in` let '__proto__', 'toString' and ['up'] through, so the labels named a rule the maths never used.
    rounding: typeof s.rounding === 'string' && Object.hasOwn(ROUNDING, s.rounding) ? s.rounding : 'nearest',
    // Public holidays a country's team works anyway: [{ country, date }].
    worked: dedupe((Array.isArray(s.worked) ? s.worked : [])
      .map(w => ({ country: code(w?.country), date: date(w?.date) })).filter(w => w.country && w.date), w => `${w.country}|${w.date}`).slice(0, 60),
  }
  const people = []
  const seen = new Set()
  const idMap = new Map()     // the id a member names -> the person's id after cleaning
  // A missing or clashing id gets the next free "p-1", "d-2": from the input alone, never
  // the clock, so the same link or file normalises to the same plan every time.
  let n = 0
  const fresh = pre => { let id; do id = `${pre}-${++n}`; while (seen.has(id) || taken.has(id)); return id }
  const taken = new Set([...raw.people, ...raw.deliverables, ...(Array.isArray(raw.backlog) ? raw.backlog : [])].map(x => safeId(x?.id)).filter(Boolean))
  // A plan this size is already past what one page can plan; capping keeps a hostile link from hanging every render.
  for (const p of raw.people.slice(0, MAX_ITEMS)) {
    if (!p || typeof p !== 'object') continue
    let id = safeId(p.id) || fresh('p')
    if (seen.has(id)) id = fresh('p')
    seen.add(id)
    // Only an id the input carried can be named by a member: a person with no id is not "undefined".
    if (p.id != null && p.id !== '' && !idMap.has(String(p.id))) idMap.set(String(p.id), id)
    people.push({
      id, name: str(p.name), role: str(p.role),
      load: num(p.load ?? 100, 0, 100, 100),
      sprintsOff: num(Math.round(p.sprintsOff || 0), 0, 13, 0),
      open: !!p.open,
      country: code(p.country),
      vacations: periods(p.vacations),
    })
  }
  // A deliverable, in the plan or its backlog. Members must name a person; unknown ids are dropped.
  const deliverable = d => {
    let id = safeId(d.id) || fresh('d')
    if (seen.has(id)) id = fresh('d')
    seen.add(id)
    const members = []
    for (const m of Array.isArray(d.members) ? d.members : []) {
      const pid = m && m.person != null && m.person !== '' && idMap.get(String(m.person))
      if (!pid || members.some(x => x.person === pid)) continue
      // pct is the share of the person's capacity (dynamic); points is a fixed share from before percentages.
      if (m.pct != null && Number.isFinite(Number(m.pct))) members.push({ person: pid, pct: Math.round(num(m.pct, PCT_MIN, PCT_MAX, 100) * 100) / 100 })
      else members.push({ person: pid, points: num(Math.round(m.points), 1, 999, 1) })
    }
    const est = Number(d.estimate)
    return { id, name: str(d.name), note: str(d.note, 400), estimate: SCALE.includes(est) ? est : null, members, ...normalizePlanning(d) }
  }
  const deliverables = raw.deliverables.filter(d => d && typeof d === 'object').slice(0, MAX_ITEMS).map(deliverable)
  const backlog = (Array.isArray(raw.backlog) ? raw.backlog : []).filter(d => d && typeof d === 'object').slice(0, 500)
    .map(d => ({ ...deliverable(d), when: d.when === 'done' ? 'done' : 'later' }))
  const daysOff = []
  for (const t of Array.isArray(raw.daysOff) ? raw.daysOff : []) {
    const d = date(t?.date), c = code(t?.country)
    if (d && !daysOff.some(x => x.date === d && x.country === c)) daysOff.push({ date: d, label: str(t.label, 60), country: c })
    if (daysOff.length >= 200) break
  }
  daysOff.sort((a, b) => a.date.localeCompare(b.date))
  return { v: 1, title: str(raw.title) || 'Untitled plan', settings, daysOff, people, deliverables, backlog }
}

// ── Undo ─────────────────────────────────────────────────────
export function snapshot() {
  hist.undo.push(JSON.stringify(state.doc))
  if (hist.undo.length > UNDO_DEPTH) hist.undo.shift()
  hist.redo.length = 0
}
export function undo() {
  if (!hist.undo.length) return false
  hist.redo.push(JSON.stringify(state.doc))
  state.doc = JSON.parse(hist.undo.pop())
  return true
}
export function redo() {
  if (!hist.redo.length) return false
  hist.undo.push(JSON.stringify(state.doc))
  state.doc = JSON.parse(hist.redo.pop())
  return true
}
/**
 * Record an undo step for a change already applied, from the plan's JSON
 * before it, only if something actually changed. Unlike snapshot() first,
 * an edit that changes nothing leaves undo and redo alone.
 */
export function commitFrom(before) {
  if (JSON.stringify(state.doc) === before) return false
  hist.undo.push(before)
  if (hist.undo.length > UNDO_DEPTH) hist.undo.shift()
  hist.redo.length = 0
  return true
}
export const canUndo = () => hist.undo.length > 0
export const canRedo = () => hist.redo.length > 0

// ── Lookups ──────────────────────────────────────────────────
export const person = id => state.doc.people.find(p => p.id === id)
/** A deliverable in this plan: the only ones that take shares and count. */
export const deliverable = id => state.doc.deliverables.find(d => d.id === id)
/** A deliverable in the plan or its backlog, for what both can edit: name, estimate, note. */
export const findDeliverable = id => deliverable(id) || state.doc.backlog.find(d => d.id === id)

// ── Mutations (callers snapshot first) ───────────────────────
export function setSetting(key, value) { state.doc.settings[key] = value }

export function addPerson(fields = {}) {
  const p = { id: newId('p'), name: '', role: '', load: 100, sprintsOff: 0, open: false, country: '', vacations: [], ...fields }
  state.doc.people.push(p)
  return p
}
export function updatePerson(id, fields) {
  const p = person(id); if (!p) return
  Object.assign(p, fields)
  if (fields.vacations) p.vacations = periods(fields.vacations)
}

export function addDayOff(date, label, country = '') {
  if (!parseISO(date) || state.doc.daysOff.some(x => x.date === date && x.country === country)) return false
  state.doc.daysOff.push({ date, label: str(label, 60), country: code(country) })
  state.doc.daysOff.sort((a, b) => a.date.localeCompare(b.date))
  return true
}
export function removeDayOff(date, country = '') {
  state.doc.daysOff = state.doc.daysOff.filter(x => !(x.date === date && (x.country || '') === (country || '')))
}

/** Mark one country's public holiday as worked (on), or count it again (off). */
export function setWorked(country, date, on) {
  const s = state.doc.settings
  s.worked = (s.worked || []).filter(w => !(w.country === country && w.date === date))
  if (on) s.worked.push({ country, date })
}
export function removePerson(id) {
  state.doc.people = state.doc.people.filter(p => p.id !== id)
  for (const d of [...state.doc.deliverables, ...state.doc.backlog]) d.members = d.members.filter(m => m.person !== id)
}

export function addDeliverable(fields = {}) {
  const d = { id: newId('d'), name: '', estimate: null, note: '', members: [], ...fields, ...normalizePlanning(fields) }
  state.doc.deliverables.push(d)
  return d
}
export function updateDeliverable(id, fields) { Object.assign(findDeliverable(id) || {}, fields) }
export function removeDeliverable(id) {
  state.doc.deliverables = state.doc.deliverables.filter(d => d.id !== id)
  state.doc.backlog = state.doc.backlog.filter(d => d.id !== id)
}

// ── Later and done ───────────────────────────────────────────
/** Add a deliverable straight to the backlog. */
export function addBacklogItem(when, fields = {}) {
  const d = { id: newId('d'), name: '', estimate: null, note: '', members: [], ...fields, ...normalizePlanning(fields), when: when === 'done' ? 'done' : 'later' }
  state.doc.backlog.push(d)
  return d
}
/**
 * Move a deliverable between the plan and its backlog: `when` is 'plan',
 * 'later' or 'done'. Its people go with it, so a move back restores the
 * shares exactly as they were.
 */
export function moveDeliverable(id, when) {
  const doc = state.doc
  const inPlan = doc.deliverables.find(d => d.id === id)
  const shelved = doc.backlog.find(d => d.id === id)
  if (when === 'plan') {
    if (!shelved) return false
    doc.backlog = doc.backlog.filter(d => d !== shelved)
    const { when: _w, ...back } = shelved
    // A person removed while it was shelved already took their share with them.
    back.members = back.members.filter(m => doc.people.some(p => p.id === m.person))
    doc.deliverables.push(back)
    return true
  }
  const to = when === 'done' ? 'done' : 'later'
  if (shelved) { if (shelved.when === to) return false; shelved.when = to; return true }
  if (!inPlan) return false
  doc.deliverables = doc.deliverables.filter(d => d !== inPlan)
  doc.backlog.unshift({ ...inPlan, when: to })
  return true
}

/**
 * Empty the plan: people, deliverables, backlog, team days off. The dates,
 * countries and sprint rules stay unless `settings` is true. Callers
 * snapshot first, so Ctrl+Z brings it all back.
 */
export function wipe({ settings = false } = {}) {
  const doc = state.doc
  doc.people = []; doc.deliverables = []; doc.backlog = []; doc.daysOff = []
  if (settings) doc.settings = { ...DEFAULT_SETTINGS, startDate: defaultStart(), countries: [], worked: [] }
}

const pct2 = x => Math.round(Math.min(PCT_MAX, Math.max(PCT_MIN, x)) * 100) / 100

/**
 * Give a person `pct` percent of their capacity on a deliverable. An existing
 * share grows instead of duplicating; a fixed-points share becomes a
 * percentage (`fixedPct` is what its points were worth).
 */
export function assign(delivId, personId, pct, fixedPct = 0) {
  const d = deliverable(delivId); if (!d || !person(personId)) return false
  const m = d.members.find(x => x.person === personId)
  if (m) { m.pct = pct2((m.pct ?? fixedPct) + pct); delete m.points }
  else d.members.push({ person: personId, pct: pct2(pct) })
  return true
}
/**
 * Multiply every share a person holds by `factor` (Scale to 100%). A
 * fixed-points share goes through `effective`, its percent as analysed.
 */
export function scaleShares(personId, factor, effective = new Map()) {
  for (const d of state.doc.deliverables) {
    const m = d.members.find(x => x.person === personId)
    if (!m) continue
    m.pct = pct2((m.pct ?? effective.get(d.id) ?? 0) * factor)
    delete m.points
  }
}

/** Set one share to `pct` percent of the person's capacity. */
export function setShare(delivId, personId, pct) {
  const m = deliverable(delivId)?.members.find(x => x.person === personId)
  if (m) { m.pct = pct2(pct); delete m.points }
}
export function unassign(delivId, personId) {
  const d = deliverable(delivId); if (!d) return
  d.members = d.members.filter(m => m.person !== personId)
}
/**
 * Move a person's whole share to another deliverable. The caller passes both
 * shares as effective percentages (a fixed-points share has one too), so a
 * move onto a deliverable they already hold merges into one percentage.
 */
export function moveShare(fromId, toId, personId, movedPct, therePct = 0) {
  const from = deliverable(fromId), to = deliverable(toId)
  if (!from || !to || fromId === toId || !from.members.some(x => x.person === personId)) return false
  from.members = from.members.filter(x => x.person !== personId)
  return assign(toId, personId, movedPct, therePct)
}
/** Reorder deliverables: drop `id` before `beforeId` (or at the end). */
export function reorderDeliverable(id, beforeId) {
  const list = state.doc.deliverables
  const d = deliverable(id); if (!d || id === beforeId) return
  list.splice(list.indexOf(d), 1)
  const at = beforeId ? list.findIndex(x => x.id === beforeId) : -1
  if (at < 0) list.push(d); else list.splice(at, 0, d)
}
