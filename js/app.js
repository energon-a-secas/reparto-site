// ── Entry point ──────────────────────────────────────────────
// Load the plan (share link first, then the saved session, else the
// example), paint it, wire the inputs. Nothing else lives here.

import { ui } from './state.js'
import { loadSaved } from './plans.js'
import { renderAll, afterChange } from './render.js'
import { bindEvents } from './events.js'
import { loadFromHash } from './io.js'
import { onHolidays, loadIndex } from './holidays.js'
import { showToast } from './utils.js'

function init() {
  try { if (localStorage.getItem('reparto-v1-view') === 'table') ui.view = 'table' } catch { /* a convenience only */ }
  const hadPlan = loadSaved()
  const shared = loadFromHash()      // a first visit's untouched example is not stored, so the link is the only plan
  onHolidays(renderAll)
  renderAll()
  bindEvents()
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

init()
