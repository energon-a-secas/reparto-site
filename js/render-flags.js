// Flags live in an on-demand dialog. A status or person indicator scopes the
// same review to that item; the global button always shows the whole plan.
import { state, ui } from './state.js'
import { CATEGORIES, deliverableStatus } from './flags.js'
import { fmtSpan } from './calendar.js'
import { icon, LEVEL_ICON } from './icons.js'
import { $, escHtml, plural } from './utils.js'

const LEVEL = { error: 'Error', warn: 'Warning', info: 'Note' }
const stats = items => `<dl class="inspect-stats">${items.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl>`

function flagText(f) {
  if (f.target && (f.target.ids.length || f.target.kind === 'settings')) {
    return `<button type="button" class="flag-text" data-action="show" data-kind="${f.target.kind}" data-ids="${f.target.ids.join(',')}">${escHtml(f.text)}</button>`
  }
  return `<span class="flag-text">${escHtml(f.text)}</span>`
}
const fixBtn = f => f.fix ? `<button type="button" class="flag-fix" data-action="fix" data-fix="${f.fix.action}" data-arg="${escHtml(f.fix.arg)}">${escHtml(f.fix.label)}${icon('chevron-right', { size: 14 })}</button>` : ''

export function renderFlags(all, a) {
  const total = all.filter(f => f.level !== 'info').length
  $('flagsTotal').textContent = total
  $('flagsBtn').setAttribute('aria-label', `Review ${plural(total, 'flag')} in this plan`)
  $('flagsBtn').dataset.tip = total ? `${plural(total, 'flag')} to review. Open for details and suggested fixes.` : 'No issues to review.'

  let scope = ui.flagScope
  const subject = scope && (scope.kind === 'person' ? state.doc.people : state.doc.deliverables).find(x => x.id === scope.id)
  if (scope && !subject) scope = ui.flagScope = null
  const flags = scope ? all.filter(f => (f.target?.kind === scope.kind && f.target.ids.includes(scope.id)) || (scope.kind === 'deliverable' && f.target?.also?.includes(scope.id))) : all
  $('flagsTitle').textContent = subject ? subject.name.trim() || 'Untitled' : 'Plan flags'
  $('flagsEyebrow').textContent = scope ? scope.kind === 'person' ? 'Availability & workload' : 'Staffing details' : 'Plan review'
  $('allFlagsBtn').hidden = !scope
  $('flagFilters').hidden = !!scope
  $('flagsContext').hidden = !scope
  $('flagsContext').innerHTML = ''
  if (scope?.kind === 'deliverable') {
    const da = a.deliverables.get(scope.id)
    $('flagsContext').innerHTML = stats([['Estimate', subject.estimate == null ? 'Unsized' : `${subject.estimate} pts`], ['Booked', `${da.got} pts`], [da.gap < 0 ? 'Overstaffed' : 'Short', subject.estimate == null ? '—' : `${Math.abs(da.gap)} pts`]])
      + (subject.note ? `<p class="inspect-note">${escHtml(subject.note)}</p>` : '')
  } else if (scope?.kind === 'person') {
    const pa = a.people.get(scope.id)
    const leave = [pa.lost.vacation ? `${plural(pa.lost.vacation, 'working day')} of vacation in this plan` : '', subject.sprintsOff ? plural(subject.sprintsOff, 'sprint') + ' away' : ''].filter(Boolean)
    $('flagsContext').innerHTML = stats([['Capacity', `${pa.cap} pts`], ['Booked', `${pa.used} pts`], [pa.free < 0 ? 'Over-booked' : 'Available', `${Math.abs(pa.free)} pts`]])
      + (leave.length ? `<p class="inspect-note">${icon('calendar-days')}${escHtml(leave.join(' · '))}</p>` : '')
      + (subject.vacations?.length ? `<p class="inspect-note">Leave dates: ${subject.vacations.map(v => escHtml(fmtSpan(v.from, v.to))).join('; ')}</p>` : '')
      + `<button type="button" class="btn btn--secondary btn--sm" data-action="edit-person" data-id="${subject.id}">${icon('pencil', { size: 14 })}Edit availability & assignments</button>`
  }

  const errors = flags.filter(f => f.level === 'error').length
  const warns = flags.filter(f => f.level === 'warn').length
  $('flagCount').textContent = errors || warns
    ? [errors && plural(errors, 'error'), warns && plural(warns, 'warning')].filter(Boolean).join(' · ')
    : 'No issues'
  const counts = { all: flags.filter(f => f.level !== 'info').length }
  for (const c of Object.keys(CATEGORIES)) counts[c] = flags.filter(f => f.cat === c && f.level !== 'info').length
  if (ui.filter !== 'all' && !counts[ui.filter]) ui.filter = 'all'
  $('flagFilters').innerHTML = [['all', 'All'], ...Object.entries(CATEGORIES)].map(([k, label]) =>
    `<button type="button" class="chip-btn" data-action="filter" data-filter="${k}" data-key="f-${k}" aria-pressed="${ui.filter === k}"${!counts[k] && k !== 'all' ? ' disabled' : ''}>${label} <span class="chip-n">${counts[k]}</span></button>`
  ).join('')
  const inCat = flags.filter(f => ui.filter === 'all' || f.cat === ui.filter)
  const notes = inCat.filter(f => f.level === 'info')
  const shown = inCat.filter(f => f.level !== 'info' || ui.showInfo)
  let empty = errors || warns ? 'Nothing in this category.' : 'Every deliverable is sized and staffed, and nobody is over-booked.'
  if (scope?.kind === 'deliverable') empty = deliverableStatus(subject, a.deliverables.get(scope.id), a, state.doc).text
  if (scope?.kind === 'person') empty = 'No workload issues for this person.'
  $('flagList').innerHTML = shown.length ? shown.map(f => `<li class="flag flag--${f.level}">
    <span class="flag-icon">${icon(LEVEL_ICON[f.level], { size: 18 })}</span><span class="sr-only">${LEVEL[f.level]}: </span>
    <div class="flag-body">${flagText(f)}<span class="flag-meta">${CATEGORIES[f.cat]}</span>${fixBtn(f)}</div>
  </li>`).join('') : `<li class="flag-empty">${icon('circle-check')}${escHtml(empty)}</li>`
  $('flagMore').hidden = !notes.length
  $('flagMore').textContent = ui.showInfo ? `Hide ${plural(notes.length, 'note')}` : `Show ${plural(notes.length, 'note')}`
  $('flagMore').setAttribute('aria-expanded', String(ui.showInfo))
}
