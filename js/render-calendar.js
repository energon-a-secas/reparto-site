// ── Render: the calendar row under the formula ───────────────
// Start date, the team's holiday calendar, the sprint dates, and every day
// off that lands inside the plan. A holiday on a weekend is listed apart:
// it is real, it just costs nobody a focus day.

import { state } from './state.js'
import { sprintWindows, planRange, daysOffFor, parseISO, addDays, fmtDay } from './calendar.js'
import { countries, countryName, MAIN } from './holidays.js'
import { $, escHtml, plural } from './utils.js'

const X_ICON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

/**
 * Country <option>s: the "none" choice, then the team's countries, then the
 * main ones, then everyone else. A code the list does not know is kept.
 */
export function countryOptions(current, noneLabel = 'None', team = []) {
  const all = countries()
  const opt = code => `<option value="${code}"${code === current ? ' selected' : ''}>${escHtml(countryName(code))}</option>`
  const teamSet = new Set(team)
  const main = MAIN.filter(c => !teamSet.has(c))
  const rest = all.map(c => c.code).filter(c => !teamSet.has(c) && !MAIN.includes(c))
  const known = new Set([...team, ...MAIN, ...rest])
  return [
    `<option value="">${escHtml(noneLabel)}</option>`,
    current && !known.has(current) ? opt(current) : '',
    team.length ? `<optgroup label="Team countries">${team.map(opt).join('')}</optgroup>` : '',
    `<optgroup label="Main">${main.map(opt).join('')}</optgroup>`,
    rest.length ? `<optgroup label="All countries">${rest.map(opt).join('')}</optgroup>` : '',
  ].join('')
}

/** The six main countries as toggles, plus a removable chip for any other the team spans. */
function renderCountryPicks(s) {
  const on = new Set(s.countries)
  const extra = s.countries.filter(c => !MAIN.includes(c))
  $('countryPicks').innerHTML = MAIN.map(c =>
    `<button type="button" class="chip-btn" data-action="country-toggle" data-code="${c}" data-key="c-${c}" aria-pressed="${on.has(c)}">${escHtml(countryName(c))}</button>`
  ).join('') + extra.map(c =>
    `<span class="chip-btn chip-btn--on">${escHtml(countryName(c))}<button type="button" class="day-x" data-action="country-toggle" data-code="${c}" data-key="c-${c}" aria-label="Remove ${escHtml(countryName(c))}">${X_ICON}</button></span>`
  ).join('')
  const add = $('addCountry')
  const listKey = `${countries().length}:${s.countries.join(',')}`
  if (add.dataset.list !== listKey) {
    add.innerHTML = `<option value="">Other country…</option>` + countries()
      .filter(c => !on.has(c.code) && !MAIN.includes(c.code))
      .map(c => `<option value="${c.code}">${escHtml(c.name)}</option>`).join('')
    add.dataset.list = listKey
  }
  $('defaultWrap').hidden = s.countries.length < 2
  if (s.countries.length > 1) {
    $('defaultCountry').innerHTML = s.countries.map((c, i) => `<option value="${c}"${i === 0 ? ' selected' : ''}>${escHtml(countryName(c))}</option>`).join('')
  }
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

  const multi = s.countries.length > 1
  const inRange = d => range && d >= range.from && d < range.to
  const workday = d => (d.getUTCDay() || 7) <= s.daysPerWeek
  // Each country's holidays inside the plan: they cost the people who follow that country.
  const perCountry = s.countries.map(code => {
    const off = daysOffFor({ country: code, vacations: [] }, { ...state.doc, daysOff: [] }, cal.holidays)
    const days = [...off.entries()].map(([date, o]) => ({ date, ...o, d: parseISO(date) })).filter(x => inRange(x.d))
    return { code, costs: days.filter(x => workday(x.d)), weekend: days.filter(x => !workday(x.d)), loading: cal.status(code) === 'loading' }
  })
  const teamDays = state.doc.daysOff.map(t => ({ ...t, d: parseISO(t.date) }))
  const teamCosts = teamDays.filter(t => inRange(t.d) && workday(t.d))
  const loading = perCountry.some(c => c.loading)

  const chips = perCountry.flatMap(c => c.costs.map(x =>
    `<li class="day-chip day-chip--holiday">${multi ? `<span class="day-cc">${c.code}</span>` : ''}<span class="day-date">${fmtDay(x.d)}</span> ${escHtml(x.label)}</li>`)).join('')
    + teamCosts.map(t => `<li class="day-chip day-chip--team"><span class="day-date">${fmtDay(t.d)}</span> ${escHtml(t.label || 'Team day off')}
        <button type="button" class="day-x" data-action="remove-day-off" data-date="${t.date}" aria-label="Remove ${fmtDay(t.d)} as a team day off">${X_ICON}</button></li>`).join('')
  // Team days outside the plan or on a weekend still exist and can still be removed.
  const outside = teamDays.filter(t => !teamCosts.includes(t)).map(t =>
    `<li class="day-chip day-chip--muted" title="Outside the plan or on a weekend, so it costs nothing"><span class="day-date">${fmtDay(t.date, true)}</span> ${escHtml(t.label || 'Team day off')}
      <button type="button" class="day-x" data-action="remove-day-off" data-date="${t.date}" aria-label="Remove ${fmtDay(t.date)}">${X_ICON}</button></li>`).join('')
  const weekendN = perCountry.reduce((n, c) => n + c.weekend.length, 0)

  const sprintList = windows.map(w =>
    `<li><span class="sprint-n">S${w.i + 1}</span> ${fmtDay(w.from)} to ${fmtDay(lastWorkday(w, s.daysPerWeek))}</li>`).join('')

  // Controls: set values only when the visitor is not in them.
  const sd = $('startDate')
  if (document.activeElement !== sd) sd.value = s.startDate
  renderCountryPicks(s)

  $('calRange').innerHTML = range
    ? `Runs <strong>${fmtDay(range.from, true)}</strong> to <strong>${fmtDay(lastWorkday({ from: range.from, to: range.to }, s.daysPerWeek), true)}</strong>`
    : 'Pick a start date'
  $('sprintStrip').innerHTML = sprintList
  const byCountry = perCountry.map(c => `${countryName(c.code)} ${plural(c.costs.length, 'holiday')}`).join(', ')
  $('calDaysHead').textContent = loading ? 'Loading holidays…'
    : [s.countries.length ? `On working days in this plan: ${byCountry}` : 'No public holidays: pick the team\'s countries above',
       teamCosts.length ? `${plural(teamCosts.length, 'team day')} off for everyone` : '',
       weekendN ? `${weekendN} more on a weekend` : ''].filter(Boolean).join(' · ')
  $('dayChips').innerHTML = chips + outside
  $('dayOffForm').elements.date.min = s.startDate
  // The folded line: enough to trust the numbers without opening the panel.
  const vacations = [...a.people.values()].reduce((n, p) => n + p.lost.vacation, 0)
  $('calSummary').textContent = [
    range ? `${fmtDay(range.from)} to ${fmtDay(lastWorkday({ from: range.from, to: range.to }, s.daysPerWeek), true)}` : 'no start date',
    plural(s.sprints, 'sprint'),
    s.countries.length ? s.countries.map(countryName).join(' + ') : 'no holidays',
    loading ? 'loading…' : `${plural(a.offDays, 'day')} off for a full-timer`,
    vacations ? plural(vacations, 'vacation day') : '',
  ].filter(Boolean).join(' · ')
}
