// ── Render: the flags panel ──────────────────────────────────
// Errors and warnings are always listed; info notes fold behind a toggle so
// the panel reads as "what is wrong" first. Each flag is a button that takes
// you to its card, and some carry a one-step fix.

import { ui } from './state.js'
import { CATEGORIES } from './flags.js'
import { icon, LEVEL_ICON } from './icons.js'
import { $, escHtml, plural } from './utils.js'

const LEVEL = { error: 'Error', warn: 'Warning', info: 'Note' }

/** The flag's own text, as a button to its target when it has one. */
function flagText(f) {
  if (f.target && (f.target.ids.length || f.target.kind === 'settings')) {
    return `<button type="button" class="flag-text" data-action="show" data-kind="${f.target.kind}" data-ids="${f.target.ids.join(',')}">${escHtml(f.text)}</button>`
  }
  return `<span class="flag-text">${escHtml(f.text)}</span>`
}
const fixBtn = f => (f.fix ? `<button type="button" class="flag-fix" data-action="fix" data-fix="${f.fix.action}" data-arg="${escHtml(f.fix.arg)}">${escHtml(f.fix.label)}</button>` : '')

export function renderFlags(flags) {
  const errors = flags.filter(f => f.level === 'error').length
  const warns = flags.filter(f => f.level === 'warn').length
  renderBar(flags, errors, warns)
  $('flagCount').textContent = errors || warns
    ? [errors && plural(errors, 'error'), warns && plural(warns, 'warning')].filter(Boolean).join(' · ')
    : 'all clear'

  const counts = { all: flags.filter(f => f.level !== 'info').length }
  for (const c of Object.keys(CATEGORIES)) counts[c] = flags.filter(f => f.cat === c && f.level !== 'info').length
  if (ui.filter !== 'all' && !counts[ui.filter]) ui.filter = 'all'
  $('flagFilters').innerHTML = [['all', 'All'], ...Object.entries(CATEGORIES)].map(([k, label]) =>
    `<button type="button" class="chip-btn" data-action="filter" data-filter="${k}" data-key="f-${k}" aria-pressed="${ui.filter === k}"${!counts[k] && k !== 'all' ? ' disabled' : ''}>${label} <span class="chip-n">${counts[k]}</span></button>`
  ).join('')

  const inCat = flags.filter(f => ui.filter === 'all' || f.cat === ui.filter)
  const notes = inCat.filter(f => f.level === 'info')
  const shown = inCat.filter(f => f.level !== 'info' || ui.showInfo)

  $('flagList').innerHTML = shown.length
    ? shown.map(f => `<li class="flag flag--${f.level}">
        <span class="flag-icon">${icon(LEVEL_ICON[f.level], { size: 18 })}</span>
        <span class="sr-only">${LEVEL[f.level]}: </span>
        <div class="flag-body">
          ${flagText(f)}
          <span class="flag-meta">${CATEGORIES[f.cat]}${f.fix ? ` · ${fixBtn(f)}` : ''}</span>
        </div>
      </li>`).join('')
    : `<li class="flag-empty">${errors || warns ? 'Nothing in this category.' : 'Nothing missing: every deliverable is sized and staffed, and nobody is over-booked.'}</li>`

  const more = $('flagMore')
  more.hidden = !notes.length
  more.textContent = ui.showInfo ? `Hide ${plural(notes.length, 'note')}` : `Show ${plural(notes.length, 'note')}`
  more.setAttribute('aria-expanded', String(ui.showInfo))
}

/**
 * The one-line summary above the board. Where the flags panel sits beside the
 * board (wide screens) CSS hides it; below 1280px the panel drops under the
 * board, and this keeps "move a person, watch a flag go" in view.
 */
function renderBar(flags, errors, warns) {
  // The bar has room for one flag: prefer one that carries a fix, errors first.
  const top = flags.find(f => f.level === 'error' && f.fix) || flags.find(f => f.level !== 'info' && f.fix) || flags.find(f => f.level !== 'info')
  $('flagBar').innerHTML = top
    ? `<span class="fb-count fb-count--${errors ? 'error' : 'warn'}">${icon(errors ? 'octagon-alert' : 'triangle-alert', { size: 15 })} ${[errors && plural(errors, 'error'), warns && plural(warns, 'warning')].filter(Boolean).join(' · ')}</span>
       <span class="fb-top">${flagText(top)}${top.fix ? ` ${fixBtn(top)}` : ''}</span>
       <a class="fb-all" href="#flags">All flags</a>`
    : `<span class="fb-count fb-count--ok">${icon('circle-check', { size: 15 })} Nothing missing</span>`
}
