// ── Render: the calendar row under the formula ───────────────
// Start date, the team's holiday calendar, the sprint dates, and every day
// off that lands inside the plan. A holiday on a weekend is listed apart:
// it is real, it just costs nobody a focus day.

import { state } from './state.js'
import { sprintWindows, planRange, daysOffFor, parseISO, addDays, fmtDay } from './calendar.js'
import { countries, countryName } from './holidays.js'
import { $, escHtml, plural } from './utils.js'

const X_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

/** Country <option>s: "None" first, the current value kept even before the list arrives. */
export function countryOptions(current, noneLabel = 'None') {
  const list = countries()
  const opts = [`<option value="">${escHtml(noneLabel)}</option>`]
  if (current && !list.some(c => c.code === current)) opts.push(`<option value="${current}" selected>${current}</option>`)
  for (const c of list) opts.push(`<option value="${c.code}"${c.code === current ? ' selected' : ''}>${escHtml(c.name)}</option>`)
  return opts.join('')
}

/** The last working day of a sprint window, for "5 to 16 Oct". */
function lastWorkday(w, daysPerWeek) {
  let d = addDays(w.to, -1)
  while (d > w.from && (d.getUTCDay() || 7) > daysPerWeek) d = addDays(d, -1)
  return d
}

export function renderCalendar(a, cal) {
  const s = state.doc.settings
  const range = planRange(s)
  const windows = sprintWindows(s)

  // Days off for a full-timer on the team calendar: what everyone loses.
  const team = daysOffFor({ country: '', vacations: [] }, state.doc, cal.holidays)
  const inPlan = [...team.entries()]
    .map(([date, o]) => ({ date, ...o, d: parseISO(date) }))
    .filter(x => range && x.d >= range.from && x.d < range.to)
  const workday = x => (x.d.getUTCDay() || 7) <= s.daysPerWeek
  const costs = inPlan.filter(workday)
  const weekend = inPlan.filter(x => !workday(x) && x.kind === 'holiday')
  const loading = s.country && cal.status(s.country) === 'loading'

  const chips = costs.map(x => x.kind === 'team'
    ? `<li class="day-chip day-chip--team"><span class="day-date">${fmtDay(x.d)}</span> ${escHtml(x.label)}
        <button type="button" class="day-x" data-action="remove-day-off" data-date="${x.date}" aria-label="Remove ${fmtDay(x.d)} as a team day off">${X_ICON}</button></li>`
    : `<li class="day-chip day-chip--holiday"><span class="day-date">${fmtDay(x.d)}</span> ${escHtml(x.label)}</li>`).join('')
  // Team days outside the plan still exist and can still be removed.
  const outside = state.doc.daysOff.filter(t => !costs.some(x => x.date === t.date)).map(t =>
    `<li class="day-chip day-chip--muted" title="Outside the plan or on a weekend, so it costs nothing"><span class="day-date">${fmtDay(t.date, true)}</span> ${escHtml(t.label || 'Team day off')}
      <button type="button" class="day-x" data-action="remove-day-off" data-date="${t.date}" aria-label="Remove ${fmtDay(t.date)}">${X_ICON}</button></li>`).join('')

  const sprintList = windows.map(w =>
    `<li><span class="sprint-n">S${w.i + 1}</span> ${fmtDay(w.from)} to ${fmtDay(lastWorkday(w, s.daysPerWeek))}</li>`).join('')

  // Controls: set values only when the visitor is not in them.
  const sd = $('startDate')
  if (document.activeElement !== sd) sd.value = s.startDate
  const sel = $('teamCountry')
  const listKey = `${countries().length}:${s.country}`
  if (sel.dataset.list !== listKey) { sel.innerHTML = countryOptions(s.country); sel.dataset.list = listKey }
  if (document.activeElement !== sel) sel.value = s.country

  $('calRange').innerHTML = range
    ? `Runs <strong>${fmtDay(range.from, true)}</strong> to <strong>${fmtDay(lastWorkday({ from: range.from, to: range.to }, s.daysPerWeek), true)}</strong>`
    : 'Pick a start date'
  $('sprintStrip').innerHTML = sprintList
  $('calDaysHead').textContent = loading ? `Loading ${countryName(s.country)} holidays…`
    : (costs.length ? `${plural(costs.length, 'day')} off for everyone: ${plural(a.offPts, 'point')} less per full-time engineer`
      : s.country ? `No ${countryName(s.country)} holiday lands on a working day in this plan`
      : 'No days off for everyone yet') + (weekend.length ? ` · ${weekend.length} more on a weekend` : '')
  $('dayChips').innerHTML = chips + outside
  $('dayOffForm').elements.date.min = s.startDate
}
