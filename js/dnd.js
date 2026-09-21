// ── Drag and drop ────────────────────────────────────────────
// Pointer events (mouse, pen and touch in one path), the floorplan-site
// pattern: an 8px threshold before a drag commits so a tap still clicks, a
// ghost with pointer-events:none so elementFromPoint() sees through it, and
// the up/cancel listeners on the document so a drop outside the source
// element still lands. Reads only the data-drag / data-drop contract.
//
// Touch is different: rows and chips allow vertical panning (touch-action:
// pan-y), so a swipe over the roster scrolls the page. A drag starts on a
// long press instead, and from then on touchmove is cancelled so the page
// holds still under the finger. A quick tap still picks the person up.

import { ui, person } from './state.js'
import { dropPerson, pickUp } from './actions.js'
import { escHtml, initials, faceColor } from './utils.js'
import { icon } from './icons.js'

const THRESHOLD = 8
const EDGE = 64          // px from the top or bottom where a drag scrolls the page
const LONG_PRESS = 250   // ms a finger rests before a touch becomes a drag
let drag = null
let scrollRaf = 0

export function bindDnd() {
  document.addEventListener('pointerdown', onDown)
  document.addEventListener('pointermove', onMove)
  document.addEventListener('pointerup', onUp)
  document.addEventListener('pointercancel', cancel)
  window.addEventListener('blur', cancel)
  // Non-passive, so a touch drag in progress can stop the page from scrolling.
  document.addEventListener('touchmove', e => { if (drag?.committed) e.preventDefault() }, { passive: false })
}

/** True for a moment after a drag ends, so the click that follows is ignored. */
export const justDragged = () => performance.now() - lastDragEnd < 60
let lastDragEnd = 0

function onDown(e) {
  if (e.button !== 0 || drag) return
  if (e.target.closest('button, input, select, textarea, a, label')) return
  const el = e.target.closest('[data-drag="person"]')
  if (!el) return
  drag = { el, person: el.dataset.person, from: el.dataset.from || null, x: e.clientX, y: e.clientY, committed: false, ghost: null, over: null, touch: e.pointerType === 'touch', timer: 0 }
  if (drag.touch) {
    const d = drag
    d.timer = setTimeout(() => {
      if (drag !== d || d.committed) return
      start()
      d.lastX = d.x; d.lastY = d.y
      d.ghost.style.left = d.x + 'px'; d.ghost.style.top = d.y + 'px'
      navigator.vibrate?.(8)
    }, LONG_PRESS)
  }
}

function onMove(e) {
  if (!drag) return
  if (!drag.committed) {
    if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < THRESHOLD) return
    // A finger that moves before the long press is scrolling, not dragging.
    if (drag.touch) { clearTimeout(drag.timer); drag = null; return }
    start()
  }
  e.preventDefault()
  drag.ghost.style.left = e.clientX + 'px'
  drag.ghost.style.top = e.clientY + 'px'
  drag.lastX = e.clientX; drag.lastY = e.clientY
  if (!scrollRaf) scrollRaf = requestAnimationFrame(edgeScroll)
  retarget(e.clientX, e.clientY)
}

/** Near the top or bottom edge the page scrolls, so a card below the fold is reachable on a phone. */
function edgeScroll() {
  scrollRaf = 0
  if (!drag?.committed) return
  const y = drag.lastY, h = window.innerHeight
  const dy = y < EDGE ? -Math.ceil((EDGE - y) / 4) : y > h - EDGE ? Math.ceil((y - (h - EDGE)) / 4) : 0
  if (!dy) return
  window.scrollBy(0, dy)
  retarget(drag.lastX, drag.lastY)
  scrollRaf = requestAnimationFrame(edgeScroll)
}

function retarget(x, y) {
  const target = targetAt(x, y)
  if (target !== drag.over) {
    drag.over?.classList.remove('drop-target')
    drag.over = target
    target?.classList.add('drop-target')
    drag.ghost.querySelector('.ghost-hint').textContent = hintFor(target)
  }
}

function start() {
  drag.committed = true
  ui.carry = null
  const p = person(drag.person)
  document.body.classList.add('is-dragging')
  drag.el.classList.add('is-drag-source')
  const g = document.createElement('div')
  g.className = 'drag-ghost'
  g.innerHTML = `<span class="face" style="--face:${faceColor(drag.person)}">${escHtml(initials(p?.name))}<span class="carry-mark">${icon('hand-grab', { size: 12 })}</span></span><span class="ghost-hint"></span>`
  document.body.appendChild(g)
  drag.ghost = g
}

function hintFor(target) {
  if (!target) return ''
  if (target.dataset.drop === 'roster') return drag.from ? 'remove' : ''
  if (target.dataset.deliv === drag.from) return ''
  return drag.from ? 'move here' : 'add here'
}

function targetAt(x, y) {
  const el = document.elementFromPoint(x, y)
  return el ? el.closest('[data-drop]') : null
}

function onUp(e) {
  if (!drag) return
  const d = drag
  drag = null
  cleanup(d)
  if (!d.committed) {
    // A tap on a person or a share picks it up; the next click puts it down.
    if (!e.target.closest('button, input, select, textarea, a, label')) pickUp(d.person, d.from)
    lastDragEnd = performance.now()
    return
  }
  lastDragEnd = performance.now()
  const target = targetAt(e.clientX, e.clientY)
  if (!target) return
  dropPerson(d.person, d.from, target.dataset.drop === 'roster' ? 'roster' : target.dataset.deliv)
}

function cancel() {
  if (!drag) return
  const d = drag
  drag = null
  cleanup(d)
}

function cleanup(d) {
  clearTimeout(d.timer)
  cancelAnimationFrame(scrollRaf); scrollRaf = 0
  document.body.classList.remove('is-dragging')
  d.el?.classList.remove('is-drag-source')
  d.ghost?.remove()
  d.over?.classList.remove('drop-target')
}
