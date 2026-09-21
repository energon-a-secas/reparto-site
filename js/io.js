// ── Import, export, share ────────────────────────────────────
// A share link carries the whole plan in the URL fragment (#p=...), which
// the browser never sends to a server. Every way in goes through
// normalizeDoc(), the same gate as a saved session.

import { state, ui, resetTo, normalizeDoc } from './state.js'
import { analyze } from './capacity.js'
import { toMarkdown as reportMarkdown } from './report.js'
import { cal, countryName } from './holidays.js'
import { afterChange } from './render.js'
import { exportTable } from './export-dialog.js'
import { showToast, download, copyText, slug, plural } from './utils.js'

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
    ui.firstRun = false
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
    ui.firstRun = false
    resetTo(doc)
    afterChange()
    showToast(`Imported ${doc.title}: ${plural(doc.people.length, 'person', 'people')}, ${plural(doc.deliverables.length, 'deliverable')}`)
  } catch (err) {
    showToast(err instanceof SyntaxError ? 'Could not import: that file is not valid JSON' : 'Could not import: that file is not a Reparto plan')
  }
}

/** The whole plan as a Markdown report (report.js holds the pure part). */
export function toMarkdown(doc = state.doc) {
  return reportMarkdown(doc, analyze(doc, cal), { cal, countryName })
}

const TABLE_EXPORTS = new Set(['xlsx', 'csv', 'tsv', 'md-table'])

export async function runExport(kind) {
  if (TABLE_EXPORTS.has(kind)) { exportTable(kind); return }
  const name = slug(state.doc.title)
  if (kind === 'json') { download(`${name}.json`, JSON.stringify(state.doc, null, 2), 'application/json'); return }
  if (kind === 'md') { download(`${name}.md`, toMarkdown(), 'text/markdown'); return }
  if (kind === 'md-copy') { showToast(await copyText(toMarkdown()) ? 'Markdown copied' : 'Copy failed: use Download Markdown'); return }
  if (kind === 'link') {
    const ok = await copyText(shareUrl())
    showToast(ok ? 'Link copied. It carries the plan itself, so later edits need a new link' : 'Copy failed: your browser blocked the clipboard')
  }
}
