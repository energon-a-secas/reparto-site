// ── Person editor ────────────────────────────────────────────
// The modal behind a roster row's pencil: name, role, load, whole sprints
// away, a holiday calendar of their own, vacation periods, open role. The
// note under the form recomputes on every keystroke from the same
// personCapacity() the roster uses, so it cannot disagree with the row.

import { state, snapshot, person, updatePerson, removePerson } from './state.js'
import { analyze, personCapacity, roundFib } from './capacity.js'
import { parseISO, addDays, iso, planRange, workdaysIn } from './calendar.js'
import { cal, countryName, ensureHolidays } from './holidays.js'
import { countryOptions } from './render-calendar.js'
import { afterChange } from './render.js'
import { openModal, closeModal } from './modal.js'
import { $, escHtml, plural, showToast } from './utils.js'

const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

export function bindPersonEditor() {
  const f = $('personEdit')
  f.addEventListener('submit', onSave)
  f.addEventListener('input', paintNote)
  f.addEventListener('change', paintNote)
  f.addEventListener('click', e => {
    if (e.target.closest('[data-action="add-vacation"]')) { addVacationRow(); paintNote(); return }
    const rm = e.target.closest('[data-vac-remove]')
    if (rm) { rm.closest('li').remove(); paintNote() }
  })
}

export function openPerson(id) {
  const p = person(id); if (!p) return
  const f = $('personEdit')
  const s = state.doc.settings
  f.dataset.id = id
  f.elements.name.value = p.name
  f.elements.role.value = p.role
  f.elements.sprintsOff.innerHTML = Array.from({ length: s.sprints + 1 }, (_, i) =>
    `<option value="${i}">${i === 0 ? 'None' : plural(i, 'sprint')}</option>`).join('')
  f.elements.sprintsOff.value = String(Math.min(p.sprintsOff, s.sprints))
  const load = f.elements.load
  if (![...load.options].some(o => Number(o.value) === p.load)) load.insertAdjacentHTML('beforeend', `<option value="${p.load}">${p.load}%</option>`)
  load.value = String(p.load)
  f.elements.country.innerHTML = countryOptions(p.country, s.country ? `Team calendar (${countryName(s.country)})` : 'Team calendar (none set)')
  f.elements.country.value = p.country
  f.elements.open.checked = p.open
  $('vacList').innerHTML = ''
  for (const v of p.vacations) addVacationRow(v)
  $('personModalTitle').textContent = p.name ? `Edit ${p.name}` : 'Edit person'
  paintNote()
  openModal('personModal')
}

/** A new period starts the day after the last one ends (or on plan day one), Monday to Friday. */
function addVacationRow(v) {
  const list = $('vacList')
  if (!v) {
    const last = [...list.querySelectorAll('[name="vto"]')].map(i => i.value).filter(Boolean).sort().pop()
    const from = last ? addDays(parseISO(last), 1) : parseISO(state.doc.settings.startDate) || new Date()
    v = { from: iso(from), to: iso(addDays(from, 4)) }
  }
  list.insertAdjacentHTML('beforeend', `<li class="vac-row">
    <input type="date" class="field field--date" name="vfrom" value="${v.from}" aria-label="First day away" required>
    <span class="vac-to">to</span>
    <input type="date" class="field field--date" name="vto" value="${v.to}" aria-label="Last day away" required>
    <span class="vac-days" aria-live="polite"></span>
    <button type="button" class="icon-btn" data-vac-remove aria-label="Remove this vacation">${X_ICON}</button>
  </li>`)
  list.lastElementChild.querySelector('input').focus()
}

function vacations() {
  return [...$('vacList').querySelectorAll('.vac-row')].map(li => ({
    from: li.querySelector('[name="vfrom"]').value,
    to: li.querySelector('[name="vto"]').value,
  })).filter(v => v.from || v.to)
}

function fields() {
  const f = $('personEdit')
  return {
    name: f.elements.name.value.trim().slice(0, 80),
    role: f.elements.role.value.trim().slice(0, 80),
    load: Number(f.elements.load.value),
    sprintsOff: Number(f.elements.sprintsOff.value),
    country: f.elements.country.value,
    open: f.elements.open.checked,
    vacations: vacations(),
  }
}

/** Every day of a period, as ISO strings, for counting the working ones. */
function daysOf(v) {
  const a = parseISO(v.from), b = parseISO(v.to)
  if (!a || !b) return []
  const out = []
  for (let d = a <= b ? a : b; d <= (a <= b ? b : a) && out.length < 400; d = addDays(d, 1)) out.push(iso(d))
  return out
}

function paintNote() {
  const s = state.doc.settings, v = fields()
  const range = planRange(s)
  for (const li of $('vacList').querySelectorAll('.vac-row')) {
    const from = li.querySelector('[name="vfrom"]').value, to = li.querySelector('[name="vto"]').value
    const n = workdaysIn(daysOf({ from, to }), s)
    const outside = range && from && to && (parseISO(to) < range.from || parseISO(from) >= range.to)
    li.querySelector('.vac-days').textContent = outside ? 'outside the plan' : plural(n, 'working day')
  }
  if (v.country) ensureHolidays([v.country])     // a new country's calendar repaints the page when it lands
  const a = analyze(state.doc, cal)
  const pc = personCapacity(v, state.doc, cal)
  const { holiday, team, vacation } = pc.lost
  const why = [holiday && plural(holiday, 'holiday'), team && plural(team, 'team day'), vacation && plural(vacation, 'vacation day')].filter(Boolean)
  const steps = [`${a.base} pts over ${plural(s.sprints, 'sprint')}`]
  if (why.length) steps.push(`− ${a.base - pc.total} for ${why.join(', ')}`)
  if (pc.away) steps.push(`× ${s.sprints - pc.away} of ${s.sprints} sprints`)
  if (v.load < 100) steps.push(`× ${v.load}%`)
  if (s.buffer) steps.push(`− ${s.buffer}% buffer`)
  $('personCapNote').innerHTML = `${escHtml(steps.join(' '))} = <strong>${+pc.raw.toFixed(1)}</strong>, planned as <strong>${roundFib(pc.raw, s.rounding)}</strong>.`
}

function onSave(e) {
  e.preventDefault()
  const id = $('personEdit').dataset.id
  if (!person(id)) { closeModal('personModal'); return }
  snapshot(); updatePerson(id, fields())
  closeModal('personModal')
  afterChange()
}

export function removeEditedPerson() {
  const pid = $('personEdit').dataset.id, p = person(pid); if (!p) return
  closeModal('personModal')
  snapshot(); removePerson(pid); afterChange()
  showToast(`${p.name || 'Person'} removed with their shares. Ctrl+Z brings them back`)
}

