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
import { examplePlan, blankPlan } from './seed.js'

const STORE_KEY = 'reparto-v1-plans'
const LEGACY_KEY = 'reparto-v1'
const TAB_KEY = 'reparto-v1-tab'
const PREVIOUS_KEY = 'reparto-v1-previous'
const PREVIOUS_MAX = 10

function readStore() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null')
    if (s && s.plans && typeof s.plans === 'object') return s
  } catch { /* unreadable: treated as absent */ }
  return null
}
const writeStore = s => { try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); return true } catch { return false } }
const tabPlan = () => { try { return sessionStorage.getItem(TAB_KEY) } catch { return null } }
const setTabPlan = id => { try { sessionStorage.setItem(TAB_KEY, id) } catch { /* no session storage */ } }
const recent = store => Object.entries(store.plans).sort((a, b) => (b[1].savedAt || 0) - (a[1].savedAt || 0)).map(([id]) => id)

// Whether the open plan is in the store. A first visit's untouched example is
// not: it is nobody's plan, so opening a link or starting a blank one drops it.
let stored = false
export const isStored = () => stored
let exampleId = null      // the first-run example, so it is listed as the example once it is saved

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
      try { open(id, normalizeDoc(store.plans[id].doc)); stored = true; return true } catch { /* damaged: try the next */ }
    }
  } else {
    try {
      const legacy = JSON.parse(localStorage.getItem(LEGACY_KEY) || 'null')
      if (legacy?.doc) { open(newId('pl'), normalizeDoc(legacy.doc)); saveState(); return true }
    } catch { /* unreadable: fall through to the example */ }
  }
  ui.firstRun = true
  exampleId = newId('pl')
  open(exampleId, normalizeDoc(examplePlan()))
  stored = false
  return false
}

/** Save the open plan (afterChange calls this on every change). `origin` is recorded the first time only. */
export function saveState(origin = '') {
  const store = readStore() || { v: 1, plans: {} }
  const now = Date.now()
  const had = store.plans[state.planId]
  store.plans[state.planId] = { doc: state.doc, savedAt: now, createdAt: had?.createdAt || now, origin: had?.origin || origin || (state.planId === exampleId ? 'example' : '') }
  store.active = state.planId
  if (writeStore(store)) stored = true
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify({ v: 1, doc: state.doc, savedAt: now })) } catch { /* full */ }
  setTabPlan(state.planId)
}

/** The plans for the switcher, most recently saved first. The open one is always listed. */
export function listPlans() {
  const store = readStore() || { plans: {} }
  const list = Object.entries(store.plans).map(([id, p]) => ({
    id, title: p.doc?.title || 'Untitled plan', origin: p.origin || '', savedAt: p.savedAt || 0,
    people: p.doc?.people?.length || 0, deliverables: p.doc?.deliverables?.length || 0,
  }))
  const open = list.find(x => x.id === state.planId)
  if (open) Object.assign(open, { title: state.doc.title, people: state.doc.people.length, deliverables: state.doc.deliverables.length })
  else list.push({ id: state.planId, title: state.doc.title, origin: 'example', savedAt: Infinity, people: state.doc.people.length, deliverables: state.doc.deliverables.length, unsaved: true })
  return list.sort((a, b) => b.savedAt - a.savedAt)
}

/** Open another saved plan. Its undo history (this session's) comes with it. */
export function switchPlan(id) {
  if (id === state.planId) return false
  const store = readStore()
  const entry = store?.plans[id]
  if (!entry) return false
  let doc
  try { doc = normalizeDoc(entry.doc) } catch { return false }
  if (!stored) dropHistory(state.planId)
  open(id, doc)
  stored = true
  ui.firstRun = false
  store.active = id
  writeStore(store)
  return true
}

/**
 * Open a plan as a new one beside the others: a link, an import, the
 * example, a blank or a copy. The same plan already here (same content) is
 * switched to instead of stored twice. Returns { id, existing }.
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
  if (!stored) dropHistory(state.planId)
  open(newId('pl'), doc)
  ui.firstRun = false
  saveState(origin)
  return { id: state.planId, existing: false }
}

export const newBlankPlan = () => openPlan(blankPlan(), 'blank')
export const openExample = () => openPlan(examplePlan(), 'example')
export const duplicatePlan = () => openPlan({ ...structuredClone(state.doc), title: `Copy of ${state.doc.title}`.slice(0, 80) }, 'copy')

/**
 * Delete a plan. It goes to the previous-plans list, so Plans > Restore
 * brings it back; deleting the open plan opens the next most recent one,
 * or a blank plan when it was the last.
 */
export function deletePlan(id = state.planId) {
  const store = readStore() || { v: 1, plans: {} }
  const doc = id === state.planId ? state.doc : store.plans[id]?.doc
  if (doc) keepPrevious(doc, 'deleted')
  delete store.plans[id]
  dropHistory(id)
  if (id !== state.planId) { writeStore(store); return }
  for (const next of recent(store)) {
    try { open(next, normalizeDoc(store.plans[next].doc)) } catch { continue }
    store.active = next
    writeStore(store)
    stored = true
    return
  }
  writeStore(store)
  open(newId('pl'), normalizeDoc(blankPlan()))
  saveState('blank')
}

// ── Previous plans: deleted and wiped ones, kept to restore ──
export function previousPlans() {
  try {
    const list = JSON.parse(localStorage.getItem(PREVIOUS_KEY) || '[]')
    return Array.isArray(list) ? list.filter(x => x && x.doc) : []
  } catch { return [] }
}

/** Keep a copy of a plan about to be deleted or wiped. An empty plan is nothing to keep. */
export function keepPrevious(doc, why = '') {
  try {
    if (!doc || (!doc.people.length && !doc.deliverables.length && !(doc.backlog || []).length)) return
    const json = JSON.stringify(doc)
    const list = previousPlans()
    if (list[0] && JSON.stringify(list[0].doc) === json) return
    list.unshift({ title: doc.title, savedAt: Date.now(), why, doc: JSON.parse(json) })
    localStorage.setItem(PREVIOUS_KEY, JSON.stringify(list.slice(0, PREVIOUS_MAX)))
  } catch { /* private mode or full: nothing to keep */ }
}

/** Reopen a kept plan as a plan of its own, and take it off the list. */
export function restorePrevious(index) {
  const list = previousPlans()
  const entry = list[index]
  if (!entry) return null
  const opened = openPlan(entry.doc, 'restored')
  list.splice(index, 1)
  try { localStorage.setItem(PREVIOUS_KEY, JSON.stringify(list)) } catch { /* full */ }
  return { ...opened, title: entry.doc.title }
}
