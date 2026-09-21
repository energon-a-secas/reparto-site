// ── Render: roster and deliverable cards ─────────────────────
// Both emit the drag contract dnd.js reads and nothing else:
//   data-drag="person" data-person [data-from=deliverable]   draggable
//   data-drop="deliverable" data-deliv | data-drop="roster"   drop target
// The table view (render-table.js) reuses share(), face() and badge(), so a
// row and a card read the same.

import { state, ui } from './state.js'
import { flagIndex, deliverableStatus, leaveLines } from './flags.js'
import { shareKey } from './capacity.js'
import { renderTable } from './render-table.js'
import { icon, STATUS_ICON } from './icons.js'
import { $, escHtml, initials, faceColor, plural, fmtPct } from './utils.js'

const focused = id => ui.focus?.ids.includes(id)
const nameOf = p => p?.name.trim() || 'Unnamed'
const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/** A face disc; a carried person wears a hand on it. */
export function face(p, sm = false, carried = false) {
  return `<span class="face${sm ? ' face--sm' : ''}${p.open ? ' face--open' : ''}" style="--face:${faceColor(p.id)}" aria-hidden="true">${escHtml(initials(p.name))}${carried ? `<span class="carry-mark">${icon('hand-grab', { size: sm ? 10 : 12 })}</span>` : ''}</span>`
}

export function badge(counts) {
  if (!counts) return ''
  const n = counts.error + counts.warn
  const lvl = counts.error ? 'error' : 'warn'
  return `<span class="fbadge fbadge--${lvl}" title="${plural(n, 'flag')}">${icon(lvl === 'error' ? 'octagon-alert' : 'triangle-alert', { size: 11, stroke: 2.5 })}${n}<span class="sr-only"> ${plural(n, 'flag')}</span></span>`
}

/** The status line: an icon per status, in the status colour, and the words. */
export function statusLine(st, tag = 'p') {
  return `<${tag} class="deliv-status status--${st.cls}">${icon(STATUS_ICON[st.cls], { size: 15, cls: 'status-icon', stroke: 2.2 })}<span>${escHtml(st.text)}</span></${tag}>`
}

/** What leave took from a short deliverable, when it took anything: the vacation that made it short. */
export function leaveLine(d, da) {
  if (!(da.gap > 0 && da.leavePts > 0)) return ''
  const lines = leaveLines(da, state.doc)
  return `<p class="deliv-leave" title="${escHtml(lines.join('; '))}">${icon('tree-palm', { size: 14 })}<span>${da.leavePts >= da.gap ? 'Short because of leave' : `${da.leavePts} of the gap is leave`}: ${escHtml(lines.join('; '))}</span></p>`
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
    const band = pa.free < 0 ? 'over' : pa.free === 0 && pa.cap ? 'full' : 'free'
    const bits = [
      p.role && escHtml(p.role),
      p.load < 100 && `${p.load}%`,
      p.sprintsOff && `<span class="bit">${icon('plane', { size: 12 })}${plural(p.sprintsOff, 'sprint')} away</span>`,
      pa.lost.vacation && `<span class="bit">${icon('tree-palm', { size: 12 })}${pa.lost.vacation}d vacation</span>`,
      countryTag(p),
    ].filter(Boolean).join(' · ')
    const carried = ui.carry?.person === p.id && !ui.carry.from
    const capIcon = band === 'over' ? icon('triangle-alert', { size: 11, stroke: 2.5 }) : band === 'full' ? icon('circle-check', { size: 11, stroke: 2.5 }) : ''
    return `<li class="person person--${band}${p.open ? ' person--open' : ''}${carried ? ' is-carried' : ''}${focused(p.id) ? ' is-focus' : ''}"
        id="p-${p.id}" data-drag="person" data-person="${p.id}" data-key="p-${p.id}" tabindex="0"
        aria-label="${escHtml(nameOf(p))}${p.open ? ', open role' : ''}${carried ? ', picked up' : ''}. ${fmtPct(pa.pct)} booked, ${pa.used} of ${pa.cap} points. Enter to pick up.">
      ${face(p, false, carried)}
      <span class="person-meta">
        <span class="person-line"><span class="person-name">${escHtml(nameOf(p))}</span>${badge(idx.get(p.id))}</span>
        <span class="person-role">${p.open ? `<span class="tag">${icon('user-search', { size: 10, stroke: 2.5 })}open role</span>` : ''}${bits || (p.open ? '' : '&nbsp;')}</span>
      </span>
      <span class="person-cap" title="${fmtPct(pa.pct)} of their time booked: ${pa.used} of ${pa.cap} pts (${fmt(pa.raw)} before rounding${pa.lost.holiday + pa.lost.team + pa.lost.vacation ? `, after ${pa.lost.holiday + pa.lost.team + pa.lost.vacation} days off` : ''})">
        <b>${Math.abs(pa.free)}</b><small>${capIcon}${pa.free < 0 ? 'over' : 'free'} of ${pa.cap}</small>
      </span>
      <button type="button" class="icon-btn" data-action="edit-person" data-id="${p.id}" data-key="pe-${p.id}" aria-label="Edit ${escHtml(nameOf(p))}">${icon('pencil')}</button>
      <span class="cap-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
    </li>`
  }).join('')
}

// ── Board ────────────────────────────────────────────────────
function meter(d, da) {
  if (!d.estimate) return '<div class="deliv-meter deliv-meter--unsized" aria-hidden="true"></div>'
  const top = Math.max(d.estimate, da.got)
  const got = (Math.min(da.got, d.estimate) / top) * 100
  const over = da.got > d.estimate ? ((da.got - d.estimate) / top) * 100 : 0
  return `<div class="deliv-meter" aria-hidden="true"><i class="m-got" style="width:${got}%"></i>${over ? `<i class="m-over" style="width:${over}%"></i>` : ''}</div>`
}

export function share(d, m, a) {
  const p = state.doc.people.find(x => x.id === m.person)
  if (!p) return ''
  const pa = a.people.get(p.id)
  const sh = a.shares.get(shareKey(d.id, p.id))
  const carried = ui.carry?.person === p.id && ui.carry.from === d.id
  return `<li class="share${p.open ? ' share--open' : ''}${pa.free < 0 ? ' share--over' : ''}${carried ? ' is-carried' : ''}"
      data-drag="person" data-person="${p.id}" data-from="${d.id}" data-key="s-${d.id}-${p.id}" tabindex="0"
      aria-label="${escHtml(nameOf(p))} gives ${fmtPct(sh.pct)} of their time, ${sh.points} points${carried ? ', picked up' : ''}. Enter to pick up and move.">
    ${face(p, true, carried)}
    <span class="share-name">${escHtml(nameOf(p))}</span>
    <button type="button" class="share-pts" data-action="points" data-id="${d.id}" data-person="${p.id}" data-key="sp-${d.id}-${p.id}"
      title="Change ${escHtml(nameOf(p))}'s share: ${fmtPct(sh.pct)} of their ${pa.cap} pts${sh.fixed ? ' (fixed points from an older plan)' : ''}"
      aria-label="${escHtml(nameOf(p))}: ${fmtPct(sh.pct)}, ${sh.points} points${sh.fixed ? ', fixed' : ''}. Change">${sh.fixed ? icon('pin', { size: 10, stroke: 2.5 }) : ''}${sh.points}<span class="share-pct">${fmtPct(sh.pct)}</span></button>
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
  const n = { plan: doc.deliverables.length, later: doc.backlog.filter(d => d.when === 'later').length, done: doc.backlog.filter(d => d.when === 'done').length }
  const scopes = [['plan', 'target', 'This plan'], ['later', 'calendar-clock', 'Later'], ['done', 'archive', 'Done']]
  const seg = (list, attr, cur) => list.map(([k, ic, label]) =>
    `<button type="button" class="seg-btn" data-action="${attr}" data-${attr}="${k}" data-key="${attr}-${k}" aria-pressed="${cur === k}">${icon(ic, { size: 15 })}${label}${attr === 'scope' ? ` <span class="chip-n">${n[k]}</span>` : ''}</button>`).join('')
  $('boardBar').innerHTML = `
    <div class="seg seg--sm" role="group" aria-label="Which deliverables">${seg(scopes, 'scope', ui.scope)}</div>
    ${ui.scope === 'plan' ? `<div class="seg seg--sm" role="group" aria-label="View">${seg([['cards', 'layout-grid', 'Cards'], ['table', 'table-2', 'Table']], 'view', ui.view)}</div>` : ''}`
  $('addDelivBtn').textContent = { plan: 'Add deliverable', later: 'Add to Later', done: 'Add to Done' }[ui.scope]
}

export function renderBoard(a, flags) {
  renderBar()
  const idx = flagIndex(flags)
  const carry = ui.carry && state.doc.people.find(p => p.id === ui.carry.person)
  const bar = $('carryBar')
  bar.hidden = !carry
  if (carry) {
    bar.innerHTML = `<span class="carry-who">${icon('hand-grab', { size: 18 })}${face(carry, true)}<span><strong>${escHtml(nameOf(carry))}</strong> ${ui.carry.from ? 'share picked up' : 'picked up'}. ${ui.carry.from ? 'Choose where it goes, or the team list to take it off' : 'Choose a deliverable'}, or press Esc.</span></span>
      <button type="button" class="btn btn--ghost btn--sm" data-action="cancel-carry">Cancel</button>`
  }

  const cards = ui.scope === 'plan' && ui.view === 'cards'
  $('board').hidden = !cards
  $('boardTable').hidden = cards
  // A table wants the width: the flags panel drops under it, with the flag bar above, as on a narrower screen.
  document.querySelector('.workspace').classList.toggle('is-wide', !cards)
  if (!cards) { $('board').innerHTML = ''; renderTable(a, flags); return }
  $('boardTable').innerHTML = ''

  const html = state.doc.deliverables.map(d => {
    const da = a.deliverables.get(d.id)
    const st = deliverableStatus(d, da, a, state.doc)
    const name = d.name.trim() || 'Untitled deliverable'
    return `<article class="deliv deliv--${st.cls}${focused(d.id) ? ' is-focus' : ''}${carry ? ' is-target' : ''}" id="d-${d.id}"
        data-drop="deliverable" data-deliv="${d.id}" aria-label="${escHtml(name)}">
      <header class="deliv-head">
        <input class="deliv-name" data-field="name" data-id="${d.id}" data-key="dn-${d.id}" value="${escHtml(d.name)}"
          placeholder="Name this deliverable" aria-label="Deliverable name" maxlength="80">
        ${badge(idx.get(d.id))}
        <button type="button" class="est${d.estimate ? '' : ' est--missing'}" data-action="estimate" data-id="${d.id}" data-key="de-${d.id}"
          aria-haspopup="dialog" aria-label="Estimate: ${d.estimate ? `${d.estimate} points` : 'not sized'}. Change">
          <span class="est-num">${d.estimate ?? '?'}</span><span class="est-unit">pts</span>
        </button>
      </header>
      ${meter(d, da)}
      ${statusLine(st)}
      ${leaveLine(d, da)}
      ${noteLine(d)}
      <ul class="shares" aria-label="People on ${escHtml(name)}">${d.members.map(m => share(d, m, a)).join('')}</ul>
      ${d.members.length ? '' : `<p class="drop-hint">${icon('circle-plus', { size: 14 })}Drop people here</p>`}
      ${dropButton(d, da, carry)}
      <footer class="deliv-foot">
        <span>${d.estimate ? `${fmt(d.estimate / (a.sprint || 1))} engineer-sprint${d.estimate === a.sprint ? '' : 's'}` : 'Unsized'} · ${da.got} booked</span>
        <button type="button" class="icon-btn" data-action="card-menu" data-id="${d.id}" data-key="dm-${d.id}" aria-haspopup="dialog"
          aria-label="More for ${escHtml(name)}: note, Later, Done, remove" title="Note, Later, Done, remove">${icon('ellipsis')}</button>
      </footer>
    </article>`
  })

  html.push(`<button type="button" class="deliv-add" data-action="add-deliverable">${icon('plus', { size: 20 })} Add deliverable</button>`)
  $('board').innerHTML = html.join('')
}
