// ── Import, export, share ────────────────────────────────────
// A share link carries the whole plan in the URL fragment (#p=...), which
// the browser never sends to a server. Every way in goes through
// normalizeDoc(), the same gate as a saved session.

import { state, resetTo, normalizeDoc } from './state.js'
import { analyze, ROUNDING, shareKey } from './capacity.js'
import { cal, countryName } from './holidays.js'
import { planRange, fmtDay } from './calendar.js'
import { computeFlags, CATEGORIES } from './flags.js'
import { afterChange } from './render.js'
import { showToast, download, copyText, slug, plural, fmtPct } from './utils.js'

const PREFIX = '#p='

function encode(doc) {
  const bytes = new TextEncoder().encode(JSON.stringify(doc))
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function decode(text) {
  const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0))))
}

export const shareUrl = () => `${location.origin}${location.pathname}${PREFIX}${encode(state.doc)}`

/** Load a plan from #p= if present. The replaced plan stays one undo away. */
export function loadFromHash() {
  if (!location.hash.startsWith(PREFIX)) return false
  try {
    resetTo(decode(location.hash.slice(PREFIX.length)))
    history.replaceState(null, '', location.pathname + location.search)
    return true
  } catch {
    showToast('That share link is damaged, so your own plan stayed')
    return false
  }
}

export async function importFile(file) {
  try {
    const doc = normalizeDoc(JSON.parse(await file.text()))
    resetTo(doc)
    afterChange()
    showToast(`Imported ${doc.title}: ${plural(doc.people.length, 'person', 'people')}, ${plural(doc.deliverables.length, 'deliverable')}`)
  } catch (err) {
    showToast(err instanceof SyntaxError ? 'Could not import: that file is not valid JSON' : 'Could not import: that file is not a Reparto plan')
  }
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function toMarkdown(doc = state.doc) {
  const a = analyze(doc, cal)
  const s = doc.settings
  const range = planRange(s)
  const name = id => doc.people.find(p => p.id === id)?.name || 'Unnamed'
  const lines = [
    `# ${doc.title}`,
    '',
    `**One engineer:** ${s.weeksPerSprint}-week sprints × ${a.focus} focus days a week × ${s.pointsPerDay} pt = ${a.sprint} pts a sprint; × ${s.sprints} sprints = ${a.base}${a.offPts ? ` − ${a.offPts} for ${plural(a.offDays, 'day')} off` : ''}${s.buffer ? `, ${s.buffer}% buffer` : ''} = ${+a.unitRaw.toFixed(1)}, planned as **${a.unit}** (${ROUNDING[s.rounding]}).`,
    '',
    `**Calendar:** starts ${fmtDay(s.startDate, true)}${range ? `, ends ${fmtDay(range.last, true)}` : ''} · public holidays: ${s.countries.length ? s.countries.map(countryName).join(', ') + ` (default ${countryName(s.countries[0])})` : 'none'}${doc.daysOff.length ? ` · team days off: ${doc.daysOff.map(t => `${fmtDay(t.date)} ${t.label}`).join(', ')}` : ''}`,
    '',
    `**Team:** ${a.capacity} pts capacity · ${a.demand} pts demand · ${a.allocated} booked · ${a.shortfall} short`,
    '',
    '## Deliverables',
    '',
    '| Deliverable | Estimate | Booked | People | Status |',
    '|---|---:|---:|---|---|',
    ...doc.deliverables.map(d => {
      const da = a.deliverables.get(d.id)
      const st = !d.estimate ? 'Unsized' : !d.members.length ? 'Nobody on it' : da.gap > 0 ? `Short ${da.gap}` : da.gap < 0 ? `${-da.gap} over` : 'Staffed'
      const who = d.members.map(m => { const sh = a.shares.get(shareKey(d.id, m.person)); return `${name(m.person)} ${sh.points} (${fmtPct(sh.pct)})` })
      return `| ${cell(d.name || 'Untitled')} | ${d.estimate ?? '?'} | ${da.got} | ${cell(who.join(', ') || 'none')} | ${st} |`
    }),
    '',
    '## People',
    '',
    '| Person | Role | Country | Days off | Capacity | Booked | Of their time | Free |',
    '|---|---|---|---|---:|---:|---:|---:|',
    ...doc.people.map(p => {
      const pa = a.people.get(p.id)
      const off = [pa.lost.holiday && `${pa.lost.holiday} holiday`, pa.lost.team && `${pa.lost.team} team`, pa.lost.vacation && `${pa.lost.vacation} vacation`, pa.away && `${plural(pa.away, 'sprint')} away`].filter(Boolean).join(', ') || 'none'
      const country = p.country ? countryName(p.country) : s.countries.length ? `${countryName(s.countries[0])} (default)` : 'none'
      return `| ${cell(p.name || 'Unnamed')}${p.open ? ' (open role)' : ''} | ${cell(p.role) || 'none'} | ${country} | ${off} | ${pa.cap} | ${pa.used} | ${fmtPct(pa.pct)} | ${pa.free} |`
    }),
  ]
  const flags = computeFlags(doc, a)
  if (flags.length) {
    lines.push('', '## Flags', '')
    for (const f of flags) lines.push(`- **${{ error: 'Error', warn: 'Warning', info: 'Note' }[f.level]}** (${CATEGORIES[f.cat]}): ${f.text}`)
  }
  lines.push('', `Made with [Reparto](https://reparto.neorgon.com/).`, '')
  return lines.join('\n')
}

export async function runExport(kind) {
  const name = slug(state.doc.title)
  if (kind === 'json') { download(`${name}.json`, JSON.stringify(state.doc, null, 2), 'application/json'); return }
  if (kind === 'md') { download(`${name}.md`, toMarkdown(), 'text/markdown'); return }
  if (kind === 'md-copy') { showToast(await copyText(toMarkdown()) ? 'Markdown copied' : 'Copy failed: use Download Markdown'); return }
  if (kind === 'link') {
    const ok = await copyText(shareUrl())
    showToast(ok ? 'Link copied. It carries the plan itself, so later edits need a new link' : 'Copy failed: your browser blocked the clipboard')
  }
}
