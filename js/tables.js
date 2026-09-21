// ── Tables ───────────────────────────────────────────────────
// The plan as rows and columns, for every export: the spreadsheet, CSV, the
// copy-for-Sheets clipboard and Markdown tables all read these. Pure: the
// document, its analysis and its flags go in, { name, columns, rows } comes
// out, so test/tables.test.mjs checks it under Node.
//
// A column is { key, label, type }: 'text', 'int', 'num' or 'pct'. A pct
// value is a percent number (50 means 50%); each format decides how to show it.

import { shareKey, ROUNDING } from './capacity.js'
import { planRange, fmtDay, lastWorkday } from './calendar.js'
import { deliverableStatus, statusText } from './flags.js'

const round1 = n => Math.round(n * 10) / 10
const pctText = p => `${p < 10 && !Number.isInteger(p) ? round1(p) : Math.round(p)}%`

/** Flag texts per target id, errors and warnings only, for the "Flags" column of a row. */
function flagsById(flags) {
  const out = new Map()
  for (const f of flags) {
    if (!f.target || f.level === 'info') continue
    for (const id of f.target.ids) {
      if (!out.has(id)) out.set(id, [])
      out.get(id).push(f.text)
    }
  }
  return out
}

export const TABLES = {
  deliverables: 'By deliverable',
  engineers: 'By engineer',
  assignments: 'Assignments',
  flags: 'Flags',
}

export function buildTable(kind, doc, a, flags, { countryName = c => c } = {}) {
  const people = new Map(doc.people.map(p => [p.id, p]))
  const nameOf = id => people.get(id)?.name.trim() || 'Unnamed'
  const byId = flagsById(flags)
  const unit = a.bookable || a.unit || 1

  if (kind === 'deliverables') {
    return {
      name: TABLES.deliverables,
      columns: [
        { key: 'name', label: 'Deliverable', type: 'text' },
        { key: 'estimate', label: 'Estimate (pts)', type: 'int' },
        { key: 'booked', label: 'Booked (pts)', type: 'int' },
        { key: 'gap', label: 'Short (pts)', type: 'int' },
        { key: 'engineers', label: 'Short (engineers)', type: 'num' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'count', label: 'People', type: 'int' },
        { key: 'split', label: 'Who, share of their capacity (pts)', type: 'text' },
        { key: 'flags', label: 'Flags', type: 'text' },
      ],
      rows: doc.deliverables.map(d => {
        const da = a.deliverables.get(d.id)
        return {
          name: d.name.trim() || 'Untitled deliverable',
          estimate: d.estimate ?? null,
          booked: da.got,
          gap: da.gap > 0 ? da.gap : 0,
          engineers: da.gap > 0 ? round1(da.gap / unit) : 0,
          status: statusText(deliverableStatus(d, da, a, doc)),
          count: d.members.length,
          split: d.members.map(m => {
            const sh = a.shares.get(shareKey(d.id, m.person))
            return `${nameOf(m.person)} ${pctText(sh.pct)} (${sh.points})`
          }).join('; '),
          flags: (byId.get(d.id) || []).join(' | '),
        }
      }),
    }
  }

  if (kind === 'engineers') {
    const team = doc.settings.countries
    return {
      name: TABLES.engineers,
      columns: [
        { key: 'name', label: 'Person', type: 'text' },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'country', label: 'Holidays from', type: 'text' },
        { key: 'open', label: 'Open role', type: 'text' },
        { key: 'load', label: 'Load on this team', type: 'pct' },
        { key: 'away', label: 'Sprints away', type: 'int' },
        { key: 'holidays', label: 'Holidays (days)', type: 'int' },
        { key: 'team', label: 'Team days off', type: 'int' },
        { key: 'vacation', label: 'Vacation (days)', type: 'int' },
        { key: 'raw', label: 'Capacity before rounding (pts)', type: 'num' },
        { key: 'cap', label: 'Planned capacity (pts)', type: 'int' },
        { key: 'used', label: 'Booked (pts)', type: 'int' },
        { key: 'pct', label: 'Booked (of their capacity)', type: 'pct' },
        { key: 'free', label: 'Free (pts, negative is over)', type: 'int' },
        { key: 'split', label: 'Split across deliverables (pts)', type: 'text' },
        { key: 'flags', label: 'Flags', type: 'text' },
      ],
      rows: doc.people.map(p => {
        const pa = a.people.get(p.id)
        const country = p.country || team[0] || ''
        return {
          name: nameOf(p.id),
          role: p.role,
          country: country ? `${countryName(country)}${p.country ? '' : ' (team default)'}` : 'None',
          open: p.open ? 'Yes' : 'No',
          load: p.load,
          away: pa.away,
          holidays: pa.lost.holiday,
          team: pa.lost.team,
          vacation: pa.lost.vacation,
          raw: round1(pa.raw),
          cap: pa.cap,
          used: pa.used,
          pct: round1(pa.pct),
          free: pa.free,
          split: doc.deliverables.filter(d => d.members.some(m => m.person === p.id)).map(d => {
            const sh = a.shares.get(shareKey(d.id, p.id))
            return `${d.name.trim() || 'Untitled deliverable'} ${pctText(sh.pct)} (${sh.points})`
          }).join('; '),
          flags: (byId.get(p.id) || []).join(' | '),
        }
      }),
    }
  }

  if (kind === 'assignments') {
    // Long format, one row per person per deliverable: the shape a pivot table wants.
    const rows = []
    for (const d of doc.deliverables) {
      for (const m of d.members) {
        const p = people.get(m.person), sh = a.shares.get(shareKey(d.id, m.person))
        const country = p?.country || doc.settings.countries[0] || ''
        rows.push({
          deliverable: d.name.trim() || 'Untitled deliverable',
          estimate: d.estimate ?? null,
          person: nameOf(m.person),
          role: p?.role || '',
          country: country ? countryName(country) : 'None',
          pct: round1(sh.pct),
          points: sh.points,
          cap: a.people.get(m.person)?.cap ?? 0,
        })
      }
    }
    return {
      name: TABLES.assignments,
      columns: [
        { key: 'deliverable', label: 'Deliverable', type: 'text' },
        { key: 'estimate', label: 'Estimate (pts)', type: 'int' },
        { key: 'person', label: 'Person', type: 'text' },
        { key: 'role', label: 'Role', type: 'text' },
        { key: 'country', label: 'Holidays from', type: 'text' },
        { key: 'pct', label: 'Share of their capacity', type: 'pct' },
        { key: 'points', label: 'Points', type: 'int' },
        { key: 'cap', label: 'Their planned capacity (pts)', type: 'int' },
      ],
      rows,
    }
  }

  if (kind === 'flags') {
    const deliv = new Map(doc.deliverables.map(d => [d.id, d.name.trim() || 'Untitled deliverable']))
    const LEVEL = { error: 'Error', warn: 'Warning', info: 'Note' }
    const CAT = { data: 'Missing data', people: 'Missing people', load: 'Load', practice: 'Practice' }
    return {
      name: TABLES.flags,
      columns: [
        { key: 'level', label: 'Level', type: 'text' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'finding', label: 'Finding', type: 'text' },
        { key: 'about', label: 'About', type: 'text' },
        { key: 'fix', label: 'Suggested fix', type: 'text' },
      ],
      rows: flags.map(f => ({
        level: LEVEL[f.level],
        category: CAT[f.cat],
        finding: f.text,
        about: !f.target ? 'The plan'
          : f.target.kind === 'settings' ? 'Settings'
          : f.target.ids.map(id => (f.target.kind === 'person' ? nameOf(id) : deliv.get(id) || id)).join(', '),
        fix: f.fix?.label || '',
      })),
    }
  }
  throw new Error(`Unknown table: ${kind}`)
}

/** Key/value rows describing the numbers, for the spreadsheet's Settings sheet. */
export function settingsTable(doc, a, { countryName = c => c } = {}) {
  const s = doc.settings, range = planRange(s)
  const rows = [
    ['Plan', doc.title],
    ['Starts', fmtDay(s.startDate, true)],
    ['Ends', range ? fmtDay(lastWorkday({ from: range.from, to: range.to }, s.daysPerWeek), true) : ''],
    ['Sprints', s.sprints],
    ['Weeks a sprint', s.weeksPerSprint],
    ['Working days a week', s.daysPerWeek],
    ['Meeting day taken out', s.meetingDay ? 'Yes' : 'No'],
    ['Focus days a week', a.focus],
    ['Points a focus day', s.pointsPerDay],
    ['Sprint cap (pts)', s.sprintCap || `Auto (${a.derived})`],
    ['Points a sprint', a.sprint],
    ['Buffer', `${s.buffer}%`],
    ['Rounding', ROUNDING[s.rounding]],
    ['Holiday countries', s.countries.map(countryName).join(', ') || 'None'],
    ['Default country', s.countries[0] ? countryName(s.countries[0]) : 'None'],
    ['Team days off', (doc.daysOff || []).map(t => `${fmtDay(t.date, true)} ${t.label}${t.country ? ` (${countryName(t.country)} only)` : ''}`).join('; ') || 'None'],
    ['One engineer before rounding (pts)', round1(a.unitRaw)],
    ['One engineer planned (pts)', a.unit],
    ['Rounding factor applied to everyone', Math.round(a.k * 1000) / 1000],
    ['One engineer bookable after the buffer (pts)', a.bookable],
    ['Team points per sprint', a.perSprint.map((p, i) => `S${i + 1} ${p}`).join('; ')],
    ['Public holidays marked as worked', (s.worked || []).map(w => `${w.country} ${fmtDay(w.date, true)}`).join('; ') || 'None'],
    ['Team capacity (pts)', a.capacity],
    ['Demand (pts)', a.demand],
    ['Booked (pts)', a.allocated],
    ['Short across deliverables (pts)', a.shortfall],
  ]
  return {
    name: 'Settings',
    columns: [{ key: 'k', label: 'Setting', type: 'text' }, { key: 'v', label: 'Value', type: 'text' }],
    rows: rows.map(([k, v]) => ({ k, v })),
  }
}
