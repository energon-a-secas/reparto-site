// ── Render: the shell ────────────────────────────────────────
// afterChange() is the one exit of every mutation: save, then repaint every
// region from the document. The regions are cheap to rebuild, so there is no
// diffing; the focused control is found again by its data-key.

import { state, ui, canUndo, canRedo } from './state.js'
import { saveState, previousPlans, listPlans } from './plans.js'
import { analyze, horizons, ROUNDING } from './capacity.js'
import { computeFlags, missingPeople, engineers } from './flags.js'
import { renderRoster, renderBoard } from './render-board.js'
import { renderFlags } from './render-flags.js'
import { renderCalendar } from './render-calendar.js'
import { cal, ensureHolidays } from './holidays.js'
import { icon } from './icons.js'
import { $, escHtml, plural, showToast } from './utils.js'

let warnedFull = false
export function afterChange() {
  // A refused write loses the edit on reload: say so once, with the way out.
  const saved = saveState()
  if (!saved && !warnedFull) setTimeout(() => showToast('This browser would not save the plan (storage full or blocked). Export it as JSON, or delete an old plan'), 0)
  warnedFull = !saved
  renderAll()
}

export function renderAll() {
  const key = document.activeElement?.dataset?.key
  // A control with no key inside a card or row (a drop button, a chip's x) is gone after the repaint:
  // keep the keyboard on that deliverable instead of dropping it to <body>.
  const inCard = !key && document.activeElement?.closest?.('[data-deliv]')?.dataset.deliv
  const a = analyze(state.doc, cal)
  ensureHolidays(a.calendar.needed)       // a calendar that arrives later repaints through onHolidays()
  const flags = computeFlags(state.doc, a)
  renderCalc(a)
  renderCalendar(a, cal)
  renderTiles(a)
  renderRoster(a, flags)
  renderBoard(a, flags)
  renderFlags(flags, a)
  renderChrome()
  if (key) document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
  else if (inCard && document.activeElement === document.body) document.querySelector(`[data-key="de-${CSS.escape(inCard)}"]`)?.focus({ preventScroll: true })
}

const ORIGIN = { link: 'from a link', import: 'imported', example: 'the example', copy: 'a copy', restored: 'restored', blank: '' }

function renderChrome() {
  $('firstRun').hidden = !ui.firstRun
  $('previousItem').hidden = !previousPlans().length
  // The plan switcher: every plan in this browser, the open one checked.
  const plans = listPlans()
  $('planList').innerHTML = plans.map(p => `<button type="button" role="menuitemradio" aria-checked="${p.id === state.planId}" data-action="switch-plan" data-id="${escHtml(p.id)}">
      <span class="plan-item"><strong>${escHtml(p.title)}</strong><small>${plural(p.people, 'person', 'people')} · ${plural(p.deliverables, 'deliverable')}${ORIGIN[p.origin] ? ` · ${ORIGIN[p.origin]}` : ''}${p.unsaved ? ' · not saved yet' : ''}</small></span>
      ${p.id === state.planId ? icon('check', { cls: 'plan-check' }) : ''}</button>`).join('')
  $('plansBtn').title = `Plans: ${state.doc.title} (${plural(plans.length, 'plan')} in this browser)`
  const d = state.doc
  $('wipeBtn').disabled = !(d.people.length || d.deliverables.length || d.backlog.length || d.daysOff.length)
  $('undoBtn').disabled = !canUndo()
  $('redoBtn').disabled = !canRedo()
  const t = $('planTitle')
  if (document.activeElement !== t) t.value = state.doc.title
  document.title = state.doc.title && state.doc.title !== 'Example quarter'
    ? `${state.doc.title} | Reparto`
    : 'Reparto | Sprint Capacity Planner'
}

// ── The formula is the settings panel ────────────────────────
/** Options for a formula select. A value the list does not offer (an import, a share link) is added in order, so the select shows what the maths uses. */
function opts(list, cur, fmt = v => v) {
  const all = list.some(v => String(v) === String(cur)) || cur === undefined || cur === '' ? list
    : [...list, cur].sort((x, y) => (typeof x === 'number' && typeof y === 'number' ? x - y : 0))
  return all.map(v => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${escHtml(fmt(v))}</option>`).join('')
}

const range = (lo, hi) => Array.from({ length: hi - lo + 1 }, (_, i) => lo + i)

const sel = (setting, list, cur, aria, format) =>
  `<select class="field" data-setting="${setting}" data-key="s-${setting}" aria-label="${aria}">${opts(list, cur, format)}</select>`
const rule = (label, control, hint = '') => `<label class="rule-field"><span>${label}</span>${control}${hint ? `<small>${hint}</small>` : ''}</label>`

// Compare the actual calculation, not the render: filtering or opening a
// dialog should never replay the feedback, nor should switching plans.
let previousCapacity = null
function capacityMath(a) {
  const s = state.doc.settings
  const steps = [
    { key: 'sprint', label: 'Points per sprint', value: a.sprint, detail: `${plural(s.sprints, 'sprint')} in this plan` },
    { key: 'calendar', label: 'Calendar deduction', value: a.offPts, detail: `${plural(a.offDays, 'day')} off` },
    { key: 'raw', label: 'Before rounding', value: a.unitRaw, detail: 'After calendar adjustments' },
    { key: 'available', label: 'Available per engineer', value: a.bookable, detail: `${s.buffer}% buffer held back` },
  ]
  const samePlan = previousCapacity?.planId === state.planId
  const visible = $('capacityRules').open
  const changes = []
  const html = steps.map((step, i) => {
    const old = samePlan ? previousCapacity.values[i] : step.value
    const change = Number((step.value - old).toFixed(1))
    const changed = visible && change !== 0
    if (changed) changes.push(`${step.label}: ${fmt(step.value)} points`)
    return `<div class="capacity-step${i === 3 ? ' capacity-step--result' : ''}${changed ? ' is-updated' : ''}" data-capacity="${step.key}" data-value="${step.value}" style="--calc-delay:${i * 40}ms;--calc-travel:${change < 0 ? '-0.6em' : '0.6em'}">
      <dt>${step.label}</dt>
      <dd class="capacity-value"><span class="capacity-number"><span class="capacity-current">${fmt(step.value)}</span>${changed ? `<span class="capacity-previous" aria-hidden="true">${fmt(old)}</span>` : ''}</span><small>pts</small>${changed ? `<span class="capacity-delta" aria-hidden="true">${change > 0 ? '+' : '−'}${fmt(Math.abs(change))}</span>` : ''}</dd>
      <dd class="capacity-detail">${step.detail}</dd>
    </div>`
  }).join('')
  previousCapacity = { planId: state.planId, values: steps.map(step => step.value) }
  if (changes.length) $('capacityUpdate').textContent = `Capacity updated. ${changes.join('. ')}.`
  else if (!samePlan) $('capacityUpdate').textContent = ''
  return `<dl class="capacity-math" aria-label="Capacity calculation for one engineer">${html}</dl>`
}

function renderCalc(a) {
  const s = state.doc.settings
  $('capacityOverview').innerHTML = `<strong>${a.bookable} pts per engineer</strong><span>${plural(s.sprints, 'sprint')} × ${plural(s.weeksPerSprint, 'week')}</span><span>${s.buffer}% buffer</span>`
  const presets = horizons(s).map(h =>
    `<button type="button" class="chip-btn" data-action="horizon" data-sprints="${h.sprints}" data-key="h-${h.key}" aria-pressed="${s.sprints === h.sprints}">${h.label} · ${h.sprints}</button>`
  ).join('')
  const capList = [0, ...range(1, Math.max(1, Math.floor(a.derived)))]
  const delta = Math.round(a.unit - a.unitRaw)
  const drift = a.unitRaw ? Math.round((a.unit / a.unitRaw - 1) * 100) : 0
  $('calcChain').innerHTML = `
    <div class="rule-groups">
      <fieldset class="rule-group"><legend>Sprint rhythm</legend>
        ${rule('Weeks per sprint', sel('weeksPerSprint', [1, 2, 3, 4], s.weeksPerSprint, 'Weeks per sprint', v => plural(v, 'week')))}
        ${rule('Working days per week', sel('daysPerWeek', [3, 4, 5, 6], s.daysPerWeek, 'Working days per week', v => plural(v, 'day')))}
        <div class="rule-field"><span>Meetings & ceremonies</span><button type="button" class="meeting-toggle" data-action="toggle-meeting" data-key="meeting" aria-pressed="${s.meetingDay}">${icon(s.meetingDay ? 'check' : 'plus', { size: 15 })}<span>${s.meetingDay ? '1 day reserved each week' : 'No meeting day reserved'}</span></button><small>${a.focus} focus days available each week</small></div>
      </fieldset>
      <fieldset class="rule-group"><legend>Planning horizon</legend>
        ${rule('Sprints in this plan', sel('sprints', range(1, 13), s.sprints, 'Sprints in this plan', v => plural(v, 'sprint')))}
        <div class="rule-presets" role="group" aria-label="Planning presets">${presets}</div>
        ${rule('Points per focus day', sel('pointsPerDay', [0.5, 1, 2], s.pointsPerDay, 'Points per focus day', v => `${v} ${v === 1 ? 'point' : 'points'}`))}
      </fieldset>
      <fieldset class="rule-group"><legend>Capacity policy</legend>
        ${rule('Sprint cap', sel('sprintCap', capList, s.sprintCap, 'Sprint cap', v => v ? `${v} points` : `Automatic (${a.derived} points)`))}
        ${rule('Rounding', sel('rounding', Object.keys(ROUNDING), s.rounding, 'Rounding', v => ROUNDING[v]))}
        ${rule('Buffer for unplanned work', sel('buffer', [0, 10, 15, 20, 25, 30], s.buffer, 'Buffer held back', v => `${v}% held back`))}
      </fieldset>
    </div>
    ${capacityMath(a)}`
  $('calcLead').innerHTML = delta
    ? `Rounding ${delta > 0 ? 'adds' : 'takes'} <strong>${Math.abs(delta)} points</strong> ${delta > 0 ? 'to' : 'from'} a full-time engineer and scales everyone else by ${Math.abs(drift)}%. Buffer is applied after rounding. Changes update the whole plan.`
    : 'Buffer is applied after rounding. Changes update the whole plan.'
}

const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))

// ── Totals ───────────────────────────────────────────────────
function tile({ label, value, unit = 'pts', sub, status = '', meter = null, ico = '' }) {
  const bar = meter === null ? '' :
    `<div class="tile-meter" role="img" aria-label="${Math.round(meter)}% of capacity booked"><i style="width:${Math.min(100, meter)}%"></i></div>`
  return `<div class="tile${status ? ` tile--${status}` : ''}">
    <div class="tile-label">${ico ? icon(ico, { size: 14 }) : ''}${label}</div>
    <div class="tile-value"><span class="tile-num">${value}</span> <span class="tile-unit">${unit}</span></div>
    ${bar}
    <div class="tile-sub">${sub}</div>
  </div>`
}

/** The hiring gap, and what explains it: open roles, unstaffed work, over-booked people. */
function missingTile(mp, bookable) {
  const lines = []
  if (mp.points) lines.push(engineers(mp.points, bookable))
  if (mp.points && mp.onOpen) lines.push(`${mp.onOpen} covered by open roles${mp.points > mp.onOpen ? `, ${mp.points - mp.onOpen} beyond them` : ''}`)
  if (mp.unstaffed) lines.push(`${mp.unstaffed} unstaffed on ${plural(mp.unstaffedOn, 'deliverable')}${mp.freeHired.length ? `: ${mp.freeHired.map(x => `${escHtml(x.name)} ${x.free}`).join(', ')} free` : ''}`)
  if (mp.overPeople.length) lines.push(`<span class="error-text">${mp.overPeople.map(x => `${escHtml(x.name)} ${x.over} over`).join(', ')}</span>`)
  const expanded = $('staffingDetails')?.open
  const summary = mp.points ? engineers(mp.points, bookable)
    : mp.status === 'ok' ? 'Every sized deliverable is staffed'
    : mp.unstaffed ? `${mp.unstaffed} pts still need assigning`
    : mp.overPeople.length ? 'Rebalance over-booked people' : 'Nothing sized to staff yet'
  const sub = `${summary}${lines.length ? `<details class="staffing-details" id="staffingDetails"${expanded ? ' open' : ''}><summary data-key="staffing-details">Staffing breakdown</summary><ul>${lines.map(line => `<li>${line}</li>`).join('')}</ul></details>` : ''}`
  return tile({ label: 'Missing people', value: mp.points, unit: 'pts short', sub, status: mp.status === 'none' ? '' : mp.status, ico: 'user-plus' })
}

function renderTiles(a) {
  const d = state.doc
  const openN = d.people.filter(p => p.open).length
  const pct = a.capacity ? (a.allocated / a.capacity) * 100 : 0
  const teamShort = Math.max(0, a.demand - a.capacity)
  const later = d.backlog.filter(x => x.when === 'later').length
  $('tiles').innerHTML = [
    tile({
      label: 'Team capacity', value: a.capacity, ico: 'users',
      sub: `${plural(d.people.length, 'person', 'people')}${openN ? `, ${a.openCap} on ${plural(openN, 'open role')}` : ''} · ${fmt(a.raw)} raw`,
    }),
    tile({
      label: 'Demand', value: a.demand, ico: 'target',
      sub: `${plural(d.deliverables.length, 'deliverable')}${a.unsized ? ` · <span class="warn-text">${a.unsized} unsized</span>` : ''}${later ? ` · ${later} later, not counted` : ''}`,
      status: teamShort ? 'error' : '',
    }),
    tile({
      label: 'Booked', value: a.allocated, ico: 'calendar-check',
      sub: `${Math.round(pct)}% of capacity · ${a.free} free${a.over ? ` · <span class="error-text">${a.over} over-booked</span>` : ''}`,
      meter: pct,
    }),
    missingTile(missingPeople(d, a), a.bookable),
  ].join('')
}
