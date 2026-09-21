// ── Render: the shell ────────────────────────────────────────
// afterChange() is the one exit of every mutation: save, then repaint every
// region from the document. The regions are cheap to rebuild, so there is no
// diffing; the focused control is found again by its data-key.

import { state, ui, saveState, canUndo, canRedo } from './state.js'
import { analyze, horizons, ROUNDING, asEngineers } from './capacity.js'
import { computeFlags } from './flags.js'
import { renderRoster, renderBoard } from './render-board.js'
import { renderFlags } from './render-flags.js'
import { $, escHtml, plural } from './utils.js'

export function afterChange() {
  saveState()
  renderAll()
}

export function renderAll() {
  const key = document.activeElement?.dataset?.key
  const a = analyze(state.doc)
  const flags = computeFlags(state.doc, a)
  renderCalc(a)
  renderTiles(a)
  renderRoster(a, flags)
  renderBoard(a, flags)
  renderFlags(flags)
  renderChrome()
  if (key) document.querySelector(`[data-key="${CSS.escape(key)}"]`)?.focus({ preventScroll: true })
}

function renderChrome() {
  $('undoBtn').disabled = !canUndo()
  $('redoBtn').disabled = !canRedo()
  const t = $('planTitle')
  if (document.activeElement !== t) t.value = state.doc.title
  document.title = state.doc.title && state.doc.title !== 'Example quarter'
    ? `${state.doc.title} | Reparto`
    : 'Reparto | Sprint Capacity Planner'
}

// ── The formula is the settings panel ────────────────────────
const opts = (list, cur, fmt = v => v) =>
  list.map(v => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${escHtml(fmt(v))}</option>`).join('')

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
  const capList = [0, 3, 5, 8, 13, 21]
  const rounded = a.unit !== Math.round(a.unitRaw)
  const delta = a.unit - Math.round(a.unitRaw)

  $('calcChain').innerHTML = [
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
    term({ value: sel('buffer', [0, 10, 15, 20, 25, 30], s.buffer, 'Buffer held back', v => `${v}%`), label: 'buffer' }),
    op('='),
    term({ value: `<span class="term-num">${fmt(a.unitRaw)}</span>`, label: 'raw pts' }),
    op('→'),
    term({
      value: `<span class="term-num">${a.unit}</span>`,
      label: 'planned per engineer',
      sub: sel('rounding', Object.keys(ROUNDING), s.rounding, 'Rounding', v => ROUNDING[v]),
      cls: 'term--final',
    }),
  ].join('')

  $('calcLead').innerHTML = rounded
    ? `Change any term and every share, card and flag below follows. Rounding ${delta > 0 ? 'adds' : 'takes'} <strong>${Math.abs(delta)}</strong> per full-time engineer.`
    : 'Change any term and every share, card and flag below follows.'
}

const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))

// ── Totals ───────────────────────────────────────────────────
function tile({ label, value, unit = 'pts', sub, status = '', meter = null }) {
  const bar = meter === null ? '' :
    `<div class="tile-meter" role="img" aria-label="${Math.round(meter)}% of capacity booked"><i style="width:${Math.min(100, meter)}%"></i></div>`
  return `<div class="tile${status ? ` tile--${status}` : ''}">
    <div class="tile-label">${label}</div>
    <div class="tile-value"><span class="tile-num">${value}</span> <span class="tile-unit">${unit}</span></div>
    ${bar}
    <div class="tile-sub">${sub}</div>
  </div>`
}

function renderTiles(a) {
  const d = state.doc
  const openN = d.people.filter(p => p.open).length
  const pct = a.capacity ? (a.allocated / a.capacity) * 100 : 0
  const shortOn = [...a.deliverables.values()].filter(x => x.gap > 0).length
  const teamShort = Math.max(0, a.demand - a.capacity)
  $('tiles').innerHTML = [
    tile({
      label: 'Team capacity', value: a.capacity,
      sub: `${plural(d.people.length, 'person', 'people')}${openN ? `, ${a.openCap} on ${plural(openN, 'open role')}` : ''} · ${fmt(a.raw)} raw`,
    }),
    tile({
      label: 'Demand', value: a.demand,
      sub: `${plural(d.deliverables.length, 'deliverable')}${a.unsized ? ` · <span class="warn-text">${a.unsized} unsized</span>` : ''}`,
      status: teamShort ? 'error' : '',
    }),
    tile({
      label: 'Booked', value: a.allocated,
      sub: `${Math.round(pct)}% of capacity · ${a.free} free${a.over ? ` · <span class="error-text">${a.over} over-booked</span>` : ''}`,
      meter: pct,
    }),
    a.shortfall
      ? tile({
          label: 'Missing people', value: a.shortfall, unit: 'pts short',
          sub: `on ${plural(shortOn, 'deliverable')}: about ${asEngineers(a.shortfall, a.unit)} engineers at ${a.unit} pts each`,
          status: 'error',
        })
      : d.deliverables.some(x => x.estimate)
        ? tile({ label: 'Missing people', value: 0, unit: 'pts short', sub: 'Every sized deliverable is staffed', status: 'ok' })
        : tile({ label: 'Missing people', value: 0, unit: 'pts short', sub: 'Nothing sized to staff yet' }),
  ].join('')
}
