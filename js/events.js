// ── Events ───────────────────────────────────────────────────
// One delegated click handler (data-action), one change handler (settings
// and inline names), one keydown handler. No inline onclick anywhere.

import {
  state, ui, snapshot, undo, redo, setSetting, deliverable, findDeliverable, person,
  addPerson, addDeliverable, addBacklogItem, updateDeliverable, addDayOff, removeDayOff, setWorked, wipe,
} from './state.js'
import {
  saveState, switchPlan, newBlankPlan, openExample, duplicatePlan, deletePlan, previousPlans, previousKey, keepPrevious, restorePrevious, listPlans, isBlankPlan,
} from './plans.js'
import { analyze } from './capacity.js'
import { parseISO } from './calendar.js'
import { cal, taggedHolidays, countryName } from './holidays.js'
import { bindPersonEditor, openPerson, removeEditedPerson } from './person-editor.js'
import { afterChange, renderAll } from './render.js'
import { bindDnd, justDragged } from './dnd.js'
import { pickUp, putDown, cancelCarry, applyFix, show, moveTo, removeDeliverablePinned, unassignPinned } from './actions.js'
import { openEstimate, openShare, openCardMenu, closePop, popAnchor, repositionPop } from './popover.js'
import { openModal, closeModal, modalKeydown, modalClick } from './modal.js'
import { askConfirm, bindConfirm } from './confirm.js'
import { runExport, importFile } from './io.js'
import { openExport, bindExportDialog } from './export-dialog.js'
import { icon } from './icons.js'
import { $, showToast, escHtml, plural } from './utils.js'

export function bindEvents() {
  // Static icons: <span data-icon="name"> in the page shell becomes the SVG.
  document.querySelectorAll('[data-icon]').forEach(el => { el.outerHTML = icon(el.dataset.icon) })
  bindDnd()
  setupMenu('plansBtn', 'plansMenu')
  setupMenu('exportBtn', 'exportMenu')
  document.addEventListener('click', onClick)
  document.addEventListener('change', onChange)
  document.addEventListener('keydown', onKey)
  document.addEventListener('scroll', repositionPop, { capture: true, passive: true })
  window.addEventListener('resize', repositionPop)
  $('personForm').addEventListener('submit', onAddPerson)
  $('dayOffForm').addEventListener('submit', onAddDayOff)
  bindPersonEditor()
  bindExportDialog()
  bindConfirm()
  $('importFile').addEventListener('change', e => { const f = e.target.files[0]; if (f) importFile(f); e.target.value = '' })
}

// ── Menus (.header-menu opened here, so their keys are handled here too) ──
// Each closes only itself and its sibling: the header kit's own overflow
// panel is also a .header-menu, and closing every open one shut the panel
// a menu lives in on phones.
const menus = []
function setupMenu(btnId, menuId) {
  const btn = $(btnId), menu = $(menuId)
  const items = () => [...menu.querySelectorAll('[role="menuitem"], [role="menuitemradio"]')].filter(el => !el.hidden)
  const close = (focusBtn = false) => {
    if (!menu.classList.contains('open')) return
    menu.classList.remove('open'); btn.setAttribute('aria-expanded', 'false')
    if (focusBtn) btn.focus()
  }
  menus.push(close)
  // No stopPropagation here: the kit's own outside-click closer must see this click to shut its
  // ⋯ panel. Ours listens in the capture phase, because the kit's ⋯ toggle stops its click.
  btn.addEventListener('click', () => {
    const open = !menu.classList.contains('open')
    menus.forEach(c => c())
    menu.classList.toggle('open', open)
    btn.setAttribute('aria-expanded', String(open))
    if (open) (menu.querySelector('[aria-checked="true"]') || items()[0])?.focus()
  })
  document.addEventListener('click', e => { if (!menu.contains(e.target) && !btn.contains(e.target)) close() }, true)
  // Focus goes back to the button before the item's action runs: a dialog it opens returns there,
  // and an action that removes nothing from view leaves the keyboard where it was.
  menu.addEventListener('click', e => { if (e.target.closest('[role="menuitem"], [role="menuitemradio"]')) close(true) })
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
  if (!pop.hidden && !pop.contains(t) && !t.closest('[data-action="estimate"], [data-action="points"], [data-action="card-menu"]')) closePop({ restore: false })
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

/** After a plan switch or a new plan: repaint from the top, nothing carried over. */
function opened(message) {
  closePop({ restore: false })
  afterChange()
  window.scrollTo({ top: 0, behavior: 'smooth' })
  if (message) showToast(message)
}

function runAction(action, el = null) {
  const id = el?.dataset.id
  switch (action) {
    case 'undo': case 'redo': {
      if (!(action === 'undo' ? undo() : redo())) break
      ui.carry = null          // a carried share may not exist in the plan it came back to
      closePop({ restore: false }); afterChange()
      // The button pressed may now be disabled, and a disabled button drops focus: move to its twin, else the title.
      if (el && el.disabled) ($(action === 'undo' ? 'redoBtn' : 'undoBtn').disabled ? $('planTitle') : $(action === 'undo' ? 'redoBtn' : 'undoBtn')).focus()
      break
    }

    // Plans
    case 'switch-plan':
      if (switchPlan(id)) opened(`Opened ${state.doc.title}`)
      break
    case 'example': {
      const r = openExample()
      opened(r.existing ? 'Opened the example you already had' : 'Example opened as a plan of its own. Yours are under Plans')
      break
    }
    case 'blank':
      newBlankPlan()
      opened('New plan. Pick the team\'s countries, then add people and deliverables')
      $('cal').open = true            // a blank plan's first question is whose holidays count
      $('personName').focus()
      break
    case 'duplicate': {
      const r = duplicatePlan()
      opened(r.existing ? `An identical copy was already here: you are now in ${state.doc.title}` : `Duplicated: you are now in ${state.doc.title}`)
      break
    }
    case 'delete-plan': {
      const d = state.doc, others = listPlans().length - 1
      askConfirm({
        title: `Delete ${d.title}?`,
        body: `It holds ${plural(d.people.length, 'person', 'people')} and ${plural(d.deliverables.length, 'deliverable')}. ${others ? 'Your most recent other plan opens next.' : 'A blank plan opens next.'}`,
        safe: isBlankPlan(d) ? '' : 'A copy is kept under Plans > Restore a deleted plan.',
        confirm: 'Delete plan',
      }, () => {
        const title = d.title, kept = !isBlankPlan(d)
        if (deletePlan() === 'no-copy') {
          // Storage refused the copy: say so, and delete only when asked again.
          askConfirm({
            title: `Delete ${title} without a copy?`,
            body: 'This browser would not store a copy (storage full or blocked), so a delete now cannot be restored.',
            safe: 'Export it as JSON first (Export > Plan file) if you might want it back.',
            confirm: 'Delete without a copy',
          }, () => { deletePlan(undefined, { withoutCopy: true }); opened(`Deleted ${title}`) })
          return
        }
        opened(kept ? `Deleted ${title}. Plans > Restore a deleted plan brings it back` : `Deleted ${title}`)
      })
      break
    }
    case 'wipe': {
      const d = state.doc
      const what = [plural(d.people.length, 'person', 'people'), plural(d.deliverables.length, 'deliverable'),
        d.backlog.length && `${d.backlog.length} in Later and Done`, d.daysOff.length && plural(d.daysOff.length, 'team day') + ' off'].filter(Boolean).join(', ')
      askConfirm({
        title: `Wipe ${d.title}?`,
        body: `Removes ${what}. The plan's name, dates, countries and sprint rules stay.`,
        check: 'Also reset the dates, countries and sprint rules',
        safe: `Ctrl+Z brings it all back${isBlankPlan(d) ? '' : ', and a copy is kept under Plans > Restore a deleted plan'}.`,
        confirm: 'Wipe plan',
      }, settings => {
        const kept = !isBlankPlan(state.doc) && keepPrevious(state.doc, 'wiped')
        snapshot(); wipe({ settings }); ui.firstRun = false; ui.scope = 'plan'; ui.carry = null
        afterChange()
        showToast(`Wiped. Ctrl+Z brings it back${kept ? ', and a copy is under Plans > Restore a deleted plan' : ''}`)
        // Focus stays where the dialog returns it: in the name field, Ctrl+Z would undo typing, not the wipe.
      })
      break
    }
    case 'dismiss-intro': ui.firstRun = false; saveState(); renderAll(); break
    case 'previous': openPrevious(); break
    case 'restore-previous': {
      closeModal('previousModal')
      const r = restorePrevious(el.dataset.prev)
      if (!r) { showToast('That plan is no longer in the list: another tab restored it'); break }
      opened(r.existing ? `${r.title} was already here, so it is open now` : `Restored ${r.title} as a plan of its own`)
      break
    }
    case 'import': $('importFile').click(); break
    case 'help': openModal('helpModal'); break
    case 'export': openExport(el.dataset.table); break

    // The board: which deliverables, which view, which order
    case 'scope': ui.scope = el.dataset.scope; ui.carry = null; renderAll(); break
    case 'view':
      ui.view = el.dataset.view
      try { localStorage.setItem('reparto-v1-view', ui.view) } catch { /* a convenience only */ }
      renderAll()
      break
    case 'sort': {
      const k = el.dataset.sort
      ui.sort = ui.sort.key === k ? (ui.sort.dir === 1 ? { key: k, dir: -1 } : { key: '', dir: 1 }) : { key: k, dir: 1 }
      renderAll()
      $('boardTable').querySelector(`[data-sort="${k}"]`)?.focus()
      break
    }
    case 'add-deliverable': {
      snapshot()
      const d = ui.scope === 'plan' ? addDeliverable() : addBacklogItem(ui.scope)
      afterChange()
      const input = document.querySelector(`[data-key="dn-${d.id}"]`)
      input?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); input?.focus({ preventScroll: true })
      break
    }
    case 'card-menu': togglePop(`dm-${id}`, () => openCardMenu(id)); break
    case 'move-deliverable': moveTo(id, el.dataset.when); break
    case 'remove-deliverable': {
      const d = findDeliverable(id); if (!d) break
      removeDeliverablePinned(id)
      showToast(`Removed ${d.name || 'the deliverable'}. Ctrl+Z brings it back`)
      break
    }

    case 'edit-person': openPerson(id); break
    case 'remove-person': removeEditedPerson(); break
    case 'remove-day-off': keepChipFocus(el, () => { snapshot(); removeDayOff(el.dataset.date, el.dataset.code || ''); afterChange() }); break
    case 'work-holiday': keepChipFocus(el, () => { snapshot(); setWorked(el.dataset.code, el.dataset.date, true); afterChange() }); break
    case 'unwork-holiday': keepChipFocus(el, () => { snapshot(); setWorked(el.dataset.code, el.dataset.date, false); afterChange() }); break
    case 'work-tagged': {
      // Every day of one kind (often worked, bridge days) in one country's plan, in one undo step.
      const c = el.dataset.code, days = taggedHolidays(state.doc, c, el.dataset.tag)
      if (!days.length) break
      keepChipFocus(el, () => { snapshot(); for (const d of days) setWorked(c, d, true); afterChange() })
      showToast(`${plural(days.length, 'day')} in ${countryName(c)} now count as working days`)
      break
    }
    case 'country-toggle': {
      const c = el.dataset.code, list = state.doc.settings.countries
      setCountries(list.includes(c) ? list.filter(x => x !== c) : [...list, c])
      break
    }
    case 'estimate': togglePop(`de-${id}`, () => openEstimate(id)); break
    case 'points': togglePop(`sp-${id}-${el.dataset.person}`, () => openShare(id, el.dataset.person)); break
    case 'unassign': {
      const p = person(el.dataset.person), d = deliverable(id)
      if (unassignPinned(id, el.dataset.person)) showToast(`${p?.name || 'Person'} taken off ${d?.name || 'the deliverable'}`)
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

/**
 * A calendar chip's button rebuilds the chip list: keep the keyboard in it,
 * on the button now at the same place, else the add-a-day-off date.
 */
function keepChipFocus(el, run) {
  const all = () => [...document.querySelectorAll('#dayChips button')]
  const at = all().indexOf(el)
  run()
  if (at < 0) return
  const list = all()
  ;(list[Math.min(at, list.length - 1)] || $('dayOffForm').elements.date).focus({ preventScroll: true })
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
    const d = findDeliverable(t.dataset.id)
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
  const typing = !!t.matches?.('input, textarea, select')      // a key sent to the document itself has no matches()
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
  if ((e.key === 'Enter' || e.key === ' ') && t.matches?.('[data-drag="person"]')) {
    e.preventDefault()
    pickUp(t.dataset.person, t.dataset.from || null)
  }
}

// ── People: add, edit ────────────────────────────────────────
function onAddPerson(e) {
  e.preventDefault()
  const name = $('personName').value.trim(), role = $('personRole').value.trim()
  if (!name) { $('personName').focus(); showToast('Give the person a name first'); return }
  snapshot(); const added = addPerson({ name: name.slice(0, 80), role: role.slice(0, 80) }); afterChange()
  $('personName').value = ''; $('personRole').value = ''
  $('personName').focus()
  const a = analyze(state.doc, cal)
  showToast(`${name} joins with ${a.people.get(added.id)?.cap ?? a.bookable} pts. Drag them onto a deliverable`)
}

function onAddDayOff(e) {
  e.preventDefault()
  const f = e.target, date = f.elements.date.value, label = f.elements.label.value.trim(), country = f.elements.country.value
  if (!parseISO(date)) { f.elements.date.focus(); return }
  if (state.doc.daysOff.some(x => x.date === date && (x.country || '') === country)) { showToast('That day is already off'); return }
  snapshot()
  addDayOff(date, label || 'Team day off', country)
  afterChange()
  f.reset()
  f.elements.date.focus()
}

// ── Deleted and wiped plans ──────────────────────────────────
function openPrevious() {
  const list = previousPlans()
  const when = t => { try { return new Date(t).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) } catch { return '' } }
  const why = { deleted: 'deleted', wiped: 'wiped' }
  $('previousList').innerHTML = list.length
    ? list.map(e => `<li><button type="button" class="previous-btn" data-action="restore-previous" data-prev="${escHtml(previousKey(e))}">
        <strong>${escHtml(e.doc.title || 'Untitled plan')}</strong>
        <span>${plural(e.doc.people.length, 'person', 'people')}, ${plural(e.doc.deliverables.length, 'deliverable')} · ${why[e.why] || 'replaced'} ${escHtml(when(e.savedAt))}</span></button></li>`).join('')
    : '<li class="form-note">Nothing kept yet.</li>'
  openModal('previousModal')
}
