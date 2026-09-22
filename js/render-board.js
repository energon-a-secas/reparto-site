// ── Render: roster and deliverable cards ─────────────────────
// Both emit the drag contract dnd.js reads and nothing else:
//   data-drag="person" data-person [data-from=deliverable]   draggable
//   data-drop="deliverable" data-deliv | data-drop="roster"   drop target
// The table view (render-table.js) reuses share() and statusButton(), so a
// row and a card read the same.

import { state, ui } from './state.js'
import { flagIndex, deliverableStatus, landingText, sprintList, engineers } from './flags.js'
import { spanLabel, spanLength } from './timeline.js'
import { shareKey } from './capacity.js'
import { renderTable } from './render-table.js'
import { renderMap } from './render-map.js'
import { icon, STATUS_ICON } from './icons.js'
import { PRIORITIES, PROGRESS, priorityOf, progressOf, priorityColorOf, boxColorOf, sortByPriority } from './planning.js'
import { $, escHtml, initials, compactName, faceColor, plural, fmtPct } from './utils.js'

const focused = id => ui.focus?.ids.includes(id)
const nameOf = p => p?.name.trim() || 'Unnamed'
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** A face disc; a carried person wears a hand on it. */
export function face(p, sm = false, carried = false) {
  return `<span class="face${sm ? ' face--sm' : ''}${p.open ? ' face--open' : ''}" style="--face:${faceColor(p.id)}" aria-hidden="true">${escHtml(initials(p.name))}${carried ? `<span class="carry-mark">${icon('hand-grab', { size: sm ? 10 : 12 })}</span>` : ''}</span>`
}

/** A single status control opens the relevant review; details stay off the row. */
export function statusButton(d, st, da) {
  const label = { ok: 'Staffed', short: 'Short', over: 'Overstaffed', unsized: 'Unsized', empty: 'Unassigned', risk: 'At risk' }[st.cls]
  const tip = `${st.text}${da.leavePts > 0 ? `. Leave affects ${da.leavePts} points.` : ''} Click for details and fixes.`
  return `<button type="button" class="status-button status--${st.cls}" data-action="flags" data-kind="deliverable" data-id="${d.id}" data-key="ds-${d.id}" aria-haspopup="dialog" aria-label="${escHtml(d.name || 'Deliverable')}: ${label}. View details" data-tip="${escHtml(tip)}">${icon(STATUS_ICON[st.cls], { size: 15 })}<span>${label}</span></button>`
}

/**
 * When a deliverable runs and when it lands, one control: it opens the
 * sprints picker. Late (past its sprints) and after-the-plan read differently.
 */
export function timingButton(d, da, { compact = false } = {}) {
  const s = state.doc.settings
  const lt = landingText(da.lands, s, da.span)
  const when = da.span.whole ? 'Whole plan' : spanLabel(da.span)
  const tone = !lt.late ? '' : lt.afterPlan ? ' timing--late' : ' timing--slip'
  const name = escHtml(d.name.trim() || 'Deliverable')
  return `<button type="button" class="timing${tone}${compact ? ' timing--compact' : ''}" data-action="window" data-id="${d.id}" data-key="dt-${d.id}" aria-haspopup="dialog"
    aria-label="${name}: runs ${escHtml(when)}. ${escHtml(lt.text)}. Change its sprints" data-tip="${escHtml(`${when}. ${lt.text}. Click to change its sprints.`)}">${icon('calendar-range', { size: 14 })}<span class="timing-when">${escHtml(when)}</span>${compact ? '' : `<span class="timing-lands">${icon('diamond', { size: 11 })}${escHtml(lt.short)}</span>`}</button>`
}

function personIndicator(p, pa, counts) {
  const n = counts ? counts.error + counts.warn : 0
  const leave = pa.lost.vacation || p.sprintsOff
  if (!n && !leave) return ''
  const details = [n ? plural(n, 'flag') : '', pa.lost.vacation ? plural(pa.lost.vacation, 'vacation day') : '', p.sprintsOff ? plural(p.sprintsOff, 'sprint') + ' away' : ''].filter(Boolean).join(' · ')
  return `<button type="button" class="person-indicator${n ? ' person-indicator--warn' : ''}" data-action="flags" data-kind="person" data-id="${p.id}" data-key="pi-${p.id}" aria-haspopup="dialog" aria-label="${escHtml(nameOf(p))}: availability and workload" data-tip="${escHtml(details)}. Click for details.">${icon(n ? 'triangle-alert' : 'calendar-days', { size: 14 })}</button>`
}

/** View-only filter, shared by cards, the table, Later and Done. */
export function filteredDeliverables(list) {
  return ui.personFilter ? list.filter(d => d.members.some(m => m.person === ui.personFilter)) : list
}
export function orderedDeliverables(list, a) {
  const visible = filteredDeliverables(list)
  const { key, dir } = ui.sort
  if (key === 'priority') return sortByPriority(visible, dir)
  const by = {
    name: d => d.name.trim().toLowerCase(),
    progress: d => PROGRESS[progressOf(d)].rank,
    status: d => a?.deliverables.has(d.id) ? ({ empty: 0, short: 1, unsized: 2, risk: 3, over: 4, ok: 5 }[deliverableStatus(d, a.deliverables.get(d.id), a, state.doc).cls]) : 0,
    estimate: d => d.estimate ?? -1,
    booked: d => a?.deliverables.get(d.id)?.got ?? 0,
    gap: d => a?.deliverables.get(d.id)?.gap ?? 0,
    people: d => d.members.length,
    // Undated work (unsized, nobody on it) sorts after everything with a date.
    lands: d => a?.deliverables.get(d.id)?.lands?.date?.getTime() ?? Infinity,
    when: d => { const sp = a?.spans.get(d.id); return sp ? sp.a * 100 + sp.b : 0 },
  }[key]
  if (!by) return visible
  return visible.map((d, i) => ({ d, i })).sort((x, y) => {
    const p = by(x.d), q = by(y.d)
    return (p < q ? -1 : p > q ? 1 : 0) * dir || x.i - y.i
  }).map(x => x.d)
}
export function priorityButton(d) {
  const label = PRIORITIES[priorityOf(d)].label
  return `<button type="button" class="priority-tag" data-color="${priorityColorOf(d)}" data-action="deliverable-details" data-id="${d.id}" data-field="priority" data-key="dp-${d.id}" aria-haspopup="dialog" aria-label="${escHtml(d.name || 'Deliverable')}: ${label} priority. Edit details" data-tip="${label} priority. P1 is highest; P6 is lowest. Click to edit."><span class="priority-dot" aria-hidden="true"></span>${label}</button>`
}
export function progressButton(d) {
  const progress = progressOf(d), label = PROGRESS[progress].label
  return `<button type="button" class="progress-tag" data-progress="${progress}" data-action="deliverable-details" data-id="${d.id}" data-field="progress" data-key="dw-${d.id}" aria-haspopup="dialog" aria-label="${escHtml(d.name || 'Deliverable')}: ${label}. Change progress"><span class="progress-mark" aria-hidden="true"></span>${label}</button>`
}
export function filterEmpty() {
  const p = state.doc.people.find(p => p.id === ui.personFilter)
  return `<div class="filter-empty"><h3>No assignments here for ${escHtml(nameOf(p))}</h3><p>Try another section, or clear the filter to see all deliverables.</p><button type="button" class="btn btn--secondary btn--sm" data-action="clear-person-filter">Show everyone</button></div>`
}

export function noteLine(d, cls = 'deliv-note') {
  return d.note ? `<p class="${cls}" title="${escHtml(d.note)}">${icon('sticky-note', { size: 13 })}<span>${escHtml(d.note)}</span></p>` : ''
}

/** The country code beside a role, when it tells you something: a mixed team, or someone off the team's calendar. */
function countryTag(p) {
  const list = state.doc.settings.countries
  if (!p.country) return list.length > 1 ? `${list[0]} (default)` : ''
  return list.length > 1 || !list.includes(p.country) ? p.country : ''
}

// ── Roster ───────────────────────────────────────────────────
export function renderRoster(a, flags) {
  const idx = flagIndex(flags)
  const people = state.doc.people
  $('rosterCount').textContent = `${plural(people.length, 'person', 'people')} · ${a.capacity} pts`
  if (!people.length) {
    $('rosterList').innerHTML = '<li class="roster-empty">Nobody yet. Add the people this plan counts on, including open roles you are hiring for.</li>'
    return
  }
  // Carrying a share: the roster is where it comes off, so say so, and give keyboards a button for it.
  const carrying = ui.carry?.from && state.doc.people.find(p => p.id === ui.carry.person)
  const from = carrying && state.doc.deliverables.find(d => d.id === ui.carry.from)
  const dropHere = carrying
    ? `<li class="roster-drop"><button type="button" class="drop-btn drop-btn--off" data-action="drop" data-id="roster">${icon('user-x', { size: 15 })}Take ${escHtml(nameOf(carrying))} off ${escHtml(from?.name.trim() || 'the deliverable')}</button></li>` : ''
  $('rosterList').innerHTML = dropHere + people.map(p => {
    const pa = a.people.get(p.id)
    const pct = pa.cap ? Math.min(100, (pa.used / pa.cap) * 100) : 0
    const band = pa.over ? 'over' : pa.free === 0 && pa.cap ? 'full' : 'free'
    const bits = [
      p.role && escHtml(p.role),
      p.load < 100 && `${p.load}%`,
      countryTag(p),
    ].filter(Boolean).join(' · ')
    const carried = ui.carry?.person === p.id && !ui.carry.from
    return `<li class="person person--${band}${p.open ? ' person--open' : ''}${carried ? ' is-carried' : ''}${focused(p.id) ? ' is-focus' : ''}"
        id="p-${p.id}" data-drag="person" data-person="${p.id}" data-key="p-${p.id}" tabindex="0"
        aria-label="${escHtml(nameOf(p))}${p.open ? ', open role' : ''}${carried ? ', picked up' : ''}. ${fmtPct(pa.pct)} booked, ${pa.used} of ${pa.cap} points. Enter to pick up.">
      ${face(p, false, carried)}
      <span class="person-meta">
        <span class="person-line"><span class="person-name" title="${escHtml(nameOf(p))}">${escHtml(ui.view === 'cards' && !p.open ? compactName(p.name) : nameOf(p))}</span>${personIndicator(p, pa, idx.get(p.id))}</span>
        <span class="person-role">${p.open ? `<span class="tag">open role</span>` : ''}${bits || (p.open ? '' : '&nbsp;')}</span>
      </span>
      <span class="person-cap" title="${fmtPct(pa.pct)} of their time booked: ${pa.used} of ${pa.cap} pts (${fmt(pa.raw)} before rounding${pa.lost.holiday + pa.lost.team + pa.lost.vacation ? `, after ${pa.lost.holiday + pa.lost.team + pa.lost.vacation} days off` : ''})">
        <b>${pa.free < 0 ? -pa.free : pa.over ? pa.overPts : pa.free}</b><small>${pa.free < 0 ? `over of ${pa.cap}` : pa.over ? `over in ${sprintList(pa.overSprints)}` : `free of ${pa.cap}`}</small>
      </span>
      <button type="button" class="icon-btn" data-action="edit-person" data-id="${p.id}" data-key="pe-${p.id}" aria-label="Edit ${escHtml(nameOf(p))}">${icon('pencil')}</button>
      <span class="cap-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
    </li>`
  }).join('')
}

// ── Board ────────────────────────────────────────────────────
/** What a deliverable asks of the team: engineers at once over its own sprints ("About 1.6 engineers over 4 sprints"). */
function need(d, da) {
  const e = engineers(d.estimate, da.unitWindow)
  return `${e[0].toUpperCase()}${e.slice(1)} over ${plural(spanLength(da.span), 'sprint')}`
}
/** The same in engineer-sprints, for the tooltip: 55 pts is 6.9 sprints of one engineer at 8 a sprint. */
function needTitle(d, da, a) {
  const sprints = d.estimate / (a.sprint || 1)
  return `${d.estimate} pts is ${fmt(Math.round(sprints * 10) / 10)} ${sprints === 1 ? 'sprint' : 'sprints'} of one engineer's work at ${a.sprint} pts a sprint. Over its ${plural(spanLength(da.span), 'sprint')}${da.span.whole ? '' : ` (${spanLabel(da.span)})`} that is ${engineers(d.estimate, da.unitWindow)} at once, counting the calendar and the buffer.`
}

function meter(d, da) {
  if (!d.estimate) return '<div class="deliv-meter deliv-meter--unsized" aria-hidden="true"></div>'
  const top = Math.max(d.estimate, da.got)
  const got = (Math.min(da.got, d.estimate) / top) * 100
  const over = da.got > d.estimate ? ((da.got - d.estimate) / top) * 100 : 0
  return `<div class="deliv-meter" aria-hidden="true"><i class="m-got" style="width:${got}%"></i>${over ? `<i class="m-over" style="width:${over}%"></i>` : ''}</div>`
}

export function share(d, m, a, compact = false) {
  const p = state.doc.people.find(x => x.id === m.person)
  if (!p) return ''
  const pa = a.people.get(p.id)
  const sh = a.shares.get(shareKey(d.id, p.id))
  const carried = ui.carry?.person === p.id && ui.carry.from === d.id
  return `<li class="share${compact ? ' share--compact' : ''}${ui.personFilter === p.id ? ' share--filtered' : ''}${p.open ? ' share--open' : ''}${pa.over ? ' share--over' : ''}${carried ? ' is-carried' : ''}"
      data-drag="person" data-person="${p.id}" data-from="${d.id}" data-key="s-${d.id}-${p.id}" tabindex="0"
      aria-label="${escHtml(nameOf(p))} gives ${fmtPct(sh.pct)} of their time, ${sh.points} points${carried ? ', picked up' : ''}. Enter to pick up and move.">
    ${compact ? '' : face(p, true, carried)}
    <span class="share-name" title="${escHtml(nameOf(p))}">${escHtml(compact || p.open ? nameOf(p) : compactName(p.name))}</span>
    <button type="button" class="share-pts" data-action="points" data-id="${d.id}" data-person="${p.id}" data-key="sp-${d.id}-${p.id}"
      data-tip="${escHtml(nameOf(p))}: ${fmtPct(sh.pct)} of ${Math.round(sh.winCap)} available points${d.window ? ` in ${escHtml(spanLabel(a.spans.get(d.id)))}` : ''}${pa.free < 0 ? `; ${-pa.free} points over-booked across the plan` : pa.over ? `; over-booked in ${sprintList(pa.overSprints)}` : ''}.${sh.fixed ? ` Fixed at ${sh.points} points.` : ''} Click to edit this assignment."
      aria-label="${escHtml(nameOf(p))}: ${fmtPct(sh.pct)}, ${sh.points} points${sh.fixed ? ', fixed' : ''}. Change"><span class="share-value">${sh.points}<span class="share-unit">pts</span></span><span class="share-pct">${fmtPct(sh.pct)}</span></button>
    <button type="button" class="share-x" data-action="unassign" data-id="${d.id}" data-person="${p.id}" aria-label="Take ${escHtml(nameOf(p))} off">${icon('x', { size: 14, stroke: 2.4 })}</button>
  </li>`
}

/** The put-down button a carried person offers on every deliverable that can take them. */
export function dropButton(d, da, carry) {
  if (!carry || ui.carry.from === d.id) return ''
  const holds = d.members.some(m => m.person === carry.id)
  if (holds && !ui.carry.from) return ''
  const name = d.name.trim() || 'Untitled deliverable'
  // Cards that need someone stand out while carrying; staffed ones stay reachable but quiet.
  const needed = !d.members.length || da.gap > 0
  const staffed = d.estimate && da.gap <= 0
  const verb = ui.carry.from ? `Move ${escHtml(nameOf(carry))}'s share` : `Add ${escHtml(nameOf(carry))}`
  return `<button type="button" class="drop-btn${needed ? ' drop-btn--needed' : staffed ? ' drop-btn--muted' : ''}" data-action="drop" data-id="${d.id}"
    aria-label="${verb} to ${escHtml(name)}${staffed ? ', already staffed' : ''}">${icon(ui.carry.from ? 'move' : 'circle-plus', { size: 15 })}${verb} here${staffed ? ' (already staffed)' : ''}</button>`
}

/** Which deliverables (this plan, Later, Done) and how (cards, table). */
function renderBar() {
  const doc = state.doc
  if (ui.personFilter && !doc.people.some(p => p.id === ui.personFilter)) ui.personFilter = ''
  const n = { plan: filteredDeliverables(doc.deliverables).length, later: filteredDeliverables(doc.backlog.filter(d => d.when === 'later')).length, done: filteredDeliverables(doc.backlog.filter(d => d.when === 'done')).length }
  const scopes = [['plan', 'target', 'This plan'], ['later', 'calendar-clock', 'Later'], ['done', 'archive', 'Done']]
  const seg = (list, attr, cur) => list.map(([k, ic, label]) =>
    `<button type="button" class="seg-btn" data-action="${attr}" data-${attr}="${k}" data-key="${attr}-${k}" aria-pressed="${cur === k}">${attr === 'view' ? icon(ic, { size: 15 }) : ''}${label}${attr === 'scope' ? ` <span class="chip-n">${n[k]}</span>` : ''}</button>`).join('')
  $('boardBar').innerHTML = `
    <div class="seg seg--sm" role="group" aria-label="Which deliverables">${seg(scopes, 'scope', ui.scope)}</div>
    <div class="board-controls"><label class="board-sort"><span class="sr-only">Sort deliverables</span><select class="field" id="boardSort" data-key="board-sort" aria-label="Sort deliverables"><option value=""${!ui.sort.key ? ' selected' : ''}>Plan order</option><option value="priority:1"${ui.sort.key === 'priority' && ui.sort.dir === 1 ? ' selected' : ''}>Priority: highest first</option><option value="priority:-1"${ui.sort.key === 'priority' && ui.sort.dir === -1 ? ' selected' : ''}>Priority: lowest first</option><option value="status:1"${ui.sort.key === 'status' && ui.sort.dir === 1 ? ' selected' : ''}>Staffing: needs attention</option><option value="lands:1"${ui.sort.key === 'lands' && ui.sort.dir === 1 ? ' selected' : ''}>Lands: soonest first</option>${ui.sort.key && ui.sort.key !== 'priority' && !(ui.sort.key === 'status' && ui.sort.dir === 1) && !(ui.sort.key === 'lands' && ui.sort.dir === 1) ? `<option value="custom" selected>${escHtml(ui.sort.key)}: ${ui.sort.dir === 1 ? 'ascending' : 'descending'}</option>` : ''}</select></label>
    <label class="person-filter"><span class="sr-only">Filter by person</span><select class="field" id="personFilter" data-key="person-filter" aria-label="Filter by person"><option value="">Everyone</option>${doc.people.map(p => `<option value="${p.id}"${ui.personFilter === p.id ? ' selected' : ''}>${escHtml(nameOf(p))}</option>`).join('')}</select></label>
    ${ui.scope === 'plan' ? `<div class="seg seg--sm" role="group" aria-label="View">${seg([['cards', 'layout-grid', 'Cards'], ['table', 'table-2', 'Table'], ['map', 'chart-gantt', 'Map']], 'view', ui.view)}</div>` : ''}</div>`
  const list = ui.scope === 'plan' ? doc.deliverables : doc.backlog.filter(d => d.when === ui.scope)
  const person = doc.people.find(p => p.id === ui.personFilter)
  $('boardFilterNote').hidden = !person
  $('boardFilterNote').innerHTML = person ? `<span>Showing <strong>${n[ui.scope]} of ${list.length}</strong> deliverables for <strong>${escHtml(nameOf(person))}</strong>. Totals include the whole plan.</span><button type="button" data-action="clear-person-filter">Clear filter</button>` : ''
  $('addDelivBtn').innerHTML = `${icon('plus', { size: 15 })}<span>${{ plan: 'Add deliverable', later: 'Add to Later', done: 'Add to Done' }[ui.scope]}</span>`
}

export function renderBoard(a, flags) {
  renderBar()
  const carry = ui.carry && state.doc.people.find(p => p.id === ui.carry.person)
  const bar = $('carryBar')
  bar.hidden = !carry
  if (carry) {
    bar.innerHTML = `<span class="carry-who">${icon('hand-grab', { size: 18 })}${face(carry, true)}<span><strong>${escHtml(nameOf(carry))}</strong> ${ui.carry.from ? 'share picked up' : 'picked up'}. ${ui.carry.from ? 'Choose where it goes, or the team list to take it off' : 'Choose a deliverable'}, or press Esc.</span></span>
      <button type="button" class="btn btn--ghost btn--sm" data-action="cancel-carry">Cancel</button>`
  }

  const view = ui.scope === 'plan' ? ui.view : 'table'
  const cards = view === 'cards'
  $('board').hidden = !cards
  $('boardTable').hidden = view !== 'table'
  $('boardMap').hidden = view !== 'map'
  if (view !== 'map') $('boardMap').innerHTML = ''
  if (view === 'map') { $('board').innerHTML = ''; $('boardTable').innerHTML = ''; renderMap(a); return }
  if (!cards) { $('board').innerHTML = ''; renderTable(a, flags); return }
  $('boardTable').innerHTML = ''

  const html = orderedDeliverables(state.doc.deliverables, a).map(d => {
    const da = a.deliverables.get(d.id)
    const st = deliverableStatus(d, da, a, state.doc)
    const name = d.name.trim() || 'Untitled deliverable'
    return `<article class="deliv deliv--${st.cls}${focused(d.id) ? ' is-focus' : ''}${carry ? ' is-target' : ''}" id="d-${d.id}" data-color="${boxColorOf(d)}"
        data-drop="deliverable" data-deliv="${d.id}" aria-label="${escHtml(name)}">
      <header class="deliv-head">
        <input class="deliv-name" data-field="name" data-id="${d.id}" data-key="dn-${d.id}" value="${escHtml(d.name)}"
          placeholder="Name this deliverable" aria-label="Deliverable name" maxlength="80">
        <button type="button" class="est${d.estimate ? '' : ' est--missing'}" data-action="estimate" data-id="${d.id}" data-key="de-${d.id}"
          aria-haspopup="dialog" aria-label="Estimate: ${d.estimate ? `${d.estimate} points` : 'not sized'}. Change">
          <span class="est-num">${d.estimate ?? '?'}</span><span class="est-unit">pts</span>
        </button>
      </header>
      <div class="deliv-planning">${priorityButton(d)}${progressButton(d)}${statusButton(d, st, da)}</div>
      ${meter(d, da)}
      <div class="deliv-timing">${timingButton(d, da)}</div>
      <ul class="shares" aria-label="People on ${escHtml(name)}">${d.members.map(m => share(d, m, a)).join('')}</ul>
      ${d.members.length ? '' : `<p class="drop-hint">${icon('circle-plus', { size: 14 })}Drop people here</p>`}
      ${dropButton(d, da, carry)}
      <footer class="deliv-foot">
        <span title="${d.estimate ? escHtml(needTitle(d, da, a)) : ''}">${d.estimate ? escHtml(need(d, da)) : 'Unsized'} · ${da.got} booked</span>
        <button type="button" class="icon-btn" data-action="card-menu" data-id="${d.id}" data-key="dm-${d.id}" aria-haspopup="dialog"
          aria-label="More for ${escHtml(name)}: priority, progress, note, Later, Done, remove" title="Priority, progress, note, Later, Done, remove">${icon('ellipsis')}</button>
      </footer>
    </article>`
  })

  if (!html.length && ui.personFilter) {
    html.push(filterEmpty())
  } else if (!html.length) {
    html.push(`<div class="board-empty">${icon('layout-grid', { size: 32 })}<h3>What is your team working on?</h3><p>Add a deliverable, give it an estimate, then assign people from your team. Capacity gaps will appear in Flags.</p><button type="button" class="btn btn--primary btn--sm" data-action="add-deliverable">${icon('plus', { size: 16 })}Add your first deliverable</button></div>`)
  } else {
    html.push(`<button type="button" class="deliv-add" data-action="add-deliverable">${icon('plus', { size: 20 })} Add deliverable</button>`)
  }
  $('board').innerHTML = html.join('')
}
