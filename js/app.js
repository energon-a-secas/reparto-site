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
  loadSaved()
  const shared = loadFromHash()
  onHolidays(renderAll)
  renderAll()
  bindEvents()
  loadIndex().then(renderAll)          // the country list fills the pickers once it lands
  if (shared) {
    afterChange()
    showToast('Opened a shared plan. Yours is kept under Plan > Restore a previous plan')
  }
}

init()
