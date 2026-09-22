// Lightweight hover/focus previews. The same controls open full details on
// click or Enter, so touch and keyboard users never depend on hover.
import { $ } from './utils.js'
let anchor = null
let timer = 0
let dismissTimer = 0
let previousDescription = null
export function hideTooltip() {
  clearTimeout(timer)
  clearTimeout(dismissTimer)
  if (anchor) {
    if (previousDescription) anchor.setAttribute('aria-describedby', previousDescription)
    else anchor.removeAttribute('aria-describedby')
  }
  anchor = null
  $('hoverTip').hidden = true
}
function preview(el, delay) {
  if (!el || anchor === el) return
  hideTooltip(); anchor = el
  previousDescription = el.getAttribute('aria-describedby')
  timer = setTimeout(() => {
    if (!el.isConnected) return hideTooltip()
    const tip = $('hoverTip')
    tip.textContent = el.dataset.tip
    tip.hidden = false
    el.setAttribute('aria-describedby', [previousDescription, tip.id].filter(Boolean).join(' '))
    const r = el.getBoundingClientRect(), w = tip.offsetWidth, h = tip.offsetHeight
    tip.style.left = `${Math.max(8, Math.min(r.left, innerWidth - w - 8))}px`
    tip.style.top = `${Math.max(8, r.top >= h + 12 ? r.top - h - 8 : Math.min(r.bottom + 8, innerHeight - h - 8))}px`
  }, delay)
}
export function bindTooltips() {
  document.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse') return
    if (e.target.closest('#hoverTip') || anchor?.contains(e.target)) clearTimeout(dismissTimer)
    else preview(e.target.closest('[data-tip]'), 350)
  })
  document.addEventListener('pointerout', e => {
    if ((anchor?.contains(e.target) && !anchor.contains(e.relatedTarget)) || e.target.closest('#hoverTip')) {
      dismissTimer = setTimeout(hideTooltip, 150)
    }
  })
  document.addEventListener('focusin', e => preview(e.target.closest('[data-tip]'), 200))
  document.addEventListener('focusout', hideTooltip)
  document.addEventListener('pointerdown', hideTooltip)
  document.addEventListener('keydown', e => { if (e.key === 'Escape') hideTooltip() })
  document.addEventListener('scroll', hideTooltip, { capture: true, passive: true })
  window.addEventListener('resize', hideTooltip)
}
