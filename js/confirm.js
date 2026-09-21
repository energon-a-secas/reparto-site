// ── Confirm ──────────────────────────────────────────────────
// One dialog for the two steps that empty or remove a plan (Wipe, Delete).
// Both are undoable one way or another, and the dialog says which, so it
// asks once and never twice.

import { openModal, closeModal } from './modal.js'
import { $ } from './utils.js'

let onOk = null

/** Ask, then run `ok(checked)` on the confirm button. Cancel, Esc and the backdrop do nothing. */
export function askConfirm({ title, body, confirm, safe = '', check = '' }, ok) {
  $('confirmTitle').textContent = title
  $('confirmBody').textContent = body
  $('confirmSafe').textContent = safe
  $('confirmSafe').hidden = !safe
  $('confirmCheckWrap').hidden = !check
  $('confirmCheck').checked = false
  $('confirmCheckText').textContent = check
  $('confirmOk').textContent = confirm
  onOk = ok
  openModal('confirmModal')      // focus lands on Close, so a stray Enter never confirms
}

export function bindConfirm() {
  $('confirmOk').addEventListener('click', () => {
    const run = onOk, checked = $('confirmCheck').checked
    onOk = null
    closeModal('confirmModal')
    run?.(checked)
  })
}
