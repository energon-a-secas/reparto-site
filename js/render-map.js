// ── Render: the map ──────────────────────────────────────────
// The plan on its dates: the quarter and its months across the top, then
// the sprints with the team's points in each, one row per person (holidays,
// team days off, vacations, and how full each of their sprints is) and one
// row per deliverable (a bar over its sprints, and a diamond where it
// lands). The map runs past the plan's end when something lands after it,
// so a late date is in sight rather than cut off. Editing lives in
// map-edit.js; every mark here is a button or has a text equivalent.

import { state, ui } from './state.js'
import { deliverableStatus, landingText, sprintList } from './flags.js'
import { planRange, sprintWindows, daysOffFor, addDays, iso, parseISO, fmtDay, fmtSpan, lastWorkday } from './calendar.js'
import { planQuarters, monthsIn, quarterOf } from './quarters.js'
import { spanLabel, sprintAt } from './timeline.js'
import { cal } from './holidays.js'
import { face, orderedDeliverables, filterEmpty } from './render-board.js'
import { icon, STATUS_ICON } from './icons.js'
import { $, escHtml, plural } from './utils.js'

const DAY = 86400000
const days = (a, b) => Math.round((b - a) / DAY)
const MAX_PAST = 13 * 7      // how far past the plan the map follows a late landing

/** The map's dates: the plan, run on to the last landing (whole sprints, a quarter at most). */
export function mapRange(a, s) {
  const range = planRange(s)
  if (!range) return null
  let end = range.to
  for (const da of a.deliverables.values()) {
    const d = da.lands?.date
    if (d && d >= end) end = addDays(d, 1)
  }
  const cap = addDays(range.to, MAX_PAST)
  if (end > cap) end = cap
  // Close on a sprint boundary so the header reads in whole sprints.
  let k = s.sprints
  while (sprintAt(s, k - 1).to < end) k += 1
  const to = sprintAt(s, k - 1).to
  return { from: range.from, to, planEnd: range.to, n: days(range.from, to), sprints: k }
}

export function renderMap(a) {
  const doc = state.doc, s = doc.settings
  const m = mapRange(a, s)
  if (!m) { $('boardMap').innerHTML = '<p class="t-none">Pick a start date to see the map.</p>'; return }
  const pos = d => `${(Math.max(0, Math.min(m.n, days(m.from, d))) / m.n) * 100}%`
  const width = (from, to) => `${(Math.max(0, Math.min(m.n, days(m.from, to)) - Math.max(0, days(m.from, from))) / m.n) * 100}%`
  const place = (from, to) => `left:${pos(from)};width:${width(from, to)}`
  const workday = d => (d.getUTCDay() || 7) <= s.daysPerWeek
  const quarter = planQuarters(planRange(s), s.fiscalStart)

  // Header: the quarter, its months, and every sprint with the team's points and what is booked.
  // A month that opens a new quarter says so: "January 2027 · Q2 FY27".
  const opens = x => { const q = quarterOf(x.from, s.fiscalStart); return +q.from === +x.from && +x.from !== +m.from ? q.label : '' }
  const months = monthsIn(m.from, m.to).map(x => `<span class="map-month" style="${place(x.from, x.to)}">${escHtml(x.label)}${opens(x) ? `<em>${escHtml(opens(x))}</em>` : ''}</span>`).join('')
  const sprints = Array.from({ length: m.sprints }, (_, k) => {
    const w = sprintAt(s, k)
    const inPlan = k < s.sprints
    const detail = inPlan ? `${a.bookedPerSprint[k] ?? 0} of ${a.perSprint[k] ?? 0} pts booked` : 'after the plan'
    const brief = inPlan ? `${a.bookedPerSprint[k] ?? 0}/${a.perSprint[k] ?? 0}` : 'after'
    return `<span class="map-sprint${inPlan ? '' : ' map-sprint--after'}" style="${place(w.from, w.to)}" title="S${k + 1}: ${fmtDay(w.from)} to ${fmtDay(lastWorkday(w, s.daysPerWeek), true)}. ${detail}"><b>S${k + 1}</b><span aria-hidden="true">${brief}</span><span class="sr-only">${detail}</span></span>`
  }).join('')

  // The grid behind every row: weekends, sprint lines, quarter lines, today, and the time after the plan.
  const grid = []
  for (let i = 0; i < m.n;) {
    const d = addDays(m.from, i)
    if (workday(d)) { i += 1; continue }
    let j = i
    while (j < m.n && !workday(addDays(m.from, j))) j += 1
    grid.push(`<i class="map-weekend" style="${place(d, addDays(m.from, j))}"></i>`)
    i = j
  }
  for (let k = 1; k < m.sprints; k++) grid.push(`<i class="map-line" style="left:${pos(sprintAt(s, k).from)}"></i>`)
  for (let d = quarterOf(m.from, s.fiscalStart).to; d < m.to; d = quarterOf(d, s.fiscalStart).to) {
    grid.push(`<i class="map-line map-line--quarter" style="left:${pos(d)}"><span>${escHtml(quarterOf(d, s.fiscalStart).label)}</span></i>`)
  }
  if (m.planEnd < m.to) grid.push(`<i class="map-after" style="${place(m.planEnd, m.to)}"></i>`)
  const now = new Date(), today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  if (today >= m.from && today < m.to) grid.push(`<i class="map-today" style="left:${pos(today)}"><span>Today</span></i>`)

  // People: what the calendar takes from each, their vacations (editable), and how full each sprint is.
  const people = doc.people.filter(p => !ui.personFilter || p.id === ui.personFilter)
  const personRows = people.map(p => {
    const pa = a.people.get(p.id)
    const off = daysOffFor(p, doc, cal.holidays)
    const marks = []
    for (const [date, o] of off) {
      if (o.kind === 'vacation') continue
      const d = parseISO(date)
      if (!d || d < m.from || d >= m.to || !workday(d)) continue
      marks.push(`<i class="map-off map-off--${o.kind}" style="${place(d, addDays(d, 1))}" title="${fmtDay(d)}: ${escHtml(o.label)}"></i>`)
    }
    const vacations = (p.vacations || []).map((v, idx) => {
      const from = parseISO(v.from), to = addDays(parseISO(v.to), 1)
      if (to <= m.from || from >= m.to) return ''
      return `<button type="button" class="map-vac" style="${place(from, to)}" data-action="map-vacation" data-person="${p.id}" data-index="${idx}" data-key="mv-${p.id}-${idx}"
        aria-label="${escHtml(p.name.trim() || 'Unnamed')}'s vacation, ${fmtSpan(v.from, v.to)}. Change or remove">${icon('tree-palm', { size: 12 })}<span>${fmtSpan(v.from, v.to)}</span></button>`
    }).join('')
    const loads = sprintWindows(s).map(w => {
      const cap = pa.sprintCap[w.i] || 0, booked = pa.booked[w.i] || 0
      const pct = cap ? (booked / cap) * 100 : booked ? Infinity : 0
      const tone = pa.overSprints.includes(w.i) ? 'over' : pct >= 99.5 ? 'full' : pct > 0 ? 'some' : 'idle'
      const text = `S${w.i + 1}: ${Math.round(booked)} of ${Math.round(cap)} pts booked${cap ? ` (${Math.round(pct)}%)` : ''}`
      return `<span class="map-load map-load--${tone}" style="${place(w.from, w.to)}" title="${text}"><span class="sr-only">${text}. </span><b aria-hidden="true">${cap ? `${Math.round(pct)}%` : ''}</b></span>`
    }).join('')
    const name = escHtml(p.name.trim() || 'Unnamed')
    return `<div class="map-row map-row--person${pa.over ? ' is-over' : ''}">
      <div class="map-label" data-drag="person" data-person="${p.id}" tabindex="0" aria-label="${name}${p.open ? ', open role' : ''}: ${pa.cap} pts${pa.over ? `, over-booked${pa.overSprints.length ? ` in ${sprintList(pa.overSprints)}` : ''}` : ''}. Enter to pick up">
        ${face(p, true)}<span class="map-name">${name}</span>
        <button type="button" class="icon-btn map-edit" data-action="edit-person" data-id="${p.id}" data-key="me-${p.id}" aria-label="Edit ${name}: load, country and vacations">${icon('pencil', { size: 14 })}</button>
      </div>
      <div class="map-track" data-vac-track="${p.id}" title="Drag across the days to add a vacation">${marks.join('')}${vacations}${loads}</div>
    </div>`
  }).join('')

  // Deliverables: a bar over the sprints it runs in, filled as far as it is staffed, and a diamond where it lands.
  const list = orderedDeliverables(doc.deliverables, a)
  const delivRows = list.map(d => {
    const da = a.deliverables.get(d.id)
    const st = deliverableStatus(d, da, a, doc)
    const lt = landingText(da.lands, s, da.span)
    const from = sprintAt(s, da.span.a).from, to = sprintAt(s, da.span.b).to
    const fill = d.estimate ? Math.min(100, (da.got / d.estimate) * 100) : 0
    const name = escHtml(d.name.trim() || 'Untitled deliverable')
    let marker = ''
    if (lt.date) {
      const past = lt.date >= m.to
      const at = past ? addDays(m.to, -1) : lt.date
      // Near the right edge the date reads to the left of its diamond, or the map would cut it off.
      const flip = past || days(m.from, at) / m.n > 0.86
      marker = `<span class="map-land${lt.late ? (lt.afterPlan ? ' map-land--late' : ' map-land--slip') : ''}${flip ? ' map-land--flip' : ''}" style="left:${pos(at)}" title="${escHtml(lt.text)}">${icon('diamond', { size: 12 })}<span>${past ? '→ ' : ''}${escHtml(lt.short)}</span></span>`
    }
    return `<div class="map-row map-row--deliv" data-drop="deliverable" data-deliv="${d.id}">
      <div class="map-label"><span class="status-icon status--${st.cls}" title="${escHtml(st.text)}">${icon(STATUS_ICON[st.cls], { size: 14 })}</span><span class="map-name" title="${name}">${name}</span><span class="map-est">${d.estimate ?? '?'}</span></div>
      <div class="map-track" data-bar-track="${d.id}">
        <button type="button" class="map-bar status--${st.cls}${d.estimate ? '' : ' map-bar--unsized'}" style="${place(from, to)}" data-action="window" data-id="${d.id}" data-key="dt-${d.id}" data-bar="${d.id}" aria-haspopup="dialog"
          aria-label="${name}: ${escHtml(spanLabel(da.span))}, ${da.got} of ${d.estimate ?? 'unsized'} pts. ${escHtml(lt.text)}. Change its sprints"
          data-tip="${escHtml(`${spanLabel(da.span)} · ${da.got} of ${d.estimate ?? '?'} pts · ${lt.text}. Drag to move it, drag an end to resize, click for exact sprints.`)}">
          <i class="map-fill" style="width:${fill}%"></i><span class="map-handle map-handle--start" data-handle="start" aria-hidden="true"></span><span class="map-bar-text">${escHtml(spanLabel(da.span, { whole: false }))} · ${da.got}/${d.estimate ?? '?'}</span><span class="map-handle map-handle--end" data-handle="end" aria-hidden="true"></span>
        </button>${marker}
      </div>
    </div>`
  }).join('')

  $('boardMap').innerHTML = !list.length && ui.personFilter ? filterEmpty() : `
    <div class="map" style="--map-days:${m.n}" data-from="${iso(m.from)}" data-days="${m.n}">
      <div class="map-head">
        <div class="map-label map-label--quarter"><strong>${escHtml(quarter)}</strong><span>${fmtDay(m.from, true)} to ${fmtDay(lastWorkday({ from: m.from, to: planRange(s).to }, s.daysPerWeek), true)}</span></div>
        <div class="map-track map-months">${months}</div>
        <div class="map-label map-label--sub">Sprints</div>
        <div class="map-track map-sprints">${sprints}</div>
      </div>
      <div class="map-body">
        <div class="map-grid" aria-hidden="true">${grid.join('')}</div>
        <h3 class="map-section">${icon('users', { size: 14 })}People <small>Drag across a row to add a vacation. The strip under each row is how full each sprint is.</small></h3>
        ${personRows || '<p class="map-empty">Nobody yet.</p>'}
        <h3 class="map-section">${icon('target', { size: 14 })}Deliverables <small>Drag a bar to move it, an end to resize it; the diamond is where it lands.</small></h3>
        ${delivRows || '<p class="map-empty">No deliverables yet.</p>'}
      </div>
    </div>
    <p class="map-legend"><span class="map-key map-key--holiday"></span>Public holiday <span class="map-key map-key--team"></span>Team day off <span class="map-key map-key--vac"></span>Vacation <span class="map-key map-key--over"></span>Over-booked sprint ${icon('diamond', { size: 12 })} Lands</p>`
}

