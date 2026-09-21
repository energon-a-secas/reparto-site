// ── Events ───────────────────────────────────────────────────
// One delegated click handler (data-action), one change handler (settings
// and inline names), one keydown handler. No inline onclick anywhere.

import {
  state, ui, snapshot, undo, redo, resetTo, setSetting, person, deliverable,
  addPerson, addDeliverable, updateDeliverable, removeDeliverable, unassign, addDayOff, removeDayOff,
} from './state.js'
import { analyze } from './capacity.js'
import { parseISO } from './calendar.js'
import { cal } from './holidays.js'
import { bindPersonEditor, openPerson, removeEditedPerson } from './person-editor.js'
import { examplePlan, blankPlan } from './seed.js'
import { afterChange, renderAll } from './render.js'
import { bindDnd, justDragged } from './dnd.js'
import { pickUp, putDown, cancelCarry, applyFix, show } from './actions.js'
import { openEstimate, openShare, closePop, popAnchor, repositionPop } from './popover.js'
import { openModal, modalKeydown, modalClick } from './modal.js'
import { runExport, importFile } from './io.js'
import { $, showToast } from './utils.js'

export function bindEvents() {
  bindDnd()
  setupMenu('planBtn', 'planMenu')
  document.addEventListener('click', onClick)
  document.addEventListener('change', onChange)
  document.addEventListener('keydown', onKey)
  document.addEventListener('scroll', repositionPop, { capture: true, passive: true })
  window.addEventListener('resize', repositionPop)
  $('personForm').addEventListener('submit', onAddPerson)
  $('dayOffForm').addEventListener('submit', onAddDayOff)
  bindPersonEditor()
  $('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = '' })
}

// ── Menu (.header-menu opened here, so its keys are handled here too) ──
// It closes only itself: the header kit's own overflow panel is also a
// .header-menu, and closing every open one shut the panel this menu lives in.
function setupMenu(btnId, menuId) {
  const btn = $(btnId), menu = $(menuId)
  const items = () => [...menu.querySelectorAll('[role="menuitem"]')]
  const close = (focusBtn = false) => {
    if (!menu.classList.contains('open')) return
    menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false')
    if (focusBtn) btn.focus()
  }
  btn.addEventListener('click', e => {
    e.stopPropagation()
    const open = !menu.classList.contains('open')
    menu.classList.toggle('open', open)
    btn.setAttribute('aria-expanded', String(open))
    if (open) items()[0]?.focus()
  })
  document.addEventListener('click', e => { if (!menu.contains(e.target) && !btn.contains(e.target)) close() })
  menu.addEventListener('click', e => { if (e.target.closest('[role="menuitem"]')) close() })
  menu.addEventListener('keydown', e => {
    const list = items(), i = list.indexOf(document.activeElement)
    const go = n => { e.preventDefault(); list[(n + list.length) % list.length]?.focus() }
    if (e.key === 'ArrowDown') go(i + 1)
    else if (e.key === 'ArrowUp') go(i - 1)
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if (e.key === 'Tab') close()
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true) }
  })
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
    case 'remove-person': removeEditedPerson(); break
    case 'remove-day-off': snapshot(); removeDayOff(el.dataset.date); afterChange(); break
    case 'country-toggle': {
      const c = el.dataset.code, list = state.doc.settings.countries
      setCountries(list.includes(c) ? list.filter(x => x !== c) : [...list, c])
      break
    }
    case 'estimate': togglePop(`de-${id}`, () => openEstimate(id)); break
    case 'points': togglePop(`sp-${id}-${el.dataset.person}`, () => openShare(id, el.dataset.person)); break
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
const TEXT_SETTINGS = new Set(['rounding', 'startDate'])

/** The team's countries, the default first. Undoable like any setting. */
function setCountries(list) {
  const next = [...new Set(list)].slice(0, 12)
  if (next.join() === state.doc.settings.countries.join()) return
  snapshot(); setSetting('countries', next); afterChange()
}

function onChange(e) {
  const t = e.target
  if (t.id === 'addCountry') {
    if (t.value) setCountries([...state.doc.settings.countries, t.value])
    t.value = ''
    return
  }
  if (t.id === 'defaultCountry') {
    setCountries([t.value, ...state.doc.settings.countries])
    return
  }
  if (t.dataset.setting) {
    const key = t.dataset.setting
    if (key === 'startDate' && !parseISO(t.value)) { renderAll(); return }   // cleared or half-typed: keep the old date
    const v = TEXT_SETTINGS.has(key) ? t.value : Number(t.value)
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
  const a = analyze(state.doc, cal)
  showToast(`${name} joins with ${a.unit} pts. Drag them onto a deliverable`)
}

function onAddDayOff(e) {
  e.preventDefault()
  const f = e.target, date = f.elements.date.value, label = f.elements.label.value.trim()
  if (!parseISO(date)) { f.elements.date.focus(); return }
  snapshot()
  if (!addDayOff(date, label || 'Team day off')) { showToast('That day is already off'); return }
  afterChange()
  f.reset()
  f.elements.date.focus()
}
