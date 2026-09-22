// ── Map editing ──────────────────────────────────────────────
// Two direct manipulations on the map, each with a way in that needs no
// pointer:
//   a person's row    drag across days to add a vacation (a phone: tap the
//                     first day, then the last); the pencil opens their editor
//   a deliverable bar drag it to move it, drag an end to resize it, snapped
//                     to whole sprints; arrow keys do the same, Shift+arrows
//                     move its end; a click or Enter opens the exact picker
// Changes go through the same mutations as everywhere else: one undo step
// each, and a bar keeps each person's points (changeWindow).

import { state, person, commitFrom, updatePerson } from './state.js'
import { parseISO, addDays, iso, fmtSpan } from './calendar.js'
import { spanOf } from './timeline.js'
import { analyze } from './capacity.js'
import { cal } from './holidays.js'
import { changeWindow } from './actions.js'
import { afterChange, renderAll } from './render.js'
import { $, showToast, plural } from './utils.js'

let drag = null
let suppress = false          // the click that trails a drag must not also open the picker
let tapStart = null           // a phone's first tap on a row: { pid, date }
let touch = null              // a finger that is down on a row: a tap only if it lifts where it landed

/** The map's dates, read off the rendered map so a pointer can be turned into a day. */
function frame(el) {
  const map = el.closest('.map')
  return map ? { from: parseISO(map.dataset.from), n: Number(map.dataset.days) } : null
}
function dayAt(track, clientX, f) {
  const r = track.getBoundingClientRect()
  const i = Math.floor(((clientX - r.left) / r.width) * f.n)
  return addDays(f.from, Math.max(0, Math.min(f.n - 1, i)))
}

export function bindMapEdit() {
  const root = $('boardMap')
  root.addEventListener('pointerdown', onDown)
  root.addEventListener('keydown', onKey)
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  // A touch that turns into a scroll is cancelled: it is not a tap, and it forgets any first tap.
  document.addEventListener('pointercancel', () => { cleanup(); drag = null; touch = null })
  // Only the click that trails this gesture is swallowed. A drag that repaints the map removes the
  // element it started on, so often no click trails it at all; a new gesture clears the flag.
  document.addEventListener('pointerdown', () => { suppress = false }, true)
  document.addEventListener('click', e => { if (suppress) { suppress = false; e.stopPropagation(); e.preventDefault() } }, true)
}

/** A suppression that cannot outlive the gesture: gone after this task, trailing click or not. */
function swallowTrailingClick() {
  suppress = true
  setTimeout(() => { suppress = false }, 0)
}

function onDown(e) {
  if (e.button !== 0) return
  const bar = e.target.closest('[data-bar]')
  if (bar && e.pointerType !== 'touch') { startBar(e, bar); return }
  const track = e.target.closest('[data-vac-track]')
  if (!track || e.target.closest('button')) return
  const f = frame(track); if (!f) return
  const pid = track.dataset.vacTrack
  const day = dayAt(track, e.clientX, f)
  if (e.pointerType === 'touch') {
    // Touch scrolls the map sideways, so a vacation is two taps rather than a drag, and a touch counts
    // only when it lifts where it landed (onUp): a swipe to scroll is not a tap.
    touch = { id: e.pointerId, pid, day, x: e.clientX, y: e.clientY }
    return
  }
  e.preventDefault()
  const ghost = document.createElement('i')
  ghost.className = 'map-ghost'
  track.appendChild(ghost)
  drag = { kind: 'vac', track, pid, f, from: day, to: day, ghost }
  paintGhost()
}

function paintGhost() {
  const { f, from, to, ghost } = drag
  const [a, b] = from <= to ? [from, to] : [to, from]
  const left = Math.round((a - f.from) / 86400000), right = Math.round((b - f.from) / 86400000) + 1
  ghost.style.left = `${(left / f.n) * 100}%`
  ghost.style.width = `${((right - left) / f.n) * 100}%`
}

function startBar(e, bar) {
  const d = state.doc.deliverables.find(x => x.id === bar.dataset.bar); if (!d) return
  const f = frame(bar); if (!f) return
  const s = state.doc.settings
  const span = spanOf(d, s.sprints)
  const track = bar.parentElement
  drag = {
    kind: 'bar', bar, id: d.id, f, x: e.clientX, moved: false, span, next: { ...span },
    mode: e.target.closest('[data-handle]')?.dataset.handle || 'move',
    sprintPx: (track.getBoundingClientRect().width * s.weeksPerSprint * 7) / f.n,
  }
}

function onMove(e) {
  if (touch && e.pointerId === touch.id && Math.hypot(e.clientX - touch.x, e.clientY - touch.y) > 10) touch = null
  if (!drag) return
  if (drag.kind === 'vac') { drag.to = dayAt(drag.track, e.clientX, drag.f); paintGhost(); return }
  const dx = e.clientX - drag.x
  if (!drag.moved && Math.abs(dx) < 5) return
  drag.moved = true
  document.body.classList.add('is-map-dragging')
  const n = state.doc.settings.sprints, step = Math.round(dx / drag.sprintPx)
  const { a, b } = drag.span
  let na = a, nb = b
  if (drag.mode === 'move') { const len = b - a; na = Math.max(0, Math.min(n - 1 - len, a + step)); nb = na + len }
  else if (drag.mode === 'start') na = Math.max(0, Math.min(b, a + step))
  else nb = Math.max(a, Math.min(n - 1, b + step))
  drag.next = { a: na, b: nb }
  // Preview on the bar itself; the map repaints once the change is made.
  const L = state.doc.settings.weeksPerSprint * 7
  drag.bar.style.left = `${((na * L) / drag.f.n) * 100}%`
  drag.bar.style.width = `${(((nb - na + 1) * L) / drag.f.n) * 100}%`
  drag.bar.querySelector('.map-bar-text').textContent = na === nb ? `S${na + 1}` : `S${na + 1} to S${nb + 1}`
  drag.bar.setAttribute('aria-label', `Moving to ${drag.bar.querySelector('.map-bar-text').textContent}`)
}

function onUp(e) {
  if (touch && e.pointerId === touch.id) { tap(touch); touch = null; return }
  if (!drag) return
  const d = drag
  cleanup()
  drag = null
  if (d.kind === 'vac') { swallowTrailingClick(); addVacation(d.pid, d.from, d.to); return }
  if (!d.moved) return                    // a plain click: the picker opens through data-action
  swallowTrailingClick()
  // Dropped where it started: put back the text and label the drag previewed on the bar.
  if (d.next.a === d.span.a && d.next.b === d.span.b) { renderAll(); return }
  setSpan(d.id, d.next)
}

/** A phone's tap on a row: the first marks the first day, a second on the same row the last. */
function tap({ pid, day }) {
  if (tapStart?.pid === pid) { const from = tapStart.date; tapStart = null; addVacation(pid, from, day); return }
  tapStart = { pid, date: day }
  showToast(`First day ${fmtSpan(iso(day), iso(day))}. Tap the last day of the vacation on the same row`)
}

function cleanup() {
  drag?.ghost?.remove()
  document.body.classList.remove('is-map-dragging')
}

function setSpan(id, { a, b }) {
  const n = state.doc.settings.sprints
  changeWindow(id, a === 0 && b === n - 1 ? null : { from: a + 1, to: b + 1 })
  document.querySelector(`[data-key="dt-${CSS.escape(id)}"]`)?.focus({ preventScroll: true })
}

/** Arrow keys move a focused bar a sprint; with Shift they move its end. */
function onKey(e) {
  const bar = e.target.closest?.('[data-bar]')
  if (!bar || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return
  const d = state.doc.deliverables.find(x => x.id === bar.dataset.bar); if (!d) return
  e.preventDefault()
  const n = state.doc.settings.sprints, step = e.key === 'ArrowRight' ? 1 : -1
  const { a, b } = spanOf(d, n)
  const next = e.shiftKey ? { a, b: Math.max(a, Math.min(n - 1, b + step)) }
    : { a: Math.max(0, Math.min(n - 1 - (b - a), a + step)), b: Math.max(0, Math.min(n - 1 - (b - a), a + step)) + (b - a) }
  if (next.a !== a || next.b !== b) setSpan(d.id, next)
}

/**
 * One vacation, one undo step, and a toast that says what it costs: the
 * working days it takes that they would otherwise have had, so not their
 * holidays, team days off or days an earlier vacation already covers, the
 * same count as the person editor and the flags.
 */
function addVacation(pid, x, y) {
  const p = person(pid); if (!p) return
  const [from, to] = x <= y ? [iso(x), iso(y)] : [iso(y), iso(x)]
  const before = JSON.stringify(state.doc)
  const had = new Set(analyze(state.doc, cal).people.get(pid)?.vacationDays || [])
  updatePerson(pid, { vacations: [...(p.vacations || []), { from, to }] })
  if (!commitFrom(before)) return
  afterChange()
  const cost = (analyze(state.doc, cal).people.get(pid)?.vacationDays || []).filter(d => !had.has(d)).length
  showToast(`${p.name.trim() || 'Unnamed'}: vacation ${fmtSpan(from, to)}, ${plural(cost, 'working day')} in this plan. Ctrl+Z takes it back`)
}
