// ── Popovers: size a deliverable, change a share ─────────────
// One element (#pop), anchored under the control that opened it. The anchor
// is remembered by data-key, not by node, because every change re-renders.

import { state, snapshot, deliverable, findDeliverable, person, updateDeliverable, setShare } from './state.js'
import { SCALE, fibCeil, analyze, shareKey, pctForPoints, PCT_MIN, PCT_MAX } from './capacity.js'
import { engineers } from './flags.js'
import { cal } from './holidays.js'
import { afterChange } from './render.js'
import { moveTo, removeDeliverablePinned, unassignPinned, saveDeliverableDetails } from './actions.js'
import { PRIORITIES, PROGRESS, BOX_COLORS, priorityOf, progressOf, priorityColorOf } from './planning.js'
import { icon } from './icons.js'
import { $, escHtml, showToast, fmtPct } from './utils.js'

let anchorKey = null

/** The data-key of the control the open popover belongs to, or null. */
export const popAnchor = () => ($('pop').hidden ? null : anchorKey)

export function closePop({ restore = true } = {}) {
  const pop = $('pop')
  if (pop.hidden) return false
  pop.hidden = true
  pop.innerHTML = ''
  if (restore && anchorKey) document.querySelector(`[data-key="${anchorKey}"]`)?.focus({ preventScroll: true })
  anchorKey = null
  return true
}

/** Follow the anchor while the page scrolls; close once it leaves the viewport. */
export function repositionPop() {
  if ($('pop').hidden || !anchorKey) return
  const anchor = document.querySelector(`[data-key="${anchorKey}"]`)
  const r = anchor?.getBoundingClientRect()
  if (!r || r.bottom < 0 || r.top > window.innerHeight) { closePop({ restore: false }); return }
  place(anchor)
}

function place(anchor) {
  const pop = $('pop')
  pop.hidden = false
  const r = anchor.getBoundingClientRect()
  const w = pop.offsetWidth, h = pop.offsetHeight
  const vw = document.documentElement.clientWidth, vh = window.innerHeight
  let top = r.bottom + 8
  if (top + h > vh - 8 && r.top - h - 8 > 8) top = r.top - h - 8
  const left = Math.min(Math.max(8, r.right - w), vw - w - 8)
  // A phone may have too little room on either side of the anchor. Keep the
  // picker in the viewport; its body scrolls when the viewport is shorter.
  pop.style.top = `${Math.max(8, Math.min(top, vh - h - 8))}px`
  pop.style.left = `${left}px`
}

function open(key, html, label, focus = '') {
  const anchor = document.querySelector(`[data-key="${key}"]`)
  if (!anchor) return null
  anchorKey = key
  const pop = $('pop')
  pop.setAttribute('aria-label', label)
  pop.innerHTML = html
  place(anchor)
  ;((focus && pop.querySelector(focus)) || pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button, input'))?.focus({ preventScroll: true })
  return pop
}

// Tab past either end of the popover closes it and puts focus back on the control that opened it,
// so the next Tab carries on from there instead of jumping to the footer with the popover left open.
function bindEdges() {
  const pop = $('pop')
  pop.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || pop.hidden) return
    const all = [...pop.querySelectorAll('button, input, textarea, select')].filter(el => !el.disabled && el.getClientRects().length)
    if (!all.length) return
    if ((!e.shiftKey && document.activeElement === all[all.length - 1]) || (e.shiftKey && document.activeElement === all[0])) {
      e.preventDefault()
      closePop()
    }
  })
}
bindEdges()

const head = title => `<div class="pop-head"><strong>${escHtml(title)}</strong>
  <button type="button" class="icon-btn" data-pop="close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`

// ── Estimate ─────────────────────────────────────────────────
export function openEstimate(delivId) {
  const d = findDeliverable(delivId); if (!d) return
  const s = state.doc.settings
  const scale = [null, ...SCALE].map(v =>
    `<button type="button" class="scale-btn" data-pick="${v ?? ''}" aria-pressed="${d.estimate === v}" aria-label="${v ? `${v} points` : 'Unsized'}">${v ?? '?'}</button>`
  ).join('')
  const pop = open(`de-${delivId}`, `${head(d.name.trim() || 'Size this deliverable')}
    <div class="scale" role="group" aria-label="Fibonacci scale">${scale}</div>
    <div class="pop-calc">
      <p class="pop-label">Or work it out, then round up</p>
      <div class="pop-row">
        <input class="field field--num" type="number" min="0" max="20" step="0.5" value="1" data-in="eng" aria-label="Engineers">
        <span>engineers ×</span>
        <input class="field field--num" type="number" min="0" max="13" step="1" value="${s.sprints}" data-in="spr" aria-label="Sprints">
        <span>sprints</span>
        <output data-out="team"></output>
      </div>
      <div class="pop-row">
        <input class="field field--num" type="number" min="0" max="400" step="1" value="" placeholder="0" data-in="days" aria-label="Focus days">
        <span>focus days</span>
        <output data-out="days"></output>
      </div>
    </div>
    <p class="pop-note">An estimate rounds up: when the team is unsure, the bigger number is the honest one.</p>`,
  'Size the deliverable')
  if (!pop) return
  const a = analyze(state.doc, cal)
  const recalc = () => {
    const eng = Number(pop.querySelector('[data-in="eng"]').value) || 0
    const spr = Number(pop.querySelector('[data-in="spr"]').value) || 0
    const days = Number(pop.querySelector('[data-in="days"]').value) || 0
    suggest(pop.querySelector('[data-out="team"]'), eng * spr * a.sprint, a.bookable)
    suggest(pop.querySelector('[data-out="days"]'), days * s.pointsPerDay, a.bookable)
    repositionPop() // Suggestions can add rows after the picker was measured.
  }
  pop.querySelectorAll('[data-in]').forEach(i => i.addEventListener('input', recalc))
  recalc()
  pop.onclick = e => {
    if (e.target.closest('[data-pop="close"]')) { closePop(); return }
    const b = e.target.closest('[data-pick]'); if (!b) return
    const v = b.dataset.pick ? Number(b.dataset.pick) : null
    closePop({ restore: false })
    if (v === d.estimate) return
    snapshot(); updateDeliverable(delivId, { estimate: v }); afterChange()
    document.querySelector(`[data-key="de-${delivId}"]`)?.focus({ preventScroll: true })
    showToast(v ? `${d.name || 'Deliverable'} sized ${v}` : `${d.name || 'Deliverable'} marked unsized`)
  }
}

/** The rounded-up suggestion, and what it asks of the team in engineers at one plan each. */
function suggest(out, raw, unit) {
  const f = fibCeil(raw)
  const fits = SCALE.includes(f)
  out.innerHTML = raw > 0
    ? `= ${Number.isInteger(raw) ? raw : raw.toFixed(1)} → ${fits ? `<button type="button" class="scale-btn scale-btn--suggest" data-pick="${f}">${f}</button><span class="pop-eng">· ${engineers(f, unit)}${f / unit >= 0.95 && f / unit < 1.05 ? '' : ` at ${unit}`}</span>` : `<span class="warn-text">${f}, off the scale: split it</span>`}`
    : ''
}

// ── Share ────────────────────────────────────────────────────
// A share is a percentage of the person's capacity; points follow from it.
// The picker speaks percent first (how people split their week) and keeps an
// exact-points escape for "Ana gives this exactly 8".
const PCTS = [10, 20, 25, 33, 50, 67, 75, 100]

export function openShare(delivId, personId) {
  const d = deliverable(delivId), p = person(personId)
  if (!d?.members.some(x => x.person === personId) || !p) return
  const a = analyze(state.doc, cal)
  const pa = a.people.get(personId), da = a.deliverables.get(delivId)
  const sh = a.shares.get(shareKey(delivId, personId))
  const who = p.name.trim() || 'Unnamed'
  const freePct = Math.max(0, 100 - pa.pct)
  const quick = []
  // Only offer what the person has: covering a gap by over-booking them is not a fix.
  if (da.gap > 0 && pa.free > 0) {
    const pts = sh.points + Math.min(da.gap, pa.free)
    quick.push(`<button type="button" class="chip-btn" data-pct="${pctForPoints(state.doc, cal, delivId, personId, pts)}">${pa.free >= da.gap ? 'Cover the gap' : 'Cover what they can'}: ${pts} pts</button>`)
  }
  if (freePct > 0.5 && pa.free !== da.gap) quick.push(`<button type="button" class="chip-btn" data-pct="${Math.round((sh.pct + freePct) * 100) / 100}">All their free time: ${fmtPct(sh.pct + freePct)}</button>`)
  const pop = open(`sp-${delivId}-${personId}`, `${head(`${who} on ${d.name.trim() || 'this deliverable'}`)}
    <p class="pop-label">Share of ${escHtml(who)}'s ${pa.cap} pts</p>
    <div class="scale" role="group" aria-label="Percent of their ${pa.cap} points">${PCTS.map(v =>
      `<button type="button" class="scale-btn" data-pct="${v}" aria-pressed="${Math.round(sh.pct) === v}">${v}%</button>`).join('')}</div>
    <div class="pop-row">
      <input class="field field--num" id="popPct" type="number" min="${PCT_MIN}" max="${PCT_MAX}" step="any" value="${Math.round(sh.pct * 100) / 100}" aria-label="Percent">
      <span>%</span>
      <button type="button" class="btn btn--secondary btn--sm" data-pct="exact">Set</button>
      <span class="pop-or">or</span>
      <input class="field field--num" id="popPts" type="number" min="1" max="999" step="1" value="${sh.points}" aria-label="Points now, kept as a percentage">
      <span>pts now</span>
      <button type="button" class="btn btn--secondary btn--sm" data-pct="points">Set</button>
    </div>
    ${quick.length ? `<div class="pop-row pop-row--wrap">${quick.join('')}</div>` : ''}
    <p class="pop-note">${fmtPct(sh.pct)} of ${escHtml(who)}'s ${pa.cap} pts is <strong>${sh.points} pts</strong> here, and moves with their capacity. Across everything: ${fmtPct(pa.pct)}${pa.free < 0 ? `, ${-pa.free} pts over` : `, ${pa.free} pts free`}. ${d.estimate ? `The deliverable needs ${d.estimate}, has ${da.got}.` : 'The deliverable is not sized yet.'}${sh.fixed ? ' This share is fixed points from an older plan; setting it makes it a percentage.' : ''}</p>
    <button type="button" class="btn btn--ghost btn--sm btn--block" data-pct="remove">Take ${escHtml(who)} off</button>`,
  'Change the share')
  if (!pop) return
  const enter = (id, act) => pop.querySelector(id).addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pop.querySelector(`[data-pct="${act}"]`).click() } })
  enter('#popPct', 'exact'); enter('#popPts', 'points')
  pop.onclick = e => {
    if (e.target.closest('[data-pop="close"]')) { closePop(); return }
    const b = e.target.closest('[data-pct]'); if (!b) return
    const raw = b.dataset.pct
    if (raw === 'remove') {
      closePop({ restore: false })
      if (unassignPinned(delivId, personId)) showToast(`${who} taken off ${d.name || 'the deliverable'}`)
      return
    }
    // A share is stored between PCT_MIN and PCT_MAX of their capacity: say so rather than clamp in silence.
    const most = Math.floor((pa.cap * PCT_MAX) / 100)
    let v
    if (raw === 'exact') v = Number(pop.querySelector('#popPct').value)
    else if (raw === 'points') {
      const pts = Math.round(Number(pop.querySelector('#popPts').value))
      if (!(pts >= 1)) { showToast('A share is at least 1 point'); return }
      if (!pa.cap) { showToast(`${who} has no capacity in this plan, so points cannot be split`); return }
      if (pts > most) { showToast(`A share is at most ${PCT_MAX}% of ${who}'s ${pa.cap} pts: ${most} pts`); return }
      v = pctForPoints(state.doc, cal, delivId, personId, pts)
    } else v = Number(raw)
    if (!(v >= PCT_MIN)) { showToast(`A share is at least ${PCT_MIN}%`); return }
    if (v > PCT_MAX) { showToast(`A share is at most ${PCT_MAX}% of ${who}'s capacity`); return }
    closePop({ restore: false })
    if (!sh.fixed && Math.abs(v - sh.pct) < 0.005) return
    snapshot(); setShare(delivId, personId, v); afterChange()
    document.querySelector(`[data-key="sp-${delivId}-${personId}"]`)?.focus({ preventScroll: true })
  }
}

// ── A deliverable's menu: planning fields, note and moves ───
// Later (a future plan) and Done (shipped) keep the deliverable and its
// people but take it out of every number; bringing it back restores them.
export function openCardMenu(delivId, { anchor = `dm-${delivId}`, focus = 'priority' } = {}) {
  const d = findDeliverable(delivId); if (!d) return
  const where = deliverable(delivId) ? 'plan' : d.when
  const name = d.name.trim() || 'Untitled deliverable'
  const moves = [
    where !== 'plan' && ['plan', 'rotate-ccw', 'Back into this plan'],
    where !== 'later' && ['later', 'calendar-clock', 'Move to Later'],
    where !== 'done' && ['done', 'archive', 'Mark as done'],
  ].filter(Boolean)
  const pop = open(anchor, `${head(name)}
    <div class="pop-planning-fields">
      <label class="pop-label" for="popPriority">Priority<select class="field" id="popPriority">${Object.entries(PRIORITIES).map(([key, value]) => `<option value="${key}"${priorityOf(d) === key ? ' selected' : ''}>${value.label}${key === 'p1' ? ' · Highest' : key === 'p6' ? ' · Lowest' : ''}</option>`).join('')}</select></label>
      <label class="pop-label" for="popProgress">Progress<select class="field" id="popProgress">${Object.entries(PROGRESS).map(([key, value]) => `<option value="${key}"${progressOf(d) === key ? ' selected' : ''}>${value.label}</option>`).join('')}</select></label>
    </div>
    <fieldset class="priority-colors"><legend class="pop-label">Box color</legend><div class="priority-swatches">${[['', 'Automatic: follow priority'], ...Object.entries(BOX_COLORS)].map(([key, label]) => `<label class="priority-choice" data-color="${key || priorityColorOf(d)}" title="${label}"><input type="radio" name="popBoxColor" value="${key}"${(d.boxColor ?? d.priorityColor ?? '') === key ? ' checked' : ''} aria-label="${label}"><span aria-hidden="true">${key ? '' : icon('rotate-ccw', { size: 14 })}</span></label>`).join('')}</div><p class="color-hint">Automatic follows priority. Badge colors stay fixed.</p></fieldset>
    <label class="pop-label" for="popNote">Note</label>
    <textarea class="field field--area" id="popNote" rows="3" maxlength="400" placeholder="Scope, a link, who asked for it">${escHtml(d.note)}</textarea>
    <div class="pop-row"><button type="button" class="btn btn--primary btn--sm" data-menu="note">Save changes</button><span class="pop-count" id="popNoteCount">${d.note.length}/400</span></div>
    <div class="pop-actions" role="group" aria-label="Move or remove">
      ${moves.map(([w, ic, label]) => `<button type="button" class="pop-action" data-menu="move" data-when="${w}">${icon(ic)}${label}</button>`).join('')}
      <button type="button" class="pop-action pop-action--danger" data-menu="remove">${icon('trash-2')}Remove</button>
    </div>
    <p class="pop-note">${where === 'plan' ? 'Progress tracks work; it does not change capacity. Done moves this deliverable to Done and frees its planned points.' : where === 'done' ? 'Choose an active progress state to return this deliverable to the plan with its people.' : 'Later keeps its people without counting their points. Bring it back when you are ready to plan it.'}</p>`,
  `${name}: priority, progress and details`, focus === 'progress' ? '#popProgress' : '#popPriority')
  if (!pop) return
  const note = pop.querySelector('#popNote')
  pop.querySelector('#popPriority').addEventListener('change', e => {
    pop.querySelector('.priority-choice').dataset.color = PRIORITIES[e.target.value].color
  })
  note.addEventListener('input', () => { pop.querySelector('#popNoteCount').textContent = `${note.value.length}/400` })
  note.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); pop.querySelector('[data-menu="note"]').click() } })
  pop.onclick = e => {
    if (e.target.closest('[data-pop="close"]')) { closePop(); return }
    const b = e.target.closest('[data-menu]'); if (!b) return
    if (b.dataset.menu === 'note') {
      const fields = { note: note.value, priority: pop.querySelector('#popPriority').value, progress: pop.querySelector('#popProgress').value, boxColor: pop.querySelector('[name="popBoxColor"]:checked').value }
      closePop()
      saveDeliverableDetails(delivId, fields)
      return
    }
    closePop({ restore: false })
    if (b.dataset.menu === 'move') moveTo(delivId, b.dataset.when)
    else if (b.dataset.menu === 'remove' && removeDeliverablePinned(delivId)) showToast(`Removed ${name}. Ctrl+Z brings it back`)
  }
}
