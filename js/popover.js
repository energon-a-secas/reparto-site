// ── Popovers: size a deliverable, change a share ─────────────
// One element (#pop), anchored under the control that opened it. The anchor
// is remembered by data-key, not by node, because every change re-renders.

import { state, snapshot, deliverable, person, updateDeliverable, setPoints, unassign } from './state.js'
import { SCALE, fibCeil, analyze } from './capacity.js'
import { cal } from './holidays.js'
import { afterChange } from './render.js'
import { $, escHtml, showToast } from './utils.js'

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
  pop.style.top = `${Math.max(8, top)}px`
  pop.style.left = `${left}px`
}

function open(key, html, label) {
  const anchor = document.querySelector(`[data-key="${key}"]`)
  if (!anchor) return null
  anchorKey = key
  const pop = $('pop')
  pop.setAttribute('aria-label', label)
  pop.innerHTML = html
  place(anchor)
  ;(pop.querySelector('[aria-pressed="true"]') || pop.querySelector('button, input'))?.focus({ preventScroll: true })
  return pop
}

const head = title => `<div class="pop-head"><strong>${escHtml(title)}</strong>
  <button type="button" class="icon-btn" data-pop="close" aria-label="Close"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>`

// ── Estimate ─────────────────────────────────────────────────
export function openEstimate(delivId) {
  const d = deliverable(delivId); if (!d) return
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
  const sprint = analyze(state.doc, cal).sprint
  const recalc = () => {
    const eng = Number(pop.querySelector('[data-in="eng"]').value) || 0
    const spr = Number(pop.querySelector('[data-in="spr"]').value) || 0
    const days = Number(pop.querySelector('[data-in="days"]').value) || 0
    suggest(pop.querySelector('[data-out="team"]'), eng * spr * sprint)
    suggest(pop.querySelector('[data-out="days"]'), days * s.pointsPerDay)
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

function suggest(out, raw) {
  const f = fibCeil(raw)
  const fits = SCALE.includes(f)
  out.innerHTML = raw > 0
    ? `= ${Number.isInteger(raw) ? raw : raw.toFixed(1)} → ${fits ? `<button type="button" class="scale-btn scale-btn--suggest" data-pick="${f}">${f}</button>` : `<span class="warn-text">${f}, off the scale: split it</span>`}`
    : ''
}

// ── Share ────────────────────────────────────────────────────
export function openPoints(delivId, personId) {
  const d = deliverable(delivId), p = person(personId)
  const m = d?.members.find(x => x.person === personId)
  if (!m || !p) return
  const a = analyze(state.doc, cal)
  const pa = a.people.get(personId), da = a.deliverables.get(delivId)
  const opts = [1, 2, 3, 5, 8, 13, 21, 34, 55]
  const quick = []
  // Only offer what the person has: a share that covers the gap by over-booking them is not a fix.
  if (da.gap > 0 && pa.free > 0) quick.push(`<button type="button" class="chip-btn" data-set="${m.points + Math.min(da.gap, pa.free)}">${pa.free >= da.gap ? 'Cover the gap' : 'Cover what they can'}: ${m.points + Math.min(da.gap, pa.free)}</button>`)
  if (pa.free > 0 && pa.free !== da.gap) quick.push(`<button type="button" class="chip-btn" data-set="${m.points + pa.free}">Everything free: ${m.points + pa.free}</button>`)
  const pop = open(`sp-${delivId}-${personId}`, `${head(`${p.name.trim() || 'Unnamed'} on ${d.name.trim() || 'this deliverable'}`)}
    <div class="scale" role="group" aria-label="Points">${opts.map(v =>
      `<button type="button" class="scale-btn" data-set="${v}" aria-pressed="${m.points === v}">${v}</button>`).join('')}</div>
    <div class="pop-row">
      <label class="pop-label" for="popExact">Exact</label>
      <input class="field field--num" id="popExact" type="number" min="1" max="999" step="1" value="${m.points}">
      <button type="button" class="btn btn--secondary btn--sm" data-set="exact">Set</button>
    </div>
    ${quick.length ? `<div class="pop-row pop-row--wrap">${quick.join('')}</div>` : ''}
    <p class="pop-note">${escHtml(p.name.trim() || 'Unnamed')} has ${pa.cap} this plan, ${pa.free < 0 ? `${-pa.free} over` : `${pa.free} free`}. ${d.estimate ? `The deliverable needs ${d.estimate}, has ${da.got}.` : 'The deliverable is not sized yet.'}</p>
    <button type="button" class="btn btn--ghost btn--sm btn--block" data-set="remove">Take ${escHtml(p.name.trim() || 'them')} off</button>`,
  'Change the share')
  if (!pop) return
  pop.querySelector('#popExact').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); pop.querySelector('[data-set="exact"]').click() } })
  pop.onclick = e => {
    if (e.target.closest('[data-pop="close"]')) { closePop(); return }
    const b = e.target.closest('[data-set]'); if (!b) return
    const raw = b.dataset.set
    if (raw === 'remove') {
      closePop({ restore: false })
      snapshot(); unassign(delivId, personId); afterChange()
      showToast(`${p.name || 'Person'} taken off ${d.name || 'the deliverable'}`)
      return
    }
    const v = raw === 'exact' ? Math.round(Number(pop.querySelector('#popExact').value)) : Number(raw)
    if (!(v >= 1)) { showToast('A share is at least 1 point'); return }
    closePop({ restore: false })
    if (v === m.points) return
    snapshot(); setPoints(delivId, personId, v); afterChange()
    document.querySelector(`[data-key="sp-${delivId}-${personId}"]`)?.focus({ preventScroll: true })
  }
}
