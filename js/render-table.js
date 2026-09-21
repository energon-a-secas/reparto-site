// ── Render: the deliverables as a table ──────────────────────
// The same deliverables, statuses and shares as the cards, one row each,
// with sortable columns and a totals row. A row keeps the drag contract (it
// is a drop target and its share chips drag), so drag, carry and every fix
// work here as on the cards. Later and Done list here too: no shares, their
// people named, and a way back into the plan.

import { state, ui } from './state.js'
import { flagIndex, deliverableStatus, engineers } from './flags.js'
import { share, face, badge, leaveLine, noteLine, dropButton } from './render-board.js'
import { icon, STATUS_ICON } from './icons.js'
import { $, escHtml, plural } from './utils.js'

// Worst first when sorted by status: what needs a person, then what needs a size, then risk.
const STATUS_ORDER = { empty: 0, short: 1, unsized: 2, risk: 3, over: 4, ok: 5 }

const nameInput = d => `<input class="deliv-name" data-field="name" data-id="${d.id}" data-key="dn-${d.id}" value="${escHtml(d.name)}"
  placeholder="Name this deliverable" aria-label="Deliverable name" maxlength="80">`
const estButton = d => `<button type="button" class="est est--sm${d.estimate ? '' : ' est--missing'}" data-action="estimate" data-id="${d.id}" data-key="de-${d.id}"
  aria-haspopup="dialog" aria-label="Estimate: ${d.estimate ? `${d.estimate} points` : 'not sized'}. Change"><span class="est-num">${d.estimate ?? '?'}</span></button>`
/** A status in a word or two, for the Status column; the full sentence is its title and, for a risk, a line under the name. */
function shortStatus(st, da) {
  const label = { ok: 'Staffed', short: `Short ${da.gap}`, over: `${-da.gap} over`, unsized: 'Unsized', empty: 'Nobody on it', risk: 'At risk' }[st.cls]
  return `<div class="deliv-status status--${st.cls}" title="${escHtml(st.text)}">${icon(STATUS_ICON[st.cls], { size: 15, cls: 'status-icon', stroke: 2.2 })}<span>${label}</span><span class="sr-only">: ${escHtml(st.text)}</span></div>`
}

const menuButton = (d, name) => `<button type="button" class="icon-btn" data-action="card-menu" data-id="${d.id}" data-key="dm-${d.id}" aria-haspopup="dialog"
  aria-label="More for ${escHtml(name)}: note, Later, Done, remove" title="Note, Later, Done, remove">${icon('ellipsis')}</button>`

function sortHead(key, label, cls = '') {
  const on = ui.sort.key === key
  const dir = on ? (ui.sort.dir === 1 ? 'ascending' : 'descending') : 'none'
  return `<th scope="col" class="${cls}" aria-sort="${dir}"><button type="button" class="th-sort" data-action="sort" data-sort="${key}" data-key="sort-${key}">${label}${icon(on ? (ui.sort.dir === 1 ? 'chevron-up' : 'chevron-down') : 'arrow-up-down', { size: 12, cls: on ? '' : 'th-idle' })}</button></th>`
}

export function renderTable(a, flags) {
  if (ui.scope !== 'plan') { renderBacklog(); return }
  const doc = state.doc
  const idx = flagIndex(flags)
  const carry = ui.carry && doc.people.find(p => p.id === ui.carry.person)
  const rows = doc.deliverables.map((d, i) => {
    const da = a.deliverables.get(d.id)
    return { d, da, st: deliverableStatus(d, da, a, doc), i }
  })
  const { key, dir } = ui.sort
  const by = {
    status: r => STATUS_ORDER[r.st.cls],
    name: r => r.d.name.trim().toLowerCase(),
    estimate: r => r.d.estimate ?? -1,
    booked: r => r.da.got,
    gap: r => r.da.gap,
    people: r => r.d.members.length,
  }[key]
  if (by) rows.sort((x, y) => { const p = by(x), q = by(y); return (p < q ? -1 : p > q ? 1 : x.i - y.i) * dir })

  const unit = a.bookable || a.unit
  const body = rows.map(({ d, da, st }) => {
    const name = d.name.trim() || 'Untitled deliverable'
    const gap = !d.estimate ? '' : da.gap > 0 ? `<span class="error-text">${da.gap}</span>` : da.gap < 0 ? `<span class="warn-text">+${-da.gap}</span>` : '0'
    return `<tr class="trow trow--${st.cls}${ui.focus?.ids.includes(d.id) ? ' is-focus' : ''}${carry ? ' is-target' : ''}" id="d-${d.id}" data-drop="deliverable" data-deliv="${d.id}">
      <td class="t-status">${shortStatus(st, da)}</td>
      <td class="t-name">${nameInput(d)}${st.risk ? `<p class="t-why status--risk">${escHtml(st.text)}</p>` : ''}${noteLine(d, 't-note')}${leaveLine(d, da, a)}</td>
      <td class="num">${estButton(d)}</td>
      <td class="num">${da.got}</td>
      <td class="num" title="${da.gap > 0 ? escHtml(engineers(da.gap, unit)) : ''}">${gap}</td>
      <td class="t-people"><ul class="shares" aria-label="People on ${escHtml(name)}">${d.members.map(m => share(d, m, a)).join('')}</ul>${d.members.length ? '' : '<span class="t-empty">Nobody yet</span>'}${dropButton(d, da, carry)}</td>
      <td class="t-actions">${badge(idx.get(d.id))}${menuButton(d, name)}</td>
    </tr>`
  }).join('')

  $('boardTable').innerHTML = doc.deliverables.length ? `
    <table class="dtable">
      <caption class="sr-only">This plan's deliverables${key ? `, sorted by ${key}` : ''}</caption>
      <thead><tr>
        ${sortHead('status', 'Status')}${sortHead('name', 'Deliverable')}${sortHead('estimate', 'Estimate', 'num')}${sortHead('booked', 'Booked', 'num')}${sortHead('gap', 'Short', 'num')}${sortHead('people', 'People')}
        <th scope="col"><span class="sr-only">Flags and actions</span></th>
      </tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr>
        <th scope="row" colspan="2">${plural(doc.deliverables.length, 'deliverable')}${a.unsized ? ` · <span class="warn-text">${a.unsized} unsized</span>` : ''}</th>
        <td class="num">${a.demand}</td><td class="num">${a.allocated}</td><td class="num">${a.shortfall ? `<span class="error-text">${a.shortfall}</span>` : '0'}</td>
        <td colspan="2">${a.capacity} pts of capacity · ${a.free} free${a.over ? ` · <span class="error-text">${a.over} over-booked</span>` : ''}</td>
      </tr></tfoot>
    </table>`
    : `<p class="t-none">${icon('circle-plus')}No deliverables in this plan yet. <button type="button" class="panel-link" data-action="add-deliverable">Add one</button></p>`
}

/** Later and Done: what left the plan, with its people named and a way back. */
function renderBacklog() {
  const doc = state.doc
  const when = ui.scope
  const list = doc.backlog.filter(d => d.when === when)
  const nameOf = id => doc.people.find(p => p.id === id)
  const lead = when === 'later'
    ? 'Deliverables for a later plan. They keep their size and their people but count toward nothing here.'
    : 'Deliverables already shipped. Kept for the record; they count toward nothing here.'
  if (!list.length) {
    $('boardTable').innerHTML = `<p class="t-lead">${icon(STATUS_ICON[when], { size: 15 })}${lead}</p>
      <p class="t-none">Nothing here yet. Use the <span class="t-inline">${icon('ellipsis', { size: 14 })}</span> on a deliverable to move it ${when === 'later' ? 'to Later' : 'to Done'}, or <button type="button" class="panel-link" data-action="add-deliverable">add one</button>.</p>`
    return
  }
  $('boardTable').innerHTML = `<p class="t-lead">${icon(STATUS_ICON[when], { size: 15 })}${lead}</p>
    <table class="dtable dtable--backlog">
      <caption class="sr-only">${when === 'later' ? 'Later' : 'Done'}</caption>
      <thead><tr><th scope="col">Deliverable</th><th scope="col" class="num">Estimate</th><th scope="col">People</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
      <tbody>${list.map(d => {
        const name = d.name.trim() || 'Untitled deliverable'
        const people = d.members.map(m => nameOf(m.person)).filter(Boolean)
        return `<tr class="trow trow--${when}${ui.focus?.ids.includes(d.id) ? ' is-focus' : ''}" id="d-${d.id}">
          <td class="t-name">${nameInput(d)}${noteLine(d, 't-note')}</td>
          <td class="num">${estButton(d)}</td>
          <td class="t-people">${people.length ? `<span class="t-faces">${people.map(p => `${face(p, true)}<span>${escHtml(p.name.trim() || 'Unnamed')}</span>`).join('')}</span>` : '<span class="t-empty">Nobody</span>'}</td>
          <td class="t-actions">
            <button type="button" class="btn btn--ghost btn--sm" data-action="move-deliverable" data-id="${d.id}" data-when="plan">${icon('rotate-ccw', { size: 14 })}Back into this plan</button>
            ${menuButton(d, name)}
          </td>
        </tr>`
      }).join('')}</tbody>
    </table>`
}
