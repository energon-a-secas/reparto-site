// ── Icons ────────────────────────────────────────────────────
// icon(name) draws one inline SVG from the generated map (icon-data.js,
// Lucide). Decorative by default: every icon sits beside a word or inside a
// control that carries its own label, so no state is an icon alone.

import { ICONS } from './icon-data.js'

export function icon(name, { size = 16, cls = '', stroke = 2 } = {}) {
  const body = ICONS[name]
  if (!body) return ''
  return `<svg class="ico${cls ? ` ${cls}` : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
}

/** One icon per deliverable status: the cards, the table and the Later and Done lists share it. */
export const STATUS_ICON = {
  ok: 'circle-check',
  short: 'circle-arrow-down',
  over: 'circle-arrow-up',
  unsized: 'circle-help',
  empty: 'user-x',
  risk: 'triangle-alert',
  later: 'calendar-clock',
  done: 'archive',
}

/** Flag levels: an octagon stops, a triangle warns, an i informs. */
export const LEVEL_ICON = { error: 'octagon-alert', warn: 'triangle-alert', info: 'info' }
