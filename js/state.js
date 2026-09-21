// ── State ────────────────────────────────────────────────────
// `doc` is the plan (saved, shared, exported). `ui` is the view (never saved,
// never in an undo snapshot). Every mutation is: snapshot(), mutate,
// afterChange() in render.js, which saves and repaints.

import { DEFAULT_SETTINGS, SCALE, ROUNDING, defaultStart } from './capacity.js'
import { parseISO } from './calendar.js'
import { examplePlan } from './seed.js'

const STORAGE_KEY = 'reparto-v1'
const UNDO_DEPTH = 40

export const state = { doc: null }   // set by loadSaved(): the saved plan, else the example

export const ui = {
  carry: null,        // { person, from } while a person is picked up by click or key
  focus: null,        // { kind, ids } highlighted from a flag
  filter: 'all',      // flag category filter
  showInfo: false,    // info-level flags are folded by default
  firstRun: false,
}

const undoStack = [], redoStack = []

// ── Validation: one gate in front of every entry point ───────
const num = (v, lo, hi, dflt) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt
}
const str = (v, max = 80) => (typeof v === 'string' ? v.slice(0, max) : '')
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
    rounding: s.rounding in ROUNDING ? s.rounding : 'nearest',
    // Public holidays a country's team works anyway: [{ country, date }].
    worked: dedupe((Array.isArray(s.worked) ? s.worked : [])
      .map(w => ({ country: code(w?.country), date: date(w?.date) })).filter(w => w.country && w.date), w => `${w.country}|${w.date}`).slice(0, 60),
  }
  const people = []
  const seen = new Set()
  for (const p of raw.people) {
    if (!p || typeof p !== 'object') continue
    let id = str(p.id, 40) || newId('p')
    if (seen.has(id)) id = newId('p')
    seen.add(id)
    people.push({
      id, name: str(p.name), role: str(p.role),
      load: num(p.load ?? 100, 0, 100, 100),
      sprintsOff: num(Math.round(p.sprintsOff || 0), 0, 13, 0),
      open: !!p.open,
      country: code(p.country),
      vacations: periods(p.vacations),
    })
  }
  const deliverables = []
  for (const d of raw.deliverables) {
    if (!d || typeof d !== 'object') continue
    let id = str(d.id, 40) || newId('d')
    if (seen.has(id)) id = newId('d')
    seen.add(id)
    const members = []
    for (const m of Array.isArray(d.members) ? d.members : []) {
      if (!m || !people.some(p => p.id === m.person) || members.some(x => x.person === m.person)) continue
      // pct is the share of the person's capacity (dynamic); points is a fixed share from before percentages.
      if (m.pct != null && Number.isFinite(Number(m.pct))) members.push({ person: m.person, pct: Math.round(num(m.pct, 1, 400, 100) * 100) / 100 })
      else members.push({ person: m.person, points: num(Math.round(m.points), 1, 999, 1) })
    }
    const est = Number(d.estimate)
    deliverables.push({
      id, name: str(d.name), note: str(d.note, 400),
      estimate: SCALE.includes(est) ? est : null,
      members,
    })
  }
  const daysOff = []
  for (const t of Array.isArray(raw.daysOff) ? raw.daysOff : []) {
    const d = date(t?.date), c = code(t?.country)
    if (d && !daysOff.some(x => x.date === d && x.country === c)) daysOff.push({ date: d, label: str(t.label, 60), country: c })
    if (daysOff.length >= 200) break
  }
  daysOff.sort((a, b) => a.date.localeCompare(b.date))
  return { v: 1, title: str(raw.title) || 'Untitled plan', settings, daysOff, people, deliverables }
}

// ── Persistence ──────────────────────────────────────────────
export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) { state.doc = normalizeDoc(JSON.parse(raw).doc); return true }
  } catch { /* unreadable: fall through to the example */ }
  ui.firstRun = true
  state.doc = normalizeDoc(examplePlan())
  return false
}

export function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ v: 1, doc: state.doc, savedAt: Date.now() })) } catch { /* private mode or full */ }
}

// ── Undo ─────────────────────────────────────────────────────
export function snapshot() {
  undoStack.push(JSON.stringify(state.doc))
  if (undoStack.length > UNDO_DEPTH) undoStack.shift()
  redoStack.length = 0
}
export function undo() {
  if (!undoStack.length) return false
  redoStack.push(JSON.stringify(state.doc))
  state.doc = JSON.parse(undoStack.pop())
  return true
}
export function redo() {
  if (!redoStack.length) return false
  undoStack.push(JSON.stringify(state.doc))
  state.doc = JSON.parse(redoStack.pop())
  return true
}
export const canUndo = () => undoStack.length > 0
export const canRedo = () => redoStack.length > 0

/** Replace the whole plan (example, import, share link, reset). Undoable, and the replaced plan is kept. */
export function resetTo(doc) {
  const next = normalizeDoc(doc)
  keepPrevious(next)
  snapshot()
  state.doc = next
}

// ── Previous plans ───────────────────────────────────────────
// Undo lives in memory, so a share link that replaced your plan used to be
// the end of it once the tab reloaded. The last five replaced plans are kept
// in localStorage and offered under Plan > Restore a previous plan.
const PREVIOUS_KEY = 'reparto-v1-previous'
const PREVIOUS_MAX = 5

export function previousPlans() {
  try {
    const list = JSON.parse(localStorage.getItem(PREVIOUS_KEY) || '[]')
    return Array.isArray(list) ? list.filter(x => x && x.doc) : []
  } catch { return [] }
}

function keepPrevious(incoming) {
  try {
    const current = state.doc
    if (!current || (!current.people.length && !current.deliverables.length)) return
    const json = JSON.stringify(current)
    const list = previousPlans()
    if (json === JSON.stringify(incoming) || (list[0] && JSON.stringify(list[0].doc) === json)) return
    list.unshift({ title: current.title, savedAt: Date.now(), doc: current })
    localStorage.setItem(PREVIOUS_KEY, JSON.stringify(list.slice(0, PREVIOUS_MAX)))
  } catch { /* private mode or full: nothing to keep */ }
}

// ── Lookups ──────────────────────────────────────────────────
export const person = id => state.doc.people.find(p => p.id === id)
export const deliverable = id => state.doc.deliverables.find(d => d.id === id)

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
  for (const d of state.doc.deliverables) d.members = d.members.filter(m => m.person !== id)
}

export function addDeliverable(fields = {}) {
  const d = { id: newId('d'), name: '', estimate: null, note: '', members: [], ...fields }
  state.doc.deliverables.push(d)
  return d
}
export function updateDeliverable(id, fields) { Object.assign(deliverable(id) || {}, fields) }
export function removeDeliverable(id) { state.doc.deliverables = state.doc.deliverables.filter(d => d.id !== id) }

const pct2 = x => Math.round(Math.min(400, Math.max(1, x)) * 100) / 100

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
