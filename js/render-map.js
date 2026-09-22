// ── Render: the map ──────────────────────────────────────────
// The plan on its dates, as two tables that scroll together: People, one
// schedule bar each, and Deliverables, one bar each over its sprints with a
// diamond where it lands. Both carry the quarter, its months and the sprints
// across the top. The map always shows the whole quarter the plan sits in
// (the weeks it does not plan are marked), and runs on past it when
// something lands later, so a late date is in sight rather than cut off.
//
// A person's bar is their final schedule, like an on-call schedule with
// overrides: working days are the bar, coloured by how full that sprint is,
// and a vacation, a public holiday or a team day off replaces the bar on
// its days rather than sitting on top of it. Each sprint says what it holds,
// booked of available points, so a vacation visibly takes points away.
// Editing lives in map-edit.js; every mark here is a button or has text.

import { state, ui } from './state.js'
import { deliverableStatus, landingText, sprintList } from './flags.js'
import { planRange, daysOffFor, addDays, iso, parseISO, fmtDay, fmtSpan, lastWorkday } from './calendar.js'
import { planQuarters, monthsIn, quarterOf } from './quarters.js'
import { spanLabel, sprintAt, mapRange } from './timeline.js'
import { cal } from './holidays.js'
import { face, orderedDeliverables, filterEmpty, dropButton } from './render-board.js'
import { icon, STATUS_ICON } from './icons.js'
import { $, escHtml } from './utils.js'

const DAY = 86400000
const days = (a, b) => Math.round((b - a) / DAY)
const pts = n => (Number.isInteger(Math.round(n * 10) / 10) ? String(Math.round(n)) : (Math.round(n * 10) / 10).toFixed(1))

export function renderMap(a) {
  const doc = state.doc, s = doc.settings
  const m = mapRange(a, s)
  if (!m) { $('boardMap').innerHTML = '<p class="t-none">Pick a start date to see the map.</p>'; return }
  const pos = d => `${(Math.max(0, Math.min(m.n, days(m.from, d))) / m.n) * 100}%`
  const width = (from, to) => `${(Math.max(0, Math.min(m.n, days(m.from, to)) - Math.max(0, days(m.from, from))) / m.n) * 100}%`
  const place = (from, to) => `left:${pos(from)};width:${width(from, to)}`
  const workday = d => (d.getUTCDay() || 7) <= s.daysPerWeek
  const range = planRange(s)
  const quarter = quarterOf(range.from, s.fiscalStart)
  const planEndDay = lastWorkday({ from: range.from, to: range.to }, s.daysPerWeek)

  // ── The header both tables carry: the quarter, its months, the sprints ──
  const opens = x => { const q = quarterOf(x.from, s.fiscalStart); return +q.from === +x.from ? q.label : '' }
  const months = monthsIn(m.from, m.to).map(x => `<span class="map-month" style="${place(x.from, x.to)}">${escHtml(x.label)}${opens(x) ? `<em>${escHtml(opens(x))}</em>` : ''}</span>`).join('')
  const sprints = Array.from({ length: m.sprints }, (_, k) => {
    const w = sprintAt(s, k)
    const inPlan = k < s.sprints
    const detail = inPlan ? `${a.bookedPerSprint[k] ?? 0} of ${a.perSprint[k] ?? 0} pts booked` : w.from < m.quarterEnd ? `rest of ${quarter.label}, not in this plan` : 'after the quarter'
    const brief = inPlan ? `${a.bookedPerSprint[k] ?? 0}/${a.perSprint[k] ?? 0}` : 'not planned'
    return `<span class="map-sprint${inPlan ? '' : ' map-sprint--after'}" style="${place(w.from, w.to)}" title="S${k + 1}: ${fmtDay(w.from)} to ${fmtDay(lastWorkday(w, s.daysPerWeek), true)}. ${detail}"><b>S${k + 1}</b><span aria-hidden="true">${brief}</span><span class="sr-only">${detail}</span></span>`
  }).join('')
  const head = label => `<div class="map-head">
      <div class="map-label map-label--quarter"><strong>${escHtml(label)}</strong><span>${escHtml(planQuarters(range, s.fiscalStart))} · plan ${fmtDay(range.from)} to ${fmtDay(planEndDay)}</span></div>
      <div class="map-track map-months">${months}</div>
      <div class="map-track map-sprints">${sprints}</div>
    </div>`

  // ── The grid behind each table's rows: weekends, sprint and quarter lines, the unplanned weeks, today ──
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
  for (let d = quarterOf(m.from, s.fiscalStart).to; d < m.to; d = quarterOf(d, s.fiscalStart).to) grid.push(`<i class="map-line map-line--quarter" style="left:${pos(d)}"></i>`)
  if (m.planEnd < m.to) grid.push(`<i class="map-after" style="${place(m.planEnd, m.to)}"></i>`)
  const now = new Date(), today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
  if (today >= m.from && today < m.to) grid.push(`<i class="map-today" style="left:${pos(today)}"><span>Today</span></i>`)
  const gridLayer = `<div class="map-grid" aria-hidden="true">${grid.join('')}</div>`

  // ── People: one schedule bar each ──
  const people = doc.people.filter(p => !ui.personFilter || p.id === ui.personFilter)
  const personRows = people.map(p => {
    const pa = a.people.get(p.id)
    const off = daysOffFor(p, doc, cal.holidays)
    const name = escHtml(p.name.trim() || 'Unnamed')
    const parts = []
    for (let k = 0; k < s.sprints; k++) {
      const w = sprintAt(s, k)
      const cap = pa.sprintCap[k] || 0, booked = pa.booked[k] || 0
      const tone = pa.overSprints.includes(k) ? 'over' : cap && booked >= cap - 0.05 ? 'full' : booked > 0.05 ? 'some' : 'idle'
      // The bar: each run of working days that is not a day off, in this sprint's tone.
      let run = null
      const flush = end => { if (run) parts.push(`<i class="map-work map-work--${tone}" style="${place(run, end)}"></i>`); run = null }
      for (let d = w.from; d < w.to; d = addDays(d, 1)) {
        const o = off.get(iso(d))
        if (!workday(d) || o) { flush(d); continue }
        if (!run) run = d
      }
      flush(w.to)
      // What the sprint holds: available points, and booked of them when that differs.
      const text = !cap ? 'away' : Math.abs(booked - cap) < 0.05 ? `${pts(cap)} pts` : `${pts(booked)} of ${pts(cap)}`
      const said = `S${k + 1}: ${pts(booked)} of ${pts(cap)} pts booked${pa.overSprints.includes(k) ? ', over-booked' : ''}`
      parts.push(`<span class="map-sched-label map-sched-label--${tone}" style="${place(w.from, w.to)}" title="${said}"><span aria-hidden="true">${text}</span><span class="sr-only">${said}. </span></span>`)
    }
    // Overrides: public holidays and team days off on working days (vacations are drawn from the person's own list below).
    for (const [date, o] of off) {
      if (o.kind === 'vacation') continue
      const d = parseISO(date)
      if (!d || d < m.from || d >= m.planEnd || !workday(d)) continue
      parts.push(`<i class="map-off map-off--${o.kind}" style="${place(d, addDays(d, 1))}" title="${fmtDay(d)}: ${escHtml(o.label)}"></i>`)
    }
    const vacations = (p.vacations || []).map((v, idx) => {
      const from = parseISO(v.from), to = addDays(parseISO(v.to), 1)
      if (to <= m.from || from >= m.to) return ''
      return `<button type="button" class="map-vac" style="${place(from, to)}" data-action="map-vacation" data-person="${p.id}" data-index="${idx}" data-key="mv-${p.id}-${idx}"
        aria-label="${name}'s vacation, ${fmtSpan(v.from, v.to)}. Change or remove">${icon('tree-palm', { size: 12 })}<span>${fmtSpan(v.from, v.to)}</span></button>`
    }).join('')
    return `<div class="map-row map-row--person${pa.over ? ' is-over' : ''}">
      <div class="map-label" data-drag="person" data-person="${p.id}" data-key="ml-${p.id}" tabindex="0" aria-label="${name}${p.open ? ', open role' : ''}: ${pa.cap} pts${pa.over ? `, over-booked${pa.overSprints.length ? ` in ${sprintList(pa.overSprints)}` : ''}` : ''}. Enter to pick up">
        ${face(p, true)}<span class="map-name">${name}</span><span class="map-est" title="Planned points">${pa.cap}</span>
        <button type="button" class="icon-btn map-edit" data-action="edit-person" data-id="${p.id}" data-key="me-${p.id}" aria-label="Edit ${name}: load, country and vacations">${icon('pencil', { size: 14 })}</button>
      </div>
      <div class="map-track map-track--sched" data-vac-track="${p.id}" title="Drag across the days to add a vacation">${parts.join('')}${vacations}</div>
    </div>`
  }).join('')

  // ── Deliverables: a bar over its sprints, filled as far as it is staffed, and a diamond where it lands ──
  const list = orderedDeliverables(doc.deliverables, a)
  const carry = ui.carry && doc.people.find(p => p.id === ui.carry.person)
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
    // The row carries the card's id and its estimate control, so a flag's jump, "Size it" and
    // "Change its sprints" land here as they do on the cards; a carried person has a keyboard drop.
    const drop = dropButton(d, da, carry)
    return `<div class="map-row map-row--deliv" id="d-${d.id}" data-drop="deliverable" data-deliv="${d.id}">
      <div class="map-label"><span class="status-icon status--${st.cls}" title="${escHtml(st.text)}">${icon(STATUS_ICON[st.cls], { size: 14 })}</span><span class="map-name" title="${name}">${name}</span><button type="button" class="map-est${d.estimate ? '' : ' map-est--missing'}" data-action="estimate" data-id="${d.id}" data-key="de-${d.id}" aria-haspopup="dialog" aria-label="${name}: ${d.estimate ? `estimate ${d.estimate} pts` : 'not sized'}. Change the estimate">${d.estimate ?? '?'}</button></div>
      <div class="map-track" data-bar-track="${d.id}">${drop ? `<span class="map-drop">${drop}</span>` : ''}
        <button type="button" class="map-bar status--${st.cls}${d.estimate ? '' : ' map-bar--unsized'}" style="${place(from, to)}" data-action="window" data-id="${d.id}" data-key="dt-${d.id}" data-bar="${d.id}" aria-haspopup="dialog"
          aria-label="${name}, ${escHtml(st.text)}: ${escHtml(spanLabel(da.span))}, ${da.got} of ${d.estimate ?? 'unsized'} pts. ${escHtml(lt.text)}. Change its sprints"
          data-tip="${escHtml(`${st.text} · ${spanLabel(da.span)} · ${da.got} of ${d.estimate ?? '?'} pts · ${lt.text}. Drag to move it, drag an end to resize, click for exact sprints.`)}">
          <i class="map-fill" style="width:${fill}%"></i><span class="map-handle map-handle--start" data-handle="start" aria-hidden="true"></span><span class="map-bar-text">${escHtml(spanLabel(da.span, { whole: false }))} · ${da.got}/${d.estimate ?? '?'}</span><span class="map-handle map-handle--end" data-handle="end" aria-hidden="true"></span>
        </button>${marker}
      </div>
    </div>`
  }).join('')

  const table = (kind, title, hint, rows, empty) => `
    <section class="map" aria-label="${title} on the map" style="--map-days:${m.n}" data-from="${iso(m.from)}" data-days="${m.n}">
      ${head(title)}
      <p class="map-hint">${hint}</p>
      <div class="map-body">${gridLayer}${rows || empty}</div>
    </section>`

  // Filtered to someone on no deliverable, the map still shows their row: planning their time off is what it is for.
  $('boardMap').innerHTML = `
    ${table('people', 'People', `${icon('users', { size: 14 })}Each bar is a person's schedule: a vacation, a holiday or a team day off replaces the bar on its days, and each sprint shows the points they have there (booked of available when those differ). Drag across a row to add a vacation.`, personRows, '<p class="map-empty">Nobody yet.</p>')}
    ${table('deliverables', 'Deliverables', `${icon('target', { size: 14 })}A bar runs over the deliverable's sprints and fills as far as it is staffed; the diamond is where it lands. Drag a bar to move it, an end to resize it.`, delivRows, ui.personFilter ? `<div class="map-empty">${filterEmpty()}</div>` : '<p class="map-empty">No deliverables yet.</p>')}
    <p class="map-legend"><span class="map-key map-key--work"></span>Working, sprint full <span class="map-key map-key--some"></span>Room left <span class="map-key map-key--over"></span>Over-booked <span class="map-key map-key--vac"></span>Vacation <span class="map-key map-key--holiday"></span>Public holiday <span class="map-key map-key--team"></span>Team day off <span class="map-key map-key--after"></span>Not in this plan ${icon('diamond', { size: 12 })} Lands</p>`
}
