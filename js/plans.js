// ── Plans ────────────────────────────────────────────────────
// Every plan this browser holds, and which one is open. A share link, an
// import, the example and a blank plan each open as a plan of their own, so
// nothing replaces yours. A tab remembers its plan in sessionStorage, so two
// tabs can hold two plans; the store's `active` is where a new tab starts.
//
//   reparto-v1-plans     { v: 1, active, plans: { id: { doc, savedAt, createdAt, origin } } }
//   reparto-v1           the open plan alone, as before, for a tab still running older code
//   reparto-v1-previous  deleted and wiped plans, newest first, ten at most

import { state, ui, normalizeDoc, useHistory, dropHistory, newId } from './state.js'
import { DEFAULT_SETTINGS } from './capacity.js'
import { examplePlan, blankPlan } from './seed.js'

const STORE_KEY = 'reparto-v1-plans'
const LEGACY_KEY = 'reparto-v1'
const TAB_KEY = 'reparto-v1-tab'
const PREVIOUS_KEY = 'reparto-v1-previous'
const PREVIOUS_MAX = 10

// When the browser refuses a write (storage full, or blocked), this tab keeps
// its own changes here, plan by plan (an entry, or null for a delete), and
// lays them over whatever the store holds each time it is read. Every plan
// opened or edited since stays listed and switchable, the page can say it is
// not saved, and the first write that goes through carries only this tab's
// changes: a plan another tab made meanwhile is not wiped by a stale copy.
let local = null     // { plans: Map(id -> entry | null), active } while writes are refused

function readStore() {
  let s = null
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (parsed && parsed.plans && typeof parsed.plans === 'object') s = parsed
  } catch { /* unreadable or blocked: treated as absent */ }
  if (!local) return s
  s ||= { v: 1, plans: {} }
  for (const [id, entry] of local.plans) { if (entry) s.plans[id] = entry; else delete s.plans[id] }
  if (local.active) s.active = local.active
  return s
}

/** Apply one change ({ put: [id, entry] } | { remove: id }, and/or { active }) and write the store. False when refused. */
function change(ch) {
  const s = readStore() || { v: 1, plans: {} }
  if (ch.put) s.plans[ch.put[0]] = ch.put[1]
  if (ch.remove) delete s.plans[ch.remove]
  if (ch.active) s.active = ch.active
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); local = null; return true } catch {
    local ||= { plans: new Map(), active: null }
    if (ch.put) local.plans.set(ch.put[0], ch.put[1])
    if (ch.remove) local.plans.set(ch.remove, null)
    if (ch.active) local.active = ch.active
    return false
  }
}
const tabPlan = () => { try { return sessionStorage.getItem(TAB_KEY) } catch { return null } }
const setTabPlan = id => { try { sessionStorage.setItem(TAB_KEY, id) } catch { /* no session storage */ } }
const recent = store => Object.entries(store.plans).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0)).map(([id]) => id)

// A first visit's example is nobody's plan until it is touched: opening a
// link or a blank plan from it leaves it behind. `untouched` is only that; a
// write that fails does not make a plan someone edited count as untouched.
let exampleId = null
let untouched = false
/** True while this browser holds nothing but the first visit's untouched example. */
export const isUntouchedExample = () => untouched && state.planId === exampleId
/** True while plans exist only in memory because the browser refused to save them. */
export const isUnsaved = () => !!local

function open(id, doc) {
  state.planId = id
  state.doc = doc
  useHistory(id)
  setTabPlan(id)
  ui.carry = null; ui.focus = null; ui.scope = 'plan'
}

/** The tab's plan, else the last one used, else a plan from before named plans, else the example. True when a saved plan opened. */
export function loadSaved() {
  const store = readStore()
  if (store) {
    for (const id of [tabPlan(), store.active, ...recent(store)]) {
      if (!id || !store.plans[id]) continue
      try { open(id, normalizeDoc(store.plans[id].doc)); return true } catch { /* damaged: try the next */ }
    }
  } else {
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
      if (legacy?.doc) { open(newId('pl'), normalizeDoc(legacy.doc)); saveState(); return true }
    } catch { /* unreadable: fall through to the example */ }
  }
  ui.firstRun = true
  exampleId = newId('pl')
  untouched = true
  open(exampleId, normalizeDoc(examplePlan()))
  return false
}

/**
 * Save the open plan (afterChange calls this on every change). `origin` is
 * recorded the first time only. False when the browser refused the write
 * (storage full or blocked), so the page can say so instead of losing edits quietly.
 */
export function saveState(origin = '') {
  const now = Date.now()
  const had = readStore()?.plans[state.planId]
  const entry = { doc: state.doc, savedAt: now, createdAt: had?.createdAt || now, origin: had?.origin || origin || (state.planId === exampleId ? 'example' : '') }
  untouched = false
  const ok = change({ put: [state.planId, entry], active: state.planId })
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify({ v: 1, doc: state.doc, savedAt: now })) } catch { /* full */ }
  setTabPlan(state.planId)
  return ok
}

/** The plans for the switcher, most recently saved first. The open one is always listed. */
export function listPlans() {
  const store = readStore() || { plans: {} }
  const list = Object.entries(store.plans).map(([id, p]) => ({
    id, title: p.doc?.title || 'Untitled plan', origin: p.origin || '', savedAt: p.savedAt || 0,
    people: p.doc?.people?.length || 0, deliverables: p.doc?.deliverables?.length || 0, unsaved: !!local?.plans.has(id),
  }))
  const open = list.find(x => x.id === state.planId)
  if (open) Object.assign(open, { title: state.doc.title, people: state.doc.people.length, deliverables: state.doc.deliverables.length })
  else list.push({ id: state.planId, title: state.doc.title, origin: state.planId === exampleId ? 'example' : '', savedAt: Infinity, people: state.doc.people.length, deliverables: state.doc.deliverables.length, unsaved: true })
  return list.sort((a, b) => b.savedAt - a.savedAt)
}

/** Open another plan. Its undo history (this session's) comes with it. */
export function switchPlan(id) {
  if (id === state.planId) return false
  const store = readStore()
  const entry = store?.plans[id]
  if (!entry) return false
  let doc
  try { doc = normalizeDoc(entry.doc) } catch { return false }
  if (isUntouchedExample()) dropHistory(state.planId)
  open(id, doc)
  untouched = false
  ui.firstRun = false
  change({ active: id })
  return true
}

/**
 * Open a plan as a new one beside the others: a link, an import, the
 * example, a blank or a copy. The same plan already here (same content once
 * normalised, and normalising is deterministic) is switched to instead of
 * stored twice. Returns { id, existing }.
 */
export function openPlan(raw, origin = '') {
  const doc = normalizeDoc(raw)
  const json = JSON.stringify(doc)
  const store = readStore()
  for (const id of store ? recent(store) : []) {
    try {
      if (JSON.stringify(normalizeDoc(store.plans[id].doc)) !== json) continue
      if (id !== state.planId) switchPlan(id)
      return { id, existing: true }
    } catch { /* damaged entry: not a match */ }
  }
  if (isUntouchedExample()) dropHistory(state.planId)
  open(newId('pl'), doc)
  ui.firstRun = false
  saveState(origin)
  return { id: state.planId, existing: false }
}

export const newBlankPlan = () => openPlan(blankPlan(), 'blank')
export const openExample = () => openPlan(examplePlan(), 'example')
/** A copy under a title no other plan has ("Copy of Q4", "Copy 2 of Q4"), so it is always a new plan. */
export function duplicatePlan() {
  const titles = new Set(listPlans().map(p => p.title))
  // Cut where normalizeDoc would, never through an emoji, or the stored title differs from the one checked here.
  const base = state.doc.title.replace(/^Copy (\d+ )?of /, '').slice(0, 68).replace(/[\ud800-\udbff]$/, '')
  let title = ''
  for (let n = 1; !title || titles.has(title); n++) title = `Copy ${n > 1 ? `${n} ` : ''}of ${base}`
  return openPlan({ ...structuredClone(state.doc), title }, 'copy')
}

/**
 * A plan with nothing in it to lose: no people, work or days off, no
 * countries or worked holidays, default rules and a default name. Only such
 * a plan is not kept when it is deleted or wiped.
 */
export function isBlankPlan(doc) {
  const s = doc.settings
  const rules = Object.keys(DEFAULT_SETTINGS).filter(k => k !== 'startDate' && k !== 'countries')
  return !doc.people.length && !doc.deliverables.length && !(doc.backlog || []).length && !(doc.daysOff || []).length
    && !(s.countries || []).length && !(s.worked || []).length
    && rules.every(k => s[k] === DEFAULT_SETTINGS[k])
    && ['New plan', 'Untitled plan'].includes(doc.title)
}

/**
 * Delete a plan. It goes to the previous-plans list, so Plans > Restore
 * brings it back; deleting the open plan opens the next most recent one,
 * or a blank plan when it was the last. When no copy can be kept (storage
 * full or blocked) nothing is deleted and 'no-copy' comes back, unless the
 * caller asked `withoutCopy` after saying so.
 */
export function deletePlan(id = state.planId, { withoutCopy = false } = {}) {
  const store = readStore() || { v: 1, plans: {} }
  const doc = id === state.planId ? state.doc : store.plans[id]?.doc
  if (doc && !keepPrevious(doc, 'deleted') && !withoutCopy) return 'no-copy'
  dropHistory(id)
  const rest = recent(store).filter(x => x !== id)
  if (id !== state.planId) { change({ remove: id }); return 'deleted' }
  ui.firstRun = false
  untouched = false
  for (const next of rest) {
    try { open(next, normalizeDoc(store.plans[next].doc)) } catch { continue }
    change({ remove: id, active: next })
    return 'deleted'
  }
  change({ remove: id })
  open(newId('pl'), normalizeDoc(blankPlan()))
  saveState('blank')
  return 'deleted'
}

// ── Previous plans: deleted and wiped ones, kept to restore ──
export function previousPlans() {
  try {
    const list = JSON.parse(localStorage.getItem(PREVIOUS_KEY) || '[]')
    return Array.isArray(list) ? list.filter(x => x && x.doc) : []
  } catch { return [] }
}

/**
 * Keep a copy of a plan about to be deleted or wiped. True when a copy
 * exists afterwards (written now, already first in the list) or none is
 * needed (a blank plan). When the browser is short of room, older copies
 * make way for this one; false only when even that is refused.
 */
export function keepPrevious(doc, why = '') {
  if (!doc || isBlankPlan(doc)) return true
  const json = JSON.stringify(doc)
  const list = previousPlans()
  if (list[0] && JSON.stringify(list[0].doc) === json) return true
  list.unshift({ id: newId('kept'), title: doc.title, savedAt: Date.now(), why, doc: JSON.parse(json) })
  for (let n = Math.min(list.length, PREVIOUS_MAX); n >= 1; n--) {
    try { localStorage.setItem(PREVIOUS_KEY, JSON.stringify(list.slice(0, n))); return true } catch { /* full: keep fewer */ }
  }
  return false
}

/** An entry's key in the restore list; entries kept before keys existed use their time. */
export const previousKey = e => e.id || String(e.savedAt)

/**
 * Reopen a kept plan as a plan of its own, and take it off the list. By key,
 * not position: another tab may have changed the list since it was shown.
 */
export function restorePrevious(key) {
  const list = previousPlans()
  const index = list.findIndex(e => previousKey(e) === String(key))
  const entry = list[index]
  if (!entry) return null
  const opened = openPlan(entry.doc, 'restored')
  list.splice(index, 1)
  try { localStorage.setItem(PREVIOUS_KEY, JSON.stringify(list)) } catch { /* full */ }
  return { ...opened, title: entry.doc.title }
}
