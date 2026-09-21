// ── Render: roster and deliverable cards ─────────────────────
// Both emit the drag contract dnd.js reads and nothing else:
//   data-drag="person" data-person [data-from=deliverable]   draggable
//   data-drop="deliverable" data-deliv | data-drop="roster"   drop target

import { state, ui } from './state.js'
import { flagIndex, engineers } from './flags.js'
import { $, escHtml, initials, faceColor, plural } from './utils.js'

const X_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'
const EDIT_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>'
const TRASH_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>'

const focused = id => ui.focus?.ids.includes(id)
const nameOf = p => p?.name.trim() || 'Unnamed'

function face(p, sm = false) {
  return `<span class="face${sm ? ' face--sm' : ''}${p.open ? ' face--open' : ''}" style="--face:${faceColor(p.id)}" aria-hidden="true">${escHtml(initials(p.name))}</span>`
}

function badge(counts) {
  if (!counts) return ''
  const n = counts.error + counts.warn
  const lvl = counts.error ? 'error' : 'warn'
  return `<span class="fbadge fbadge--${lvl}" title="${plural(n, 'flag')}"><span aria-hidden="true">${counts.error ? '!' : '•'}</span>${n}<span class="sr-only"> ${plural(n, 'flag')}</span></span>`
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
  $('rosterList').innerHTML = people.map(p => {
    const pa = a.people.get(p.id)
    const pct = pa.cap ? Math.min(100, (pa.used / pa.cap) * 100) : 0
    const band = pa.free < 0 ? 'over' : pa.free === 0 && pa.cap ? 'full' : 'free'
    const bits = [p.role && escHtml(p.role), p.load < 100 && `${p.load}%`, p.sprintsOff && plural(p.sprintsOff, 'sprint') + ' away',
      pa.lost.vacation && `${pa.lost.vacation}d vacation`, p.country && p.country !== state.doc.settings.country && p.country].filter(Boolean).join(' · ')
    const carried = ui.carry?.person === p.id && !ui.carry.from
    return `<li class="person person--${band}${p.open ? ' person--open' : ''}${carried ? ' is-carried' : ''}${focused(p.id) ? ' is-focus' : ''}"
        id="p-${p.id}" data-drag="person" data-person="${p.id}" data-key="p-${p.id}" tabindex="0"
        aria-label="${escHtml(nameOf(p))}${p.open ? ', open role' : ''}. ${pa.used} of ${pa.cap} points booked. Enter to pick up.">
      <span class="face-wrap">${face(p)}${badge(idx.get(p.id))}</span>
      <span class="person-meta">
        <span class="person-name">${escHtml(nameOf(p))}${p.open ? '<span class="tag">open</span>' : ''}</span>
        <span class="person-role">${bits || '&nbsp;'}</span>
      </span>
      <span class="person-cap" title="${pa.used} booked of ${pa.cap} (${fmt(pa.raw)} before rounding${pa.lost.holiday + pa.lost.team + pa.lost.vacation ? `, after ${pa.lost.holiday + pa.lost.team + pa.lost.vacation} days off` : ''})">
        <b>${Math.abs(pa.free)}</b><small>${pa.free < 0 ? 'over' : 'free'} of ${pa.cap}</small>
      </span>
      <button type="button" class="icon-btn" data-action="edit-person" data-id="${p.id}" data-key="pe-${p.id}" aria-label="Edit ${escHtml(nameOf(p))}">${EDIT_ICON}</button>
      <span class="cap-bar" aria-hidden="true"><i style="width:${pct}%"></i></span>
    </li>`
  }).join('')
}

const fmt = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))

// ── Board ────────────────────────────────────────────────────
function status(d, da, a) {
  if (!d.estimate) return { cls: 'unsized', icon: '?', text: da.got ? `Unsized · ${da.got} pts booked` : 'Unsized: pick a Fibonacci size' }
  if (!d.members.length) return { cls: 'empty', icon: '!', text: `Nobody on it · needs ${d.estimate}` }
  if (da.gap > 0) return { cls: 'short', icon: '!', text: `Short ${da.gap} · ${engineers(da.gap, a.unit)}` }
  if (da.gap < 0) return { cls: 'over', icon: '↑', text: `${-da.gap} over the estimate` }
  return { cls: 'ok', icon: '✓', text: 'Staffed' }
}

function meter(d, da) {
  if (!d.estimate) return '<div class="deliv-meter deliv-meter--unsized" aria-hidden="true"></div>'
  const top = Math.max(d.estimate, da.got)
  const got = (Math.min(da.got, d.estimate) / top) * 100
  const over = da.got > d.estimate ? ((da.got - d.estimate) / top) * 100 : 0
  return `<div class="deliv-meter" aria-hidden="true"><i class="m-got" style="width:${got}%"></i>${over ? `<i class="m-over" style="width:${over}%"></i>` : ''}</div>`
}

function share(d, m, a) {
  const p = state.doc.people.find(x => x.id === m.person)
  if (!p) return ''
  const pa = a.people.get(p.id)
  const carried = ui.carry?.person === p.id && ui.carry.from === d.id
  return `<li class="share${p.open ? ' share--open' : ''}${pa.free < 0 ? ' share--over' : ''}${carried ? ' is-carried' : ''}"
      data-drag="person" data-person="${p.id}" data-from="${d.id}" data-key="s-${d.id}-${p.id}" tabindex="0"
      aria-label="${escHtml(nameOf(p))} gives ${m.points} points. Enter to pick up and move.">
    ${face(p, true)}
    <span class="share-name">${escHtml(nameOf(p))}</span>
    <button type="button" class="share-pts" data-action="points" data-id="${d.id}" data-person="${p.id}" data-key="sp-${d.id}-${p.id}"
      aria-label="${escHtml(nameOf(p))}: ${m.points} points. Change">${m.points}</button>
    <button type="button" class="share-x" data-action="unassign" data-id="${d.id}" data-person="${p.id}" aria-label="Take ${escHtml(nameOf(p))} off">${X_ICON}</button>
  </li>`
}

export function renderBoard(a, flags) {
  const idx = flagIndex(flags)
  const carry = ui.carry && state.doc.people.find(p => p.id === ui.carry.person)
  const bar = $('carryBar')
  bar.hidden = !carry
  if (carry) {
    bar.innerHTML = `<span><strong>${escHtml(nameOf(carry))}</strong> picked up. ${ui.carry.from ? 'Choose where the share goes' : 'Choose a deliverable'}, or press Esc.</span>
      <button type="button" class="btn btn--ghost btn--sm" data-action="cancel-carry">Cancel</button>`
  }

  const cards = state.doc.deliverables.map(d => {
    const da = a.deliverables.get(d.id)
    const st = status(d, da, a)
    const name = d.name.trim() || 'Untitled deliverable'
    const dropBtn = carry && ui.carry.from !== d.id
      ? `<button type="button" class="drop-btn" data-action="drop" data-id="${d.id}">${ui.carry.from ? 'Move' : 'Add'} ${escHtml(nameOf(carry))} here</button>` : ''
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
      <p class="deliv-status status--${st.cls}"><span class="status-icon" aria-hidden="true">${st.icon}</span>${st.text}</p>
      <ul class="shares" aria-label="People on ${escHtml(name)}">${d.members.map(m => share(d, m, a)).join('')}</ul>
      ${d.members.length ? '' : '<p class="drop-hint">Drop people here</p>'}
      ${dropBtn}
      <footer class="deliv-foot">
        <span>${d.estimate ? `${fmt(d.estimate / (a.sprint || 1))} engineer-sprints` : 'Unsized'} · ${da.got} booked</span>
        <button type="button" class="icon-btn" data-action="remove-deliverable" data-id="${d.id}" aria-label="Remove ${escHtml(name)}">${TRASH_ICON}</button>
      </footer>
    </article>`
  })

  cards.push(`<button type="button" class="deliv-add" data-action="add-deliverable">
    <span aria-hidden="true">+</span> Add deliverable</button>`)
  $('board').innerHTML = cards.join('')
}
