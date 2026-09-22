// ── Popovers: size a deliverable, change a share ─────────────
// One element (#pop), anchored under the control that opened it. The anchor
// is remembered by data-key, not by node, because every change re-renders.

import { state, snapshot, commitFrom, deliverable, findDeliverable, person, updatePerson, updateDeliverable, setShare } from './state.js'
import { SCALE, fibCeil, analyze, shareKey, pctForPoints, freeIn, scaleEstimate, PCT_MIN, PCT_MAX } from './capacity.js'
import { engineers, landingText, sprintList } from './flags.js'
import { sprintWindows, lastWorkday, fmtDay, fmtSpan, parseISO } from './calendar.js'
import { spanLabel, spanOf, spanLength } from './timeline.js'
import { cal } from './holidays.js'
import { afterChange } from './render.js'
import { moveTo, removeDeliverablePinned, unassignPinned, saveDeliverableDetails, changeWindow } from './actions.js'
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
  // Worked out over the deliverable's own sprints, not the whole plan's.
  const own = spanOf(d, s.sprints), ownLen = spanLength(own)
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
        <input class="field field--num" type="number" min="0" max="13" step="1" value="${ownLen}" data-in="spr" aria-label="Sprints">
        <span>sprints${own.whole ? '' : ` (its ${escHtml(spanLabel(own))})`}</span>
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
  // Everything here is about the deliverable's sprints: their points there, and what they have free there.
  const span = a.spans.get(delivId), exactCap = sh.winCap, cap = Math.round(exactCap), where = span.whole ? '' : ` in ${spanLabel(span)}`
  const free = freeIn(pa, span)
  const freePct = exactCap ? (free / exactCap) * 100 : 0
  const quick = []
  // Only offer what the person has: covering a gap by over-booking them is not a fix.
  if (da.gap > 0 && free > 0) {
    const pts = sh.points + Math.min(da.gap, free)
    quick.push(`<button type="button" class="chip-btn" data-pct="${pctForPoints(state.doc, cal, delivId, personId, pts)}">${free >= da.gap ? 'Cover the gap' : 'Cover what they can'}: ${pts} pts</button>`)
  }
  if (freePct > 0.5 && free !== da.gap) quick.push(`<button type="button" class="chip-btn" data-pct="${Math.round((sh.pct + freePct) * 100) / 100}">All their free time: ${fmtPct(sh.pct + freePct)}</button>`)
  const pop = open(`sp-${delivId}-${personId}`, `${head(`${who} on ${d.name.trim() || 'this deliverable'}`)}
    <p class="pop-label">Share of ${escHtml(who)}'s ${cap} pts${where}</p>
    <div class="scale" role="group" aria-label="Percent of their ${cap} points${where}">${PCTS.map(v =>
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
    <p class="pop-note">${fmtPct(sh.pct)} of ${escHtml(who)}'s ${cap} pts${where} is <strong>${sh.points} pts</strong> here, and moves with their capacity. Across the plan: ${fmtPct(pa.pct)}${pa.free < 0 ? `, ${-pa.free} pts over` : `, ${pa.free} pts free`}${pa.overSprints.length ? `, over-booked in ${sprintList(pa.overSprints)}` : ''}. ${d.estimate ? `The deliverable needs ${d.estimate}, has ${da.got}.` : 'The deliverable is not sized yet.'}${sh.fixed ? ' This share is fixed points from an older plan; setting it makes it a percentage.' : ''}</p>
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
    const most = Math.floor((exactCap * PCT_MAX) / 100)
    let v
    if (raw === 'exact') v = Number(pop.querySelector('#popPct').value)
    else if (raw === 'points') {
      const pts = Math.round(Number(pop.querySelector('#popPts').value))
      if (!(pts >= 1)) { showToast('A share is at least 1 point'); return }
      if (!cap) { showToast(`${who} has no capacity${where || ' in this plan'}, so points cannot be split`); return }
      if (pts > most) { showToast(`A share is at most ${PCT_MAX}% of ${who}'s ${cap} pts${where}: ${most} pts`); return }
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

// ── When: the sprints a deliverable runs over ────────────────
// Shorter than the plan when it needs less time. By default each person keeps
// the points they give it, so the same work lands in fewer sprints at a bigger
// share of their time there; the preview says what that asks of them and when
// it lands, before anything changes.
export function openWindow(delivId) {
  const d = deliverable(delivId); if (!d) return
  const s = state.doc.settings
  const wins = sprintWindows(s)
  const name = d.name.trim() || 'Untitled deliverable'
  const a = analyze(state.doc, cal)
  const span = a.spans.get(delivId)
  const opt = (i, label, sel) => `<option value="${i + 1}"${sel ? ' selected' : ''}>${label}</option>`
  const fromOpts = wins.map(w => opt(w.i, `S${w.i + 1} · from ${fmtDay(w.from)}`, w.i === span.a)).join('')
  const toOpts = wins.map(w => opt(w.i, `S${w.i + 1} · to ${fmtDay(lastWorkday(w, s.daysPerWeek))}`, w.i === span.b)).join('')
  const half = Math.floor(s.sprints / 2)
  const quick = [['Whole plan', 1, s.sprints], half && ['First half', 1, half], half && ['Second half', half + 1, s.sprints]].filter(Boolean)
  const pop = open(`dt-${delivId}`, `${head(`When: ${name}`)}
    <div class="pop-row pop-row--wrap win-row">
      <label class="pop-label" for="winFrom">From<select class="field" id="winFrom">${fromOpts}</select></label>
      <label class="pop-label" for="winTo">To<select class="field" id="winTo">${toOpts}</select></label>
    </div>
    <div class="pop-row pop-row--wrap">${quick.map(([label, f, t]) => `<button type="button" class="chip-btn" data-win="${f}-${t}">${label}</button>`).join('')}</div>
    <fieldset class="win-mode"><legend class="pop-label">With the new sprints</legend>
      <label class="check"><input type="radio" name="winMode" value="estimate" checked> Scale the estimate: the same people give the same share of their time</label>
      <label class="check"><input type="radio" name="winMode" value="points"> Keep the estimate and each person's points: a bigger share of their time</label>
      <label class="check"><input type="radio" name="winMode" value="none"> Keep the estimate and each person's percentage</label>
    </fieldset>
    <p class="pop-note" id="winPreview" aria-live="polite"></p>
    <div class="pop-row"><button type="button" class="btn btn--primary btn--sm" data-win="apply">Set sprints</button></div>`,
  `When ${name} runs`, '#winFrom')
  if (!pop) return
  const from = pop.querySelector('#winFrom'), to = pop.querySelector('#winTo')
  const mode = () => pop.querySelector('[name="winMode"]:checked').value
  const chosen = () => {
    let f = Number(from.value), t = Number(to.value)
    if (t < f) [f, t] = [t, f]
    return f === 1 && t === s.sprints ? null : { from: f, to: t }
  }
  // What the change would do, worked out on a copy: each person's share of their time there, and the landing date.
  const preview = () => {
    const w = chosen()
    const next = structuredClone(state.doc)
    const nd = next.deliverables.find(x => x.id === delivId)
    const before = analyze(state.doc, cal)
    const oldLen = spanLength(before.spans.get(delivId))
    nd.window = w
    if (mode() === 'estimate') nd.estimate = scaleEstimate(d.estimate, oldLen, spanLength(spanOf(nd, s.sprints)))
    if (mode() === 'points') {
      for (const m of nd.members) {
        const had = before.shares.get(shareKey(delivId, m.person))?.points
        if (m.pct != null && had) m.pct = pctForPoints(next, cal, delivId, m.person, had)
      }
    }
    const b = analyze(next, cal), db = b.deliverables.get(delivId)
    const est = nd.estimate !== d.estimate ? ` Estimate ${d.estimate} to <strong>${nd.estimate} pts</strong>.` : d.estimate ? ` Estimate stays ${d.estimate} pts.` : ''
    const who = nd.members.map(m => {
      const p = person(m.person), sh = b.shares.get(shareKey(delivId, m.person)), pa = b.people.get(m.person)
      const over = pa.overSprints.filter(i => i >= db.span.a && i <= db.span.b)
      return `${escHtml(p?.name.trim() || 'Unnamed')} ${sh.points} pts, ${fmtPct(sh.pct)} of their time there${over.length ? ` <span class="error-text">(over-booked in ${sprintList(over)})</span>` : ''}`
    })
    pop.querySelector('#winPreview').innerHTML = `${escHtml(spanLabel(db.span))}.${est}${who.length ? ` ${who.join('; ')}.` : ''} ${escHtml(landingText(db.lands, s, db.span).text)}.`
    repositionPop()
  }
  pop.addEventListener('change', e => { if (e.target.matches('select, input')) preview() })
  preview()
  pop.onclick = e => {
    if (e.target.closest('[data-pop="close"]')) { closePop(); return }
    const b = e.target.closest('[data-win]'); if (!b) return
    if (b.dataset.win !== 'apply') {
      const [f, t] = b.dataset.win.split('-').map(Number)
      from.value = String(f); to.value = String(t); preview(); return
    }
    closePop()
    changeWindow(delivId, chosen(), { mode: mode() })
  }
}

// ── A vacation on the map: its dates, or gone ────────────────
export function openVacation(personId, index) {
  const p = person(personId), v = p?.vacations?.[index]
  if (!v) return
  const who = p.name.trim() || 'Unnamed'
  const pop = open(`mv-${personId}-${index}`, `${head(`${who}: vacation`)}
    <div class="pop-row pop-row--wrap">
      <label class="pop-label" for="vacFrom">From<input type="date" class="field field--date" id="vacFrom" value="${v.from}"></label>
      <label class="pop-label" for="vacTo">To<input type="date" class="field field--date" id="vacTo" value="${v.to}"></label>
    </div>
    <p class="pop-note">${escHtml(fmtSpan(v.from, v.to))}. Holidays and weekends inside it cost nothing extra.</p>
    <div class="pop-row"><button type="button" class="btn btn--primary btn--sm" data-vac="save">Save dates</button><button type="button" class="btn btn--ghost btn--sm btn--quiet-danger" data-vac="remove">Remove</button></div>`,
  `${who}'s vacation`, '#vacFrom')
  if (!pop) return
  pop.onclick = e => {
    if (e.target.closest('[data-pop="close"]')) { closePop(); return }
    const b = e.target.closest('[data-vac]'); if (!b) return
    const list = [...p.vacations]
    if (b.dataset.vac === 'remove') list.splice(index, 1)
    else {
      const from = pop.querySelector('#vacFrom').value, to = pop.querySelector('#vacTo').value
      if (!parseISO(from) || !parseISO(to)) { showToast('Pick both dates'); return }
      list[index] = { from, to }
    }
    closePop({ restore: false })
    const before = JSON.stringify(state.doc)
    updatePerson(personId, { vacations: list })
    if (!commitFrom(before)) return
    afterChange()
    showToast(b.dataset.vac === 'remove' ? `${who}'s vacation removed. Ctrl+Z brings it back` : `${who}'s vacation: ${fmtSpan(list[index].from, list[index].to)}`)
    document.querySelector(`[data-key="me-${CSS.escape(personId)}"]`)?.focus({ preventScroll: true })
  }
}
