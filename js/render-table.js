// ── Render: the deliverables as a table ──────────────────────
// The same deliverables, statuses and shares as the cards, one row each,
// with sortable columns and a totals row. A row keeps the drag contract (it
// is a drop target and its share chips drag), so drag, carry and every fix
// work here as on the cards. Later and Done list here too: no shares, their
// people named, and a way back into the plan.

import { state, ui } from './state.js'
import { deliverableStatus, engineers, landingText } from './flags.js'
import { share, noteLine, dropButton, statusButton, orderedDeliverables, filterEmpty, priorityButton, progressButton, timingButton } from './render-board.js'
import { icon, STATUS_ICON } from './icons.js'
import { boxColorOf } from './planning.js'
import { $, escHtml, plural } from './utils.js'

const nameInput = d => `<input class="deliv-name" data-field="name" data-id="${d.id}" data-key="dn-${d.id}" value="${escHtml(d.name)}"
  placeholder="Name this deliverable" aria-label="Deliverable name" maxlength="80">`
const estButton = d => `<button type="button" class="est est--sm${d.estimate ? '' : ' est--missing'}" data-action="estimate" data-id="${d.id}" data-key="de-${d.id}"
  aria-haspopup="dialog" aria-label="Estimate: ${d.estimate ? `${d.estimate} points` : 'not sized'}. Change"><span class="est-num">${d.estimate ?? '?'}</span></button>`

const menuButton = (d, name) => `<button type="button" class="icon-btn" data-action="card-menu" data-id="${d.id}" data-key="dm-${d.id}" aria-haspopup="dialog"
  aria-label="More for ${escHtml(name)}: priority, progress, note, Later, Done, remove" title="Priority, progress, note, Later, Done, remove">${icon('ellipsis')}</button>`

function sortHead(key, label, cls = '') {
  const on = ui.sort.key === key
  const dir = on ? (ui.sort.dir === 1 ? 'ascending' : 'descending') : 'none'
  return `<th scope="col" class="${cls}" aria-sort="${dir}"><button type="button" class="th-sort" data-action="sort" data-sort="${key}" data-key="sort-${key}">${label}${icon(on ? (ui.sort.dir === 1 ? 'chevron-up' : 'chevron-down') : 'arrow-up-down', { size: 12, cls: on ? '' : 'th-idle' })}</button></th>`
}

export function renderTable(a, flags) {
  if (ui.scope !== 'plan') { renderBacklog(); return }
  const doc = state.doc
  const carry = ui.carry && doc.people.find(p => p.id === ui.carry.person)
  const visible = orderedDeliverables(doc.deliverables, a)
  const rows = visible.map((d, i) => {
    const da = a.deliverables.get(d.id)
    return { d, da, st: deliverableStatus(d, da, a, doc), i }
  })
  const { key } = ui.sort

  const unit = a.bookable || a.unit
  const body = rows.map(({ d, da, st }) => {
    const name = d.name.trim() || 'Untitled deliverable'
    const gap = !d.estimate ? '' : da.gap > 0 ? `<span class="error-text">${da.gap}</span>` : da.gap < 0 ? `<span class="warn-text">+${-da.gap}</span>` : '0'
    return `<tr class="trow trow--${st.cls}${ui.focus?.ids.includes(d.id) ? ' is-focus' : ''}${carry ? ' is-target' : ''}" id="d-${d.id}" data-color="${boxColorOf(d)}" data-drop="deliverable" data-deliv="${d.id}">
      <td class="t-name">${nameInput(d)}</td>
      <td class="t-status"><div class="table-status">${progressButton(d)}${statusButton(d, st, da)}</div></td>
      <td class="t-priority">${priorityButton(d)}</td>
      <td class="num">${estButton(d)}</td>
      <td class="num">${da.got}</td>
      <td class="num" title="${da.gap > 0 ? escHtml(engineers(da.gap, da.unitWindow || unit)) : ''}">${gap}</td>
      <td class="t-when">${timingButton(d, da, { compact: true })}</td>
      <td class="t-lands">${landsCell(da)}</td>
      <td class="t-people"><ul class="shares" aria-label="People on ${escHtml(name)}">${d.members.map(m => share(d, m, a, true)).join('')}</ul>${d.members.length ? '' : '<span class="t-empty">Nobody yet</span>'}${dropButton(d, da, carry)}</td>
      <td class="t-actions">${menuButton(d, name)}</td>
    </tr>`
  }).join('')

  $('boardTable').innerHTML = !visible.length && ui.personFilter ? filterEmpty() : doc.deliverables.length ? `
    <table class="dtable">
      <caption class="sr-only">This plan's deliverables${key ? `, sorted by ${key}` : ''}</caption>
      <thead><tr>
        ${sortHead('name', 'Deliverable')}${sortHead('progress', 'Status', 't-status')}${sortHead('priority', 'Priority', 't-priority')}${sortHead('estimate', 'Estimate', 'num')}${sortHead('booked', 'Booked', 'num')}${sortHead('gap', 'Short', 'num')}${sortHead('when', 'When', 't-when')}${sortHead('lands', 'Lands', 't-lands')}${sortHead('people', 'People')}
        <th scope="col"><span class="sr-only">Actions</span></th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <th scope="row" colspan="3">${ui.personFilter ? 'Whole plan · ' : ''}${plural(doc.deliverables.length, 'deliverable')}${a.unsized ? ` · <span class="warn-text">${a.unsized} unsized</span>` : ''}</th>
        <td class="num">${a.demand}</td><td class="num">${a.allocated}</td><td class="num">${a.shortfall ? `<span class="error-text">${a.shortfall}</span>` : '0'}</td>
        <td colspan="2">${lastLanding(a)}</td>
        <td colspan="2">${a.capacity} pts of capacity · ${a.free} free${a.over ? ` · <span class="error-text">${a.over} over-booked</span>` : ''}</td>
      </tr></tfoot>
    </table>`
    : `<p class="t-none">${icon('circle-plus')}No deliverables in this plan yet. <button type="button" class="panel-link" data-action="add-deliverable">Add one</button></p>`
}

/** The estimated completion date: on time, after its sprints, or after the plan, each read differently. */
function landsCell(da) {
  const lt = landingText(da.lands, state.doc.settings, da.span)
  const tone = !lt.date ? 'lands--none' : !lt.late ? 'lands--ok' : lt.afterPlan ? 'lands--late' : 'lands--slip'
  return `<span class="lands ${tone}" title="${escHtml(lt.text)}">${lt.date ? icon('diamond', { size: 11 }) : ''}${escHtml(lt.short)}</span>`
}

/** The totals row's date: when the last dated deliverable lands. */
function lastLanding(a) {
  let last = null, late = false
  for (const da of a.deliverables.values()) {
    const d = da.lands?.date
    if (d && (!last || d > last)) { last = d; late = !!da.lands.afterPlan }
  }
  return last ? `Last lands ${escHtml(landingText({ kind: 'on-time', date: last, sprint: 0 }, state.doc.settings).short)}${late ? ' <span class="error-text">(after the plan)</span>' : ''}` : ''
}

/** Later and Done: what left the plan, with its people named and a way back. */
function renderBacklog() {
  const doc = state.doc
  const when = ui.scope
  const list = orderedDeliverables(doc.backlog.filter(d => d.when === when))
  const nameOf = id => doc.people.find(p => p.id === id)
  const lead = when === 'later'
    ? 'Deliverables for a later plan. They keep their size and their people but count toward nothing here.'
    : 'Deliverables already shipped. Kept for the record; they count toward nothing here.'
  if (!list.length && ui.personFilter) { $('boardTable').innerHTML = filterEmpty(); return }
  if (!list.length) {
    $('boardTable').innerHTML = `<p class="t-lead">${icon(STATUS_ICON[when], { size: 15 })}${lead}</p>
      <p class="t-none">Nothing here yet. Use the <span class="t-inline">${icon('ellipsis', { size: 14 })}</span> on a deliverable to move it ${when === 'later' ? 'to Later' : 'to Done'}, or <button type="button" class="panel-link" data-action="add-deliverable">add one</button>.</p>`
    return
  }
  $('boardTable').innerHTML = `<p class="t-lead">${icon(STATUS_ICON[when], { size: 15 })}${lead}</p>
    <table class="dtable dtable--backlog">
      <caption class="sr-only">${when === 'later' ? 'Later' : 'Done'}</caption>
      <thead><tr>${sortHead('name', 'Deliverable')}${sortHead('progress', 'Status', 't-status')}${sortHead('priority', 'Priority', 't-priority')}<th scope="col" class="num">Estimate</th><th scope="col">People</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map(d => {
        const name = d.name.trim() || 'Untitled deliverable'
        const people = d.members.map(m => nameOf(m.person)).filter(Boolean)
        return `<tr class="trow trow--${when}${ui.focus?.ids.includes(d.id) ? ' is-focus' : ''}" id="d-${d.id}" data-color="${boxColorOf(d)}">
          <td class="t-name">${nameInput(d)}${noteLine(d, 't-note')}</td>
          <td class="t-status">${progressButton(d)}</td>
          <td class="t-priority">${priorityButton(d)}</td>
          <td class="num">${estButton(d)}</td>
          <td class="t-people">${people.length ? `<span class="t-faces">${people.map(p => `<span class="backlog-person">${escHtml(p.name.trim() || 'Unnamed')}</span>`).join('')}</span>` : '<span class="t-empty">Nobody</span>'}</td>
          <td class="t-actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="move-deliverable" data-id="${d.id}" data-when="plan">${icon('rotate-ccw', { size: 14 })}Back into this plan</button>
            ${menuButton(d, name)}
          </td>
        </tr>`
      }).join('')}</tbody>
    </table>`
}
