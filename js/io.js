// ── Import, export, share ────────────────────────────────────
// A share link carries the whole plan in the URL fragment (#p=...), which
// the browser never sends to a server. Every way in goes through
// normalizeDoc(), the same gate as a saved session.

import { state, resetTo, normalizeDoc } from './state.js'
import { analyze, ROUNDING } from './capacity.js'
import { computeFlags, CATEGORIES } from './flags.js'
import { afterChange } from './render.js'
import { showToast, download, copyText, slug } from './utils.js'

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
    showToast(`Imported ${doc.title}: ${doc.people.length} people, ${doc.deliverables.length} deliverables`)
  } catch (err) {
    showToast(`Could not import: ${err.message}`)
  }
}

const cell = s => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ')

export function toMarkdown(doc = state.doc) {
  const a = analyze(doc)
  const s = doc.settings
  const name = id => doc.people.find(p => p.id === id)?.name || 'Unnamed'
  const lines = [
    `# ${doc.title}`,
    '',
    `**One engineer:** ${s.weeksPerSprint}-week sprints × ${a.focus} focus days a week × ${s.pointsPerDay} pt = ${a.sprint} pts a sprint; × ${s.sprints} sprints${s.buffer ? `, ${s.buffer}% buffer` : ''} = ${+a.unitRaw.toFixed(1)}, planned as **${a.unit}** (${ROUNDING[s.rounding]}).`,
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
      return `| ${cell(d.name || 'Untitled')} | ${d.estimate ?? '?'} | ${da.got} | ${cell(d.members.map(m => `${name(m.person)} ${m.points}`).join(', ') || 'none')} | ${st} |`
    }),
    '',
    '## People',
    '',
    '| Person | Role | Capacity | Booked | Free |',
    '|---|---|---:|---:|---:|',
    ...doc.people.map(p => {
      const pa = a.people.get(p.id)
      return `| ${cell(p.name || 'Unnamed')}${p.open ? ' (open role)' : ''} | ${cell(p.role) || 'none'} | ${pa.cap} | ${pa.used} | ${pa.free} |`
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
