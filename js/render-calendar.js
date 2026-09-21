// ── Render: the calendar row under the formula ───────────────
// Start date, the team's holiday calendar, the sprint dates, and every day
// off that lands inside the plan. A holiday on a weekend is listed apart:
// it is real, it just costs nobody a focus day.

import { state } from './state.js'
import { sprintWindows, planRange, daysOffFor, parseISO, fmtDay, lastWorkday } from './calendar.js'
import { countries, countryName, MAIN, TAGS } from './holidays.js'
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

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Sprints and their weeks count from the start date, which is not obvious when it is not a Monday. */
function weeksNote(start, s) {
  const first = WEEKDAYS[start.getUTCDay()], last = WEEKDAYS[(start.getUTCDay() + 6) % 7]
  const workdays = `${WEEKDAYS[1]} to ${WEEKDAYS[s.daysPerWeek % 7]}`
  const len = `${s.weeksPerSprint === 1 ? 'one week' : `${s.weeksPerSprint} weeks`}`
  return start.getUTCDay() === 1
    ? `Sprints and their weeks count from the start date: each sprint is ${len}, Monday to Sunday. Move the start date and every sprint moves with it.`
    : `Sprints and their weeks count from the start date, a ${first}: each week runs ${first} to ${last}, and each sprint is ${len}. Working days are still ${workdays}, and the meeting day comes out of each of those weeks.`
}

export function renderCalendar(a, cal) {
  const s = state.doc.settings
  const range = planRange(s)
  const windows = sprintWindows(s)

  const multi = s.countries.length > 1
  const inRange = d => range && d >= range.from && d < range.to
  const workday = d => (d.getUTCDay() || 7) <= s.daysPerWeek
  const worked = new Set((s.worked || []).map(w => `${w.country}|${w.date}`))
  // Each country's public holidays inside the plan, worked or not: they cost the people who follow that country.
  const perCountry = s.countries.map(code => {
    const days = []
    if (range) {
      for (let y = range.from.getUTCFullYear(); y <= range.last.getUTCFullYear(); y++) {
        for (const [date, name, local] of cal.holidays(code, y) || []) {
          const d = parseISO(date)
          if (d && inRange(d)) days.push({ date, d, label: local || name, worked: worked.has(`${code}|${date}`) })
        }
      }
    }
    return { code, costs: days.filter(x => workday(x.d) && !x.worked), worked: days.filter(x => x.worked), weekend: days.filter(x => !workday(x.d)), loading: cal.status(code) === 'loading' }
  })
  const teamDays = state.doc.daysOff.map(t => ({ ...t, d: parseISO(t.date) }))
  const teamCosts = teamDays.filter(t => inRange(t.d) && workday(t.d))
  const loading = perCountry.some(c => c.loading)
  const who = t => (t.country ? `<span class="day-cc">${t.country}</span>` : '')

  // A holiday the data tags (a US federal day many firms work, an Argentine bridge day) says so, with its reason on hover.
  const tagOf = (code, date) => TAGS[cal.tag?.(code, date)]
  const tagChip = t => (t ? `<span class="day-tag" title="${escHtml(t.title)}">${t.label}</span>` : '')
  const chips = perCountry.flatMap(c => [
    ...c.costs.map(x => `<li class="day-chip day-chip--holiday">${multi ? `<span class="day-cc">${c.code}</span>` : ''}<span class="day-date">${fmtDay(x.d)}</span> ${escHtml(x.label)}${tagChip(tagOf(c.code, x.date))}
      <button type="button" class="day-x" data-action="work-holiday" data-code="${c.code}" data-date="${x.date}" aria-label="Count ${fmtDay(x.d)} as a working day in ${escHtml(countryName(c.code))}" title="The team works this day">${X_ICON}</button></li>`),
    ...c.worked.map(x => `<li class="day-chip day-chip--muted" title="Marked as a working day"><span class="day-cc">${c.code}</span><span class="day-date">${fmtDay(x.d)}</span> <s>${escHtml(x.label)}</s> worked
      <button type="button" class="day-restore" data-action="unwork-holiday" data-code="${c.code}" data-date="${x.date}" aria-label="Count ${fmtDay(x.d)} as a holiday in ${escHtml(countryName(c.code))} again">Restore</button></li>`),
    // Two or more of one kind: work them all in one step.
    ...Object.keys(TAGS).map(tag => {
      const n = c.costs.filter(x => cal.tag?.(c.code, x.date) === tag).length
      return n > 1 ? `<li class="day-bulk"><button type="button" class="chip-btn" data-action="work-tagged" data-code="${c.code}" data-tag="${tag}" title="${escHtml(TAGS[tag].title)}">Work all ${n} ${TAGS[tag].many}${multi ? ` (${c.code})` : ''}</button></li>` : ''
    }),
  ]).join('')
    + teamCosts.map(t => `<li class="day-chip day-chip--team">${who(t)}<span class="day-date">${fmtDay(t.d)}</span> ${escHtml(t.label || 'Team day off')}
        <button type="button" class="day-x" data-action="remove-day-off" data-date="${t.date}" data-code="${t.country || ''}" aria-label="Remove ${fmtDay(t.d)} as a team day off">${X_ICON}</button></li>`).join('')
  // Team days outside the plan or on a weekend still exist and can still be removed.
  const outside = teamDays.filter(t => !teamCosts.includes(t)).map(t =>
    `<li class="day-chip day-chip--muted" title="Outside the plan or on a weekend, so it costs nothing">${who(t)}<span class="day-date">${fmtDay(t.date, true)}</span> ${escHtml(t.label || 'Team day off')}
      <button type="button" class="day-x" data-action="remove-day-off" data-date="${t.date}" data-code="${t.country || ''}" aria-label="Remove ${fmtDay(t.date)}">${X_ICON}</button></li>`).join('')
  const weekendN = perCountry.reduce((n, c) => n + c.weekend.length, 0)

  // Team points in each sprint: a sprint far below the others (holidays, vacations) is where a plan slips.
  const sorted = [...a.perSprint].sort((x, y) => x - y)
  const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0
  const sprintList = windows.map(w => {
    const pts = a.perSprint[w.i] ?? 0
    const low = state.doc.people.length && median && pts < median * 0.75
    return `<li class="${low ? 'sprint--low' : ''}" title="${low ? 'Well below the other sprints: holidays or vacations cluster here' : ''}"><span class="sprint-n">S${w.i + 1}</span> ${fmtDay(w.from)} to ${fmtDay(lastWorkday(w, s.daysPerWeek))}${state.doc.people.length ? ` <span class="sprint-pts">· ${pts} pts</span>` : ''}</li>`
  }).join('')

  // Controls: set values only when the visitor is not in them.
  const sd = $('startDate')
  if (document.activeElement !== sd) sd.value = s.startDate
  renderCountryPicks(s)

  $('calRange').innerHTML = range
    ? `Runs <strong>${fmtDay(range.from, true)}</strong> to <strong>${fmtDay(lastWorkday({ from: range.from, to: range.to }, s.daysPerWeek), true)}</strong>`
    : 'Pick a start date'
  $('sprintStrip').innerHTML = sprintList
  $('calNote').textContent = range ? weeksNote(range.from, s) : ''
  const byCountry = perCountry.map(c => `${countryName(c.code)} ${plural(c.costs.length, 'holiday')}`).join(', ')
  $('calDaysHead').textContent = loading ? 'Loading holidays…'
    : [s.countries.length ? `On working days in this plan: ${byCountry}` : 'No public holidays: pick the team\'s countries above',
       teamCosts.length ? `${plural(teamCosts.length, 'team day')} off for everyone` : '',
       weekendN ? `${weekendN} more on a weekend` : ''].filter(Boolean).join(' · ')
  $('dayChips').innerHTML = chips + outside
  $('dayOffForm').elements.date.min = s.startDate
  const whoSel = $('dayOffForm').elements.country
  const whoKey = s.countries.join(',')
  if (whoSel.dataset.list !== whoKey) {
    whoSel.innerHTML = `<option value="">Everyone</option>` + s.countries.map(c => `<option value="${c}">${escHtml(countryName(c))} only</option>`).join('')
    whoSel.dataset.list = whoKey
  }
  whoSel.hidden = s.countries.length < 2
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
