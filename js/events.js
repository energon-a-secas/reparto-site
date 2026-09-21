// ── Events ───────────────────────────────────────────────────
// One delegated click handler (data-action), one change handler (settings
// and inline names), one keydown handler. No inline onclick anywhere.

import {
  state, ui, snapshot, undo, redo, resetTo, setSetting, person, deliverable,
  addPerson, updatePerson, removePerson, addDeliverable, updateDeliverable, removeDeliverable, unassign,
} from './state.js'
import { analyze, capacityOf, rawCapacity } from './capacity.js'
import { examplePlan, blankPlan } from './seed.js'
import { afterChange, renderAll } from './render.js'
import { bindDnd, justDragged } from './dnd.js'
import { pickUp, putDown, cancelCarry, applyFix, show } from './actions.js'
import { openEstimate, openPoints, closePop, popAnchor, repositionPop } from './popover.js'
import { openModal, closeModal, modalKeydown, modalClick } from './modal.js'
import { runExport, importFile } from './io.js'
import { $, showToast, plural } from './utils.js'

export function bindEvents() {
  bindDnd()
  setupMenu('planBtn', 'planMenu')
  setupMenu('exportBtn', 'exportMenu')
  document.addEventListener('click', onClick)
  document.addEventListener('change', onChange)
  document.addEventListener('keydown', onKey)
  document.addEventListener('scroll', repositionPop, { capture: true, passive: true })
  window.addEventListener('resize', repositionPop)
  $('personForm').addEventListener('submit', onAddPerson)
  $('personEdit').addEventListener('submit', onSavePerson)
  $('personEdit').addEventListener('input', paintCapNote)
  $('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = '' })
}

// ── Menus (.header-menu toggled here, the floorplan-site pattern) ──
function setupMenu(btnId, menuId) {
  const btn = $(btnId), menu = $(menuId)
  const close = () => { menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false') }
  btn.addEventListener('click', e => {
    e.stopPropagation()
    const open = !menu.classList.contains('open')
    document.querySelectorAll('.header-menu.open').forEach(m => m.classList.remove('open'))
    menu.classList.toggle('open', open)
    btn.setAttribute('aria-expanded', String(open))
    if (open) menu.querySelector('[role="menuitem"]')?.focus()
  })
  document.addEventListener('click', e => { if (!menu.contains(e.target) && e.target !== btn) close() })
  menu.addEventListener('click', e => { if (e.target.closest('[role="menuitem"]')) close() })
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && menu.classList.contains('open')) { close(); btn.focus() } })
}

// ── Clicks ───────────────────────────────────────────────────
function onClick(e) {
  const t = e.target
  modalClick(e)
  const pop = $('pop')
  if (!pop.hidden && !pop.contains(t) && !t.closest('[data-action="estimate"], [data-action="points"]')) closePop({ restore: false })
  if (justDragged()) return

  const exp = t.closest('[data-export]')
  if (exp) { runExport(exp.dataset.export); return }
  const act = t.closest('[data-action]')
  if (act && !act.disabled) { runAction(act.dataset.action, act); return }

  // Carrying someone: a click on a deliverable (or the roster, for a share) puts them down.
  if (ui.carry && !t.closest('button, input, select, textarea, a, [data-drag]')) {
    const card = t.closest('[data-drop="deliverable"]')
    if (card) { putDown(card.dataset.deliv); return }
    if (ui.carry.from && t.closest('[data-drop="roster"]')) { putDown('roster'); return }
  }
}

function runAction(action, el = null) {
  const id = el?.dataset.id
  switch (action) {
    case 'undo': if (undo()) { closePop({ restore: false }); afterChange() } break
    case 'redo': if (redo()) { closePop({ restore: false }); afterChange() } break
    case 'example':
      resetTo(examplePlan()); afterChange()
      showToast('Example loaded. Your previous plan is one undo away')
      break
    case 'blank':
      resetTo(blankPlan()); afterChange()
      showToast('Blank plan. Your previous plan is one undo away')
      $('personName').focus()
      break
    case 'import': $('importFile').click(); break
    case 'help': openModal('helpModal'); break
    case 'add-deliverable': {
      snapshot(); const d = addDeliverable(); afterChange()
      const input = document.querySelector(`[data-key="dn-${d.id}"]`)
      input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); input?.focus({ preventScroll: true })
      break
    }
    case 'remove-deliverable': {
      const d = deliverable(id); if (!d) break
      snapshot(); removeDeliverable(id); afterChange()
      showToast(`Removed ${d.name || 'the deliverable'}. Ctrl+Z brings it back`)
      break
    }
    case 'edit-person': openPerson(id); break
    case 'remove-person': {
      const pid = $('personEdit').dataset.id, p = person(pid); if (!p) break
      closeModal('personModal')
      snapshot(); removePerson(pid); afterChange()
      showToast(`${p.name || 'Person'} removed with their shares. Ctrl+Z brings them back`)
      break
    }
    case 'estimate': togglePop(`de-${id}`, () => openEstimate(id)); break
    case 'points': togglePop(`sp-${id}-${el.dataset.person}`, () => openPoints(id, el.dataset.person)); break
    case 'unassign': {
      const p = person(el.dataset.person), d = deliverable(id)
      snapshot(); unassign(id, el.dataset.person); afterChange()
      showToast(`${p?.name || 'Person'} taken off ${d?.name || 'the deliverable'}`)
      break
    }
    case 'drop': putDown(id); break
    case 'cancel-carry': cancelCarry(); break
    case 'horizon': setAndRender('sprints', Number(el.dataset.sprints)); break
    case 'toggle-meeting': setAndRender('meetingDay', !state.doc.settings.meetingDay); break
    case 'filter': ui.filter = el.dataset.filter; renderAll(); break
    case 'toggle-info': ui.showInfo = !ui.showInfo; renderAll(); break
    case 'show': show(el.dataset.kind, el.dataset.ids ? el.dataset.ids.split(',') : []); break
    case 'fix': applyFix(el.dataset.fix, el.dataset.arg, openEstimate); break
  }
}

/** A second click on the control that opened the popover closes it; any other opens its own. */
function togglePop(key, openFn) {
  if (popAnchor() === key) closePop({ restore: false })
  else openFn()
}

function setAndRender(key, value) {
  if (state.doc.settings[key] === value) return
  snapshot(); setSetting(key, value); afterChange()
}

// ── Changes: settings selects, inline names ──────────────────
function onChange(e) {
  const t = e.target
  if (t.dataset.setting) {
    const key = t.dataset.setting
    const v = key === 'rounding' ? t.value : Number(t.value)
    setAndRender(key, v)
    return
  }
  if (t.dataset.field === 'name' && t.dataset.id) {
    const d = deliverable(t.dataset.id)
    const v = t.value.trim().slice(0, 80)
    if (d && d.name !== v) { snapshot(); updateDeliverable(d.id, { name: v }); afterChange() }
    return
  }
  if (t.id === 'planTitle') {
    const v = t.value.trim().slice(0, 80) || 'Untitled plan'
    if (v !== state.doc.title) { snapshot(); state.doc.title = v; afterChange() }
  }
}

// ── Keys ─────────────────────────────────────────────────────
function onKey(e) {
  if (modalKeydown(e)) return
  const t = e.target
  const typing = t.matches('input, textarea, select')
  if (e.key === 'Escape') {
    if (closePop()) { e.preventDefault(); return }
    if (cancelCarry()) { e.preventDefault(); return }
    return
  }
  if ((e.metaKey || e.ctrlKey) && !typing) {
    const k = e.key.toLowerCase()
    if (k === 'z' || k === 'y') {
      e.preventDefault()
      runAction(k === 'y' || e.shiftKey ? 'redo' : 'undo')
      return
    }
  }
  if (e.key === 'Enter' && typing && (t.dataset.field === 'name' || t.id === 'planTitle')) { t.blur(); return }
  // Explicit rather than implicit submission: synthetic Enters (automation, some IMEs) carry no keyCode.
  if (e.key === 'Enter' && t.form?.id === 'personForm') { e.preventDefault(); t.form.requestSubmit(); return }
  if ((e.key === 'Enter' || e.key === ' ') && t.matches('[data-drag="person"]')) {
    e.preventDefault()
    pickUp(t.dataset.person, t.dataset.from || null)
  }
}

// ── People: add, edit ────────────────────────────────────────
function onAddPerson(e) {
  e.preventDefault()
  const name = $('personName').value.trim(), role = $('personRole').value.trim()
  if (!name) { $('personName').focus(); showToast('Give the person a name first'); return }
  snapshot(); addPerson({ name: name.slice(0, 80), role: role.slice(0, 80) }); afterChange()
  $('personName').value = ''; $('personRole').value = ''
  $('personName').focus()
  const a = analyze(state.doc)
  showToast(`${name} joins with ${a.unit} pts. Drag them onto a deliverable`)
}

function openPerson(id) {
  const p = person(id); if (!p) return
  const f = $('personEdit')
  f.dataset.id = id
  f.elements.name.value = p.name
  f.elements.role.value = p.role
  const sprints = state.doc.settings.sprints
  f.elements.sprintsOff.innerHTML = Array.from({ length: sprints + 1 }, (_, i) =>
    `<option value="${i}">${i === 0 ? 'None' : plural(i, 'sprint')}</option>`).join('')
  f.elements.sprintsOff.value = String(Math.min(p.sprintsOff, sprints))
  const load = f.elements.load
  if (![...load.options].some(o => Number(o.value) === p.load)) load.insertAdjacentHTML('beforeend', `<option value="${p.load}">${p.load}%</option>`)
  load.value = String(p.load)
  f.elements.open.checked = p.open
  $('personModalTitle').textContent = p.name ? `Edit ${p.name}` : 'Edit person'
  paintCapNote()
  openModal('personModal')
}

function formFields() {
  const f = $('personEdit')
  return {
    name: f.elements.name.value.trim().slice(0, 80),
    role: f.elements.role.value.trim().slice(0, 80),
    load: Number(f.elements.load.value),
    sprintsOff: Number(f.elements.sprintsOff.value),
    open: f.elements.open.checked,
  }
}

function paintCapNote() {
  const s = state.doc.settings, v = formFields()
  const raw = rawCapacity(v, s), cap = capacityOf(v, s)
  const sprints = Math.max(0, s.sprints - v.sprintsOff)
  $('personCapNote').textContent =
    `${analyze(state.doc).sprint} pts × ${plural(sprints, 'sprint')} × ${v.load}%${s.buffer ? ` − ${s.buffer}% buffer` : ''} = ${+raw.toFixed(1)}, planned as ${cap}.`
}

function onSavePerson(e) {
  e.preventDefault()
  const id = $('personEdit').dataset.id
  if (!person(id)) { closeModal('personModal'); return }
  snapshot(); updatePerson(id, formFields())
  closeModal('personModal')
  afterChange()
}
