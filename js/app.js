// ── Entry point ──────────────────────────────────────────────
// Load the plan (share link first, then the saved session, else the
// example), paint it, wire the inputs. Nothing else lives here.

import { ui } from './state.js'
import { loadSaved } from './plans.js'
import { renderAll, afterChange } from './render.js'
import { bindEvents } from './events.js'
import { loadFromHash } from './io.js'
import { onHolidays, loadIndex } from './holidays.js'
import { showToast, plural } from './utils.js'
import { initWorkspace, mountWorkspace } from './workspace-ui.js'

function init() {
  try { const v = localStorage.getItem('reparto-v1-view'); if (v === 'table' || v === 'map') ui.view = v } catch { /* a convenience only */ }
  const hadPlan = loadSaved()
  initWorkspace({ opened: fromTeam })   // before the hash is read: a team's answer arrives there and is stripped
  const shared = loadFromHash()      // a first visit's untouched example is not stored, so the link is the only plan
  onHolidays(renderAll)
  renderAll()
  bindEvents()
  mountWorkspace()
  loadIndex().then(renderAll)          // the country list fills the pickers once it lands
  if (shared) opened(shared, hadPlan)
  // A share link pasted into a tab that already has Reparto open changes only the hash.
  window.addEventListener('hashchange', () => { const r = loadFromHash(); if (r) opened(r, true) })
}

function opened(r, hadPlan) {
  afterChange()
  showToast(r.existing ? 'That shared plan was already here, so it is open now'
    : hadPlan ? 'Opened a shared plan as a plan of its own. Yours are under Plans' : 'Opened a shared plan')
}

function fromTeam(r, raw) {
  afterChange()
  showToast(r.existing ? `That plan was already here, so ${raw.title} is open now`
    : `New plan from ${raw.title}: ${plural(raw.people.length, 'person', 'people')}. Add deliverables next`)
  document.getElementById('addDelivBtn')?.focus({ preventScroll: true })
}

init()
