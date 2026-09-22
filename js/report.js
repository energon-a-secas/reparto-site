// ── The Markdown report ──────────────────────────────────────
// The whole plan as one document for a status update: the formula, the
// calendar, the totals, the deliverables, the people and the flags. Pure
// (the analysis, the holiday lookup, a country namer and today's date go
// in), so test/tables.test.mjs pins it under Node.

import { shareKey, ROUNDING } from './capacity.js'
import { computeFlags, deliverableStatus, statusText, missingPeople, engineers, leaveLines, CATEGORIES } from './flags.js'
import { planRange, sprintWindows, lastWorkday, fmtDay, fmtSpan, parseISO } from './calendar.js'
import { PRIORITIES, PROGRESS, priorityOf, progressOf } from './planning.js'

// CommonMark ends a line at LF, CRLF or a lone CR: flatten all three.
const flat = s => String(s ?? '').replace(/\r\n?|\n/g, ' ')
const cell = s => flat(s).replace(/\|/g, '\\|')
// A list item that starts with '#', '>', '-', '+', '*' or '1.' would open a heading, quote or list.
const lead = s => flat(s).replace(/^(\s*)(#{1,6}(?=\s|$)|[>+*-](?=\s))/, '$1\\$2').replace(/^(\s*\d+)([.)](?=\s))/, '$1\\$2')
const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`
const pctText = p => `${p < 10 && !Number.isInteger(p) ? Math.round(p * 10) / 10 : Math.round(p)}%`
const r1 = n => (Number.isInteger(n) ? String(n) : n.toFixed(1))

export function toMarkdown(doc, a, { cal, countryName = c => c, today = new Date() } = {}) {
  const s = doc.settings
  const range = planRange(s)
  const end = range ? lastWorkday({ from: range.from, to: range.to }, s.daysPerWeek) : null
  const name = id => doc.people.find(p => p.id === id)?.name.trim() || 'Unnamed'
  const flags = computeFlags(doc, a)

  // The formula, one step per change: no "= 32 = 32" when nothing was taken out.
  const steps = [`${s.weeksPerSprint}-week sprints × ${a.focus} focus days a week × ${s.pointsPerDay} pt = ${a.derived}${a.sprint < a.derived ? `, capped at ${a.sprint}` : ''} pts a sprint`, `× ${s.sprints} sprints = ${a.base}`]
  if (a.offPts) steps.push(`− ${a.offPts} for ${plural(a.offDays, 'day')} off = ${r1(a.unitRaw)}`)
  if (a.unit !== Math.round(a.unitRaw) || !Number.isInteger(a.unitRaw)) steps.push(`→ **${a.unit}** planned (${ROUNDING[s.rounding]})`)
  else steps.push(`→ **${a.unit}** planned`)
  if (a.held) steps.push(`− ${s.buffer}% buffer = **${a.bookable}** bookable`)

  // Holidays taken out, named per country; worked ones are not listed.
  const worked = new Set((s.worked || []).map(w => `${w.country}|${w.date}`))
  // Every calendar anyone follows: the team's countries, then any person's own.
  const followed = [...new Set([...s.countries, ...doc.people.map(p => p.country)].filter(Boolean))]
  const named = followed.map(code => {
    const days = []
    if (range && cal) {
      for (let y = range.from.getUTCFullYear(); y <= range.last.getUTCFullYear(); y++) {
        for (const [date] of cal.holidays(code, y) || []) {
          const d = parseISO(date)
          if (d && d >= range.from && d < range.to && (d.getUTCDay() || 7) <= s.daysPerWeek && !worked.has(`${code}|${date}`)) days.push(fmtDay(d))
        }
      }
    }
    return `${countryName(code)}: ${days.join(', ') || 'none on a working day'}`
  })
  const mp = missingPeople(doc, a)

  const lines = [
    `# ${flat(doc.title)}`,
    '',
    `As of ${fmtDay(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())), true)}.`,
    '',
    `**One engineer:** ${steps.join(' ')}. Everyone else is their own capacity scaled by the same factor.`,
    '',
    `**Calendar:** starts ${fmtDay(s.startDate, true)}${end ? `, ends ${fmtDay(end, true)}` : ''} · holidays taken out: ${named.join('; ') || 'none (no countries picked)'}`
      + `${doc.daysOff.length ? ` · team days off: ${doc.daysOff.map(t => `${fmtDay(t.date)} ${flat(t.label)}${t.country ? ` (${countryName(t.country)} only)` : ''}`).join(', ')}` : ''}`
      + `${(s.worked || []).length ? ` · worked holidays: ${s.worked.map(w => `${countryName(w.country)} ${fmtDay(w.date)}`).join(', ')}` : ''}`,
    '',
    `**Sprints:** ${sprintWindows(s).map(w => `S${w.i + 1} ${fmtDay(w.from)} to ${fmtDay(lastWorkday(w, s.daysPerWeek))} ${a.perSprint[w.i] ?? 0} pts`).join(' · ')}`,
    '',
    `**Team:** ${a.capacity} pts capacity · ${a.demand} pts demand · ${a.allocated} booked · missing people: ${mp.points} pts${mp.points ? ` (${engineers(mp.points, a.bookable || a.unit)})` : ''}${mp.unstaffed ? ` · ${mp.unstaffed} unstaffed` : ''}`,
    '',
    '## Deliverables',
    '',
    '| Deliverable | Estimate | Booked | People | Staffing | Priority | Progress | Note |',
    '|---|---:|---:|---|---|---|---|---|',
    ...doc.deliverables.map(d => {
      const da = a.deliverables.get(d.id)
      const who = d.members.map(m => { const sh = a.shares.get(shareKey(d.id, m.person)); return `${name(m.person)} ${sh.points} (${pctText(sh.pct)})` })
      // A short deliverable says which leave made it short.
      const leave = da.gap > 0 && da.leavePts ? `; leave: ${leaveLines(da, doc, a).join(', ')}` : ''
      return `| ${cell(d.name.trim() || 'Untitled deliverable')} | ${d.estimate ?? '?'} | ${da.got} | ${cell(who.join(', ') || 'none')} | ${cell(statusText(deliverableStatus(d, da, a, doc)) + leave)} | ${PRIORITIES[priorityOf(d)].label} | ${PROGRESS[progressOf(d)].label} | ${cell(d.note) || ' '} |`
    }),
    '',
    '## People',
    '',
    '| Person | Role | Country | Days off | Capacity | Booked | Of their capacity | Free | On |',
    '|---|---|---|---|---:|---:|---:|---:|---|',
    ...doc.people.map(p => {
      const pa = a.people.get(p.id)
      // Only the periods that cost a working day in this plan, as the leave lines name them.
      const vac = (p.vacations || []).filter(v => pa.vacationDays.some(d => d >= v.from && d <= v.to)).map(v => fmtSpan(v.from, v.to)).filter(Boolean).join(', ')
      const off = [
        pa.lost.holiday && `${pa.lost.holiday} holiday`,
        pa.lost.team && `${pa.lost.team} team`,
        pa.lost.vacation && `${pa.lost.vacation} vacation${vac ? `, ${vac}` : ''}`,
        pa.away && `${plural(pa.away, 'sprint')} away`,
      ].filter(Boolean).join('; ') || 'none'
      const country = p.country ? countryName(p.country) : s.countries.length ? `${countryName(s.countries[0])} (default)` : 'none'
      const on = doc.deliverables.filter(d => d.members.some(m => m.person === p.id)).map(d => {
        const sh = a.shares.get(shareKey(d.id, p.id))
        return `${d.name.trim() || 'Untitled deliverable'} ${sh.points} (${pctText(sh.pct)})`
      }).join(', ') || 'nothing yet'
      return `| ${cell(p.name.trim() || 'Unnamed')}${p.open ? ' (open role)' : ''} | ${cell(p.role) || 'none'} | ${cell(country)} | ${cell(off)} | ${pa.cap} | ${pa.used} | ${pctText(pa.pct)} | ${pa.free} | ${cell(on)} |`
    }),
  ]
  // Out of the plan: listed so the report says where they went, never counted.
  for (const [when, title] of [['later', 'Later'], ['done', 'Done']]) {
    const list = (doc.backlog || []).filter(d => d.when === when)
    if (!list.length) continue
    lines.push('', `## ${title}`, '', `Not counted in this plan.`, '')
    for (const d of list) {
      const who = d.members.map(m => name(m.person)).join(', ')
      lines.push(`- ${lead(d.name.trim() || 'Untitled deliverable')}${d.estimate ? `, ${plural(d.estimate, 'pt')}` : ', unsized'}, ${PRIORITIES[priorityOf(d)].label} priority, ${PROGRESS[progressOf(d)].label.toLowerCase()}${who ? `, ${flat(who)}` : ''}${d.note ? `: ${flat(d.note)}` : ''}`)
    }
  }
  if (flags.length) {
    lines.push('', '## Flags', '')
    for (const f of flags) lines.push(`- **${{ error: 'Error', warn: 'Warning', info: 'Note' }[f.level]}** (${CATEGORIES[f.cat]}): ${flat(f.text)}${f.fix ? ` Suggested fix: ${flat(f.fix.label)}.` : ''}`)
  }
  lines.push('', 'Made with [Reparto](https://reparto.neorgon.com/).', '')
  return lines.join('\n')
}
