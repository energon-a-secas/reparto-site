// ── Person editor ────────────────────────────────────────────
// The modal behind a roster row's pencil: name, role, load, whole sprints
// away, a holiday calendar of their own, vacation periods, how their time is
// split across deliverables, open role. The note under the form recomputes on
// every keystroke from the same personCapacity() the roster uses, so it
// cannot disagree with the row.

import { state, snapshot, commitFrom, person, deliverable, updatePerson, removePerson, assign, setShare, unassign } from './state.js'
import { analyze, personCapacity, capFromRaw, shareKey, plannedSprints, PCT_MIN, PCT_MAX } from './capacity.js'
import { splitExact, windowCap, spanLabel } from './timeline.js'
import { sprintList } from './flags.js'
import { parseISO, addDays, iso, planRange, workdaysIn, daysOffFor } from './calendar.js'
import { cal, countryName, ensureHolidays } from './holidays.js'
import { countryOptions } from './render-calendar.js'
import { afterChange } from './render.js'
import { openModal, closeModal } from './modal.js'
import { $, escHtml, plural, showToast, fmtPct } from './utils.js'

const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

export function bindPersonEditor() {
  const f = $('personEdit')
  f.addEventListener('submit', onSave)
  f.addEventListener('input', paintNote)
  f.addEventListener('change', paintNote)
  f.addEventListener('click', e => {
    if (e.target.closest('[data-action="add-vacation"]')) { addVacationRow(); paintNote(); return }
    const rm = e.target.closest('[data-vac-remove]')
    if (rm) { rm.closest('li').remove(); paintNote(); return }
    const drm = e.target.closest('[data-dist-remove]')
    if (drm) { drm.closest('li').remove(); fillDistAdd(); paintNote(); return }
    if (e.target.closest('[data-dist="even"]')) { splitEvenly(); paintNote() }
  })
  $('distAdd').addEventListener('change', e => {
    const id = e.target.value; e.target.value = ''
    if (!id) return
    const used = distRows().reduce((t, r) => t + r.pct, 0)
    addDistRow(id, Math.max(5, Math.round(100 - used)) || 25)
    fillDistAdd(); paintNote()
    $('distList').lastElementChild?.querySelector('input').focus()
  })
}

// ── How their time is split ──────────────────────────────────
// One row per deliverable they are on, in percent of their capacity. Rows
// remember the value they opened with, so saving an untouched row leaves an
// old fixed-points share alone.
function addDistRow(delivId, pct, initial = null) {
  const d = deliverable(delivId); if (!d) return
  const name = d.name.trim() || 'Untitled deliverable'
  $('distList').insertAdjacentHTML('beforeend', `<li class="dist-row" data-deliv="${delivId}" data-initial="${initial ?? ''}">
    <span class="dist-name" title="${escHtml(name)}">${escHtml(name)}</span>
    <input type="number" class="field field--num" min="${PCT_MIN}" max="${PCT_MAX}" step="any" value="${Math.round(pct * 100) / 100}" aria-label="Percent of their capacity on ${escHtml(name)}">
    <span class="dist-unit">%</span>
    <span class="dist-pts"></span>
    <button type="button" class="icon-btn" data-dist-remove aria-label="Take them off ${escHtml(name)}">${X_ICON}</button>
  </li>`)
}

function distRows() {
  return [...$('distList').querySelectorAll('.dist-row')].map(li => ({
    li, deliv: li.dataset.deliv, pct: Number(li.querySelector('input').value) || 0,
    initial: li.dataset.initial === '' ? null : Number(li.dataset.initial),
  }))
}

/** The deliverables this person is not on yet, for the "Add them to" picker. */
function fillDistAdd() {
  const on = new Set(distRows().map(r => r.deliv))
  const left = state.doc.deliverables.filter(d => !on.has(d.id))
  $('distAdd').innerHTML = `<option value="">${left.length ? 'Add them to…' : 'On every deliverable'}</option>` +
    left.map(d => `<option value="${d.id}">${escHtml(d.name.trim() || 'Untitled deliverable')}</option>`).join('')
  $('distAdd').disabled = !left.length
}

/** 100% shared out in whole numbers, the remainder on the last rows: 33, 33, 34. */
function splitEvenly() {
  const rows = distRows(); if (!rows.length) return
  const base = Math.floor(100 / rows.length), extra = 100 - base * rows.length
  rows.forEach((r, i) => { r.li.querySelector('input').value = base + (i >= rows.length - extra ? 1 : 0) })
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
  f.elements.country.innerHTML = countryOptions(p.country, s.countries.length ? `Team default (${countryName(s.countries[0])})` : 'Team default (none set)', s.countries)
  f.elements.country.value = p.country
  f.elements.open.checked = p.open
  $('vacList').innerHTML = ''
  for (const v of p.vacations) addVacationRow(v)
  $('distList').innerHTML = ''
  const a = analyze(state.doc, cal)
  for (const d of state.doc.deliverables) {
    const sh = a.shares.get(shareKey(d.id, p.id))
    if (sh) addDistRow(d.id, sh.pct, Math.round(sh.pct * 100) / 100)
  }
  fillDistAdd()
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
  // Days the calendar already takes (holidays, team days) are not also vacation days.
  const taken = daysOffFor({ ...fields(), vacations: [] }, state.doc, cal.holidays)
  for (const li of $('vacList').querySelectorAll('.vac-row')) {
    const from = li.querySelector('[name="vfrom"]').value, to = li.querySelector('[name="vto"]').value
    const n = workdaysIn(daysOf({ from, to }).filter(d => !taken.has(d)), s)
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
  // Same factor and buffer as the page (capFromRaw), so the preview is what Save stores.
  const cap = capFromRaw(pc.raw, a)
  const scaled = `scaled like a full-timer (${Math.round(a.unitRaw)} to ${a.unit})${s.buffer ? `, less the ${s.buffer}% buffer` : ''}`
  $('personCapNote').innerHTML = `${escHtml(steps.join(' '))} = <strong>${+pc.raw.toFixed(1)}</strong> raw; ${escHtml(scaled)}: <strong>${cap}</strong> planned.`
  const dup = v.sprintsOff > 0 && pc.lost.vacation > 0
  $('personLeaveWarn').hidden = !dup
  // The split, rounded together exactly as the page rounds it (largest remainder), each share
  // against its deliverable's sprints: 100% of a two-sprint deliverable is two sprints of their points.
  const rows = distRows()
  const perSprint = plannedSprints(pc, a)
  const spans = rows.map(r => a.spans.get(r.deliv) || { a: 0, b: s.sprints - 1, whole: true })
  const caps = spans.map(sp => (sp.whole ? cap : windowCap(perSprint, sp)))
  const pts = splitExact(rows.map((r, i) => (caps[i] * r.pct) / 100))
  rows.forEach((r, i) => { r.li.querySelector('.dist-pts').textContent = `${pts[i]} pts${spans[i].whole ? '' : ` in ${spanLabel(spans[i])}`}` })
  const total = cap ? rows.reduce((t, r, i) => t + (r.pct * caps[i]) / cap, 0) : rows.reduce((t, r) => t + r.pct, 0)
  const used = pts.reduce((t, x) => t + x, 0)
  // The busiest sprints: where the deliverables they are on overlap (a sprint they have no time in holds no work).
  const load = Array.from({ length: s.sprints }, (_, i) => (perSprint[i] > 1e-9 ? rows.reduce((t, r, j) => t + (i >= spans[j].a && i <= spans[j].b ? r.pct : 0), 0) : 0))
  const peak = Math.max(0, ...load)
  // Over by half a point of their time or more, the same line the page draws (analyze's overSprints).
  const hot = load.map((x, i) => (((x - 100) / 100) * perSprint[i] >= 0.5 ? i : -1)).filter(i => i >= 0)
  const partTime = v.load < 100 ? ` (${fmtPct((total * v.load) / 100)} of their week)` : ''
  const over = used > cap || hot.length
  $('distTotal').innerHTML = rows.length
    ? `<span class="dist-meter${over ? ' dist-meter--over' : ''}" aria-hidden="true"><i style="width:${Math.min(100, total)}%"></i></span>
       <span class="${over ? 'error-text' : ''}">${fmtPct(total)} of their ${cap} pts booked${partTime}${used > cap ? `: ${used - cap} pts over` : used < cap ? `, ${cap - used} pts free` : ''}${hot.length ? `. ${fmtPct(peak)} of their time in ${sprintList(hot)}, where their deliverables overlap` : ''}</span>`
    : '<span class="dist-empty">Not on any deliverable yet. Add them to one, or drag them onto a card.</span>'
}

function onSave(e) {
  e.preventDefault()
  const id = $('personEdit').dataset.id
  if (!person(id)) { closeModal('personModal'); return }
  // Apply, then keep an undo step only if something changed (an unchanged Save leaves redo alone).
  const before = JSON.stringify(state.doc)
  updatePerson(id, fields())
  applyDistribution(id)
  commitFrom(before)
  closeModal('personModal')
  afterChange()
}

/** Write the split back: changed rows set, new rows added, missing rows taken off. */
function applyDistribution(pid) {
  const rows = distRows()
  const keep = new Set(rows.map(r => r.deliv))
  for (const d of state.doc.deliverables) if (!keep.has(d.id) && d.members.some(m => m.person === pid)) unassign(d.id, pid)
  for (const r of rows) {
    if (!(r.pct > 0)) { unassign(r.deliv, pid); continue }
    const has = deliverable(r.deliv)?.members.some(m => m.person === pid)
    if (!has) assign(r.deliv, pid, r.pct)
    else if (r.initial === null || Math.abs(r.pct - r.initial) >= 0.005) setShare(r.deliv, pid, r.pct)
  }
}

export function removeEditedPerson() {
  const pid = $('personEdit').dataset.id, p = person(pid); if (!p) return
  closeModal('personModal')
  snapshot(); removePerson(pid); afterChange()
  showToast(`${p.name || 'Person'} removed with their shares. Ctrl+Z brings them back`)
}

