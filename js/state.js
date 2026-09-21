// ── State ────────────────────────────────────────────────────
// `doc` is the plan (saved, shared, exported). `ui` is the view (never saved,
// never in an undo snapshot). Every mutation is: snapshot(), mutate,
// afterChange() in render.js, which saves and repaints.

import { DEFAULT_SETTINGS, SCALE, ROUNDING } from './capacity.js'
import { examplePlan } from './seed.js'

const STORAGE_KEY = 'reparto-v1'
const UNDO_DEPTH = 40

export const state = { doc: examplePlan() }

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
let seq = 0
export const newId = prefix => `${prefix}-${Date.now().toString(36)}${(seq++).toString(36)}`

/** Coerce anything (a saved session, an import, a share link) into a valid plan. Throws on garbage. */
export function normalizeDoc(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.people) || !Array.isArray(raw.deliverables)) {
    throw new Error('Not a Reparto plan: it needs people and deliverables lists')
  }
  const s = { ...DEFAULT_SETTINGS, ...(raw.settings || {}) }
  const settings = {
    weeksPerSprint: num(s.weeksPerSprint, 1, 4, 2),
    daysPerWeek: num(s.daysPerWeek, 1, 7, 5),
    meetingDay: !!s.meetingDay,
    pointsPerDay: num(s.pointsPerDay, 0.5, 3, 1),
    sprintCap: num(s.sprintCap, 0, 89, 0),
    sprints: num(Math.round(s.sprints), 1, 13, 4),
    buffer: num(s.buffer, 0, 50, 0),
    rounding: s.rounding in ROUNDING ? s.rounding : 'nearest',
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
      members.push({ person: m.person, points: num(Math.round(m.points), 1, 999, 1) })
    }
    const est = Number(d.estimate)
    deliverables.push({
      id, name: str(d.name), note: str(d.note, 400),
      estimate: SCALE.includes(est) ? est : null,
      members,
    })
  }
  return { v: 1, title: str(raw.title) || 'Untitled plan', settings, people, deliverables }
}

// ── Persistence ──────────────────────────────────────────────
export function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) { ui.firstRun = true; return false }
    state.doc = normalizeDoc(JSON.parse(raw).doc)
    return true
  } catch {
    ui.firstRun = true
    return false
  }
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

/** Replace the whole plan (example, import, share link, reset). Undoable. */
export function resetTo(doc) {
  snapshot()
  state.doc = normalizeDoc(doc)
}

// ── Lookups ──────────────────────────────────────────────────
export const person = id => state.doc.people.find(p => p.id === id)
export const deliverable = id => state.doc.deliverables.find(d => d.id === id)

// ── Mutations (callers snapshot first) ───────────────────────
export function setSetting(key, value) { state.doc.settings[key] = value }

export function addPerson(fields = {}) {
  const p = { id: newId('p'), name: '', role: '', load: 100, sprintsOff: 0, open: false, ...fields }
  state.doc.people.push(p)
  return p
}
export function updatePerson(id, fields) { Object.assign(person(id) || {}, fields) }
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

/** Add points for a person on a deliverable; an existing share grows instead of duplicating. */
export function assign(delivId, personId, points) {
  const d = deliverable(delivId); if (!d || !person(personId)) return false
  const m = d.members.find(x => x.person === personId)
  if (m) m.points += points
  else d.members.push({ person: personId, points })
  return true
}
export function unassign(delivId, personId) {
  const d = deliverable(delivId); if (!d) return
  d.members = d.members.filter(m => m.person !== personId)
}
export function setPoints(delivId, personId, points) {
  const m = deliverable(delivId)?.members.find(x => x.person === personId)
  if (m) m.points = Math.max(1, Math.round(points))
}
/** Move a person's whole share from one deliverable to another. */
export function moveShare(fromId, toId, personId) {
  const from = deliverable(fromId), to = deliverable(toId)
  const m = from?.members.find(x => x.person === personId)
  if (!m || !to || fromId === toId) return false
  from.members = from.members.filter(x => x !== m)
  assign(toId, personId, m.points)
  return true
}
/** Reorder deliverables: drop `id` before `beforeId` (or at the end). */
export function reorderDeliverable(id, beforeId) {
  const list = state.doc.deliverables
  const d = deliverable(id); if (!d || id === beforeId) return
  list.splice(list.indexOf(d), 1)
  const at = beforeId ? list.findIndex(x => x.id === beforeId) : -1
  if (at < 0) list.push(d); else list.splice(at, 0, d)
}
