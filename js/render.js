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
import { cal, ensureHolidays, countryName } from './holidays.js'
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
  renderFlags(flags)
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

function term({ value, label, sub = '', cls = '' }) {
  return `<div class="term ${cls}"><div class="term-val">${value}</div><div class="term-lbl">${label}</div>${sub ? `<div class="term-sub">${sub}</div>` : ''}</div>`
}
const op = sym => `<span class="op" aria-hidden="true">${sym}</span>`
const sel = (setting, list, cur, aria, fmt) =>
  `<select class="term-select" data-setting="${setting}" data-key="s-${setting}" aria-label="${aria}">${opts(list, cur, fmt)}</select>`

function renderCalc(a) {
  const s = state.doc.settings
  const presets = horizons(s).map(h =>
    `<button type="button" class="chip-btn" data-action="horizon" data-sprints="${h.sprints}" data-key="h-${h.key}" aria-pressed="${s.sprints === h.sprints}">${h.label} · ${h.sprints}</button>`
  ).join('')
  const capList = [0, ...range(1, Math.max(1, Math.floor(a.derived)))]
  const delta = Math.round(a.unit - a.unitRaw)
  const drift = a.unitRaw ? Math.round((a.unit / a.unitRaw - 1) * 100) : 0

  const parts = [
    term({ value: sel('weeksPerSprint', [1, 2, 3, 4], s.weeksPerSprint, 'Weeks per sprint'), label: s.weeksPerSprint === 1 ? 'week a sprint' : 'weeks a sprint' }),
    op('×'),
    term({
      value: `<span class="term-num">${a.focus}</span>`,
      label: 'focus days a week',
      sub: `${sel('daysPerWeek', [3, 4, 5, 6], s.daysPerWeek, 'Working days per week', v => `${v} days`)}
            <button type="button" class="chip-btn" data-action="toggle-meeting" data-key="meeting" aria-pressed="${s.meetingDay}" title="One day a week goes to meetings and does not count">− 1 meeting day</button>`,
    }),
    op('×'),
    term({ value: sel('pointsPerDay', [0.5, 1, 2], s.pointsPerDay, 'Points per focus day'), label: 'pt a focus day' }),
    op('='),
    term({
      value: `<span class="term-num">${a.sprint}</span>`,
      label: 'pts a sprint',
      sub: `<label class="mini">cap ${sel('sprintCap', capList, s.sprintCap, 'Sprint cap', v => (v ? v : `auto (${a.derived})`))}</label>`,
      cls: 'term--result',
    }),
    op('×'),
    term({ value: sel('sprints', range(1, 13), s.sprints, 'Sprints in this plan'), label: s.sprints === 1 ? 'sprint' : 'sprints', sub: presets }),
    op('−'),
    term({ value: `<span class="term-num">${fmt(a.offPts)}</span>`, label: `pts for ${plural(a.offDays, 'day')} off`,
      sub: `<span class="term-note">${s.countries.length ? `${escHtml(countryName(s.countries[0]))} holidays` : 'no holidays'}, team days</span>` }),
    op('='),
    term({ value: `<span class="term-num">${fmt(a.unitRaw)}</span>`, label: 'raw pts' }),
    op('→'),
    term({
      value: `<span class="term-num">${a.unit}</span>`,
      label: 'planned per engineer',
      sub: sel('rounding', Object.keys(ROUNDING), s.rounding, 'Rounding', v => ROUNDING[v]),
      cls: a.held ? '' : 'term--final',
    }),
    // The buffer comes off after rounding, so 10% of 34 is 31 bookable, not "still 34".
    op('−'),
    term({ value: sel('buffer', [0, 10, 15, 20, 25, 30], s.buffer, 'Buffer held back', v => `${v}%`), label: 'buffer' }),
    ...(a.held ? [op('='), term({ value: `<span class="term-num">${a.bookable}</span>`, label: 'bookable per engineer', cls: 'term--final' })] : []),
  ]
  // An operator travels with the term after it, so a wrapped line never ends on "×".
  let html = parts[0]
  for (let i = 1; i < parts.length; i += 2) html += `<span class="chain-pair">${parts[i]}${parts[i + 1]}</span>`
  $('calcChain').innerHTML = html

  $('calcLead').innerHTML = delta
    ? `Change any term and every share, card and flag below follows. Rounding ${delta > 0 ? 'adds' : 'takes'} <strong>${Math.abs(delta)}</strong> ${delta > 0 ? 'to' : 'from'} a full-time engineer and scales everyone else by the same ${Math.abs(drift)}%.`
    : 'Change any term and every share, card and flag below follows.'
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
  const sub = lines.join(' · ') || (mp.status === 'ok' ? 'Every sized deliverable is staffed' : 'Nothing sized to staff yet')
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
