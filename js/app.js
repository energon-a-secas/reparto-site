// ── Entry point ──────────────────────────────────────────────
// Load the plan (share link first, then the saved session, else the
// example), paint it, wire the inputs. Nothing else lives here.

import { loadSaved } from './state.js'
import { renderAll, afterChange } from './render.js'
import { bindEvents } from './events.js'
import { loadFromHash } from './io.js'
import { onHolidays, loadIndex } from './holidays.js'
import { showToast } from './utils.js'

function init() {
  const hadPlan = loadSaved()
  const shared = loadFromHash({ keep: hadPlan })    // a first visit's example is nobody's plan to keep
  onHolidays(renderAll)
  renderAll()
  bindEvents()
  loadIndex().then(renderAll)          // the country list fills the pickers once it lands
  if (shared) opened(hadPlan)
  // A share link pasted into a tab that already has Reparto open changes only the hash.
  window.addEventListener('hashchange', () => { if (loadFromHash()) opened(true) })
}

function opened(kept) {
  afterChange()
  showToast(kept ? 'Opened a shared plan. Yours is kept under Plan > Restore a previous plan' : 'Opened a shared plan')
}

init()
