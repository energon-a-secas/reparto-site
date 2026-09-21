// ── Export dialog ────────────────────────────────────────────
// Pick a table (by deliverable, by engineer, assignments, flags), see its
// first rows, and take it out: the whole workbook as .xlsx, or the table on
// screen as CSV, a paste for Sheets or Excel, or Markdown. The rows come from
// tables.js, the formats from formats.js and xlsx.js, so the preview and
// the file cannot disagree.

import { state } from './state.js'
import { analyze } from './capacity.js'
import { computeFlags } from './flags.js'
import { buildTable, settingsTable, TABLES } from './tables.js'
import { toCSV, toTSV, toMarkdownTable } from './formats.js'
import { buildXlsx } from './xlsx.js'
import { cal, countryName } from './holidays.js'
import { openModal } from './modal.js'
import { $, escHtml, showToast, download, copyText, slug, plural } from './utils.js'

const HINTS = {
  deliverables: 'One row per deliverable: its estimate, what is booked, the gap in points and in engineers, who is on it with their share of their time, and its flags.',
  engineers: 'One row per person: capacity after holidays, vacations and load, what is booked, how their time is split across deliverables, and their flags.',
  assignments: 'One row per person per deliverable, with their share and its points: the shape a pivot table wants.',
  flags: 'Every flag the plan raises: its level, category, what it is about, and the suggested fix.',
  backlog: 'The deliverables moved out of this plan, to Later or Done: their size, who was on them and their note. They count toward nothing.',
}
const PREVIEW_ROWS = 8
let current = 'deliverables'

function snapshot() {
  const doc = state.doc
  const a = analyze(doc, cal)
  return { doc, a, flags: computeFlags(doc, a), opts: { countryName } }
}
const table = (kind, s = snapshot()) => buildTable(kind, s.doc, s.a, s.flags, s.opts)

export function openExport(kind) {
  if (kind && TABLES[kind]) current = kind
  render()
  openModal('exportModal')
  $('exportTables').querySelector('[aria-checked="true"]')?.focus()
}

function render() {
  $('exportTables').innerHTML = Object.entries(TABLES).map(([k, label]) =>
    `<button type="button" class="seg-btn" role="radio" data-export-table="${k}" aria-checked="${k === current}" tabindex="${k === current ? 0 : -1}">${label}</button>`).join('')
  $('exportHint').textContent = HINTS[current]
  const t = table(current)
  const cell = (v, type) => (v === null || v === undefined ? '' : type === 'pct' ? `${v}%` : String(v))
  $('exportPreview').innerHTML = t.rows.length
    ? `<table class="xtable">
        <thead><tr>${t.columns.map(c => `<th scope="col" class="${c.type === 'text' ? '' : 'num'}">${escHtml(c.label)}</th>`).join('')}</tr></thead>
        <tbody>${t.rows.slice(0, PREVIEW_ROWS).map(r => `<tr>${t.columns.map(c => `<td class="${c.type === 'text' ? '' : 'num'}">${escHtml(cell(r[c.key], c.type))}</td>`).join('')}</tr>`).join('')}</tbody>
      </table>
      <p class="xtable-foot">${plural(t.rows.length, 'row')}${t.rows.length > PREVIEW_ROWS ? `, the first ${PREVIEW_ROWS} shown` : ''} · ${plural(t.columns.length, 'column')}</p>`
    : `<p class="xtable-foot">This table is empty: ${current === 'flags' ? 'nothing is flagged.' : current === 'backlog' ? 'nothing is in Later or Done.' : 'add people and deliverables first.'}</p>`
}

/** Switch tables from the segmented control, by click or arrow keys. */
export function bindExportDialog() {
  const seg = $('exportTables')
  seg.addEventListener('click', e => {
    const b = e.target.closest('[data-export-table]'); if (!b) return
    current = b.dataset.exportTable; render()
    seg.querySelector('[aria-checked="true"]')?.focus()
  })
  seg.addEventListener('keydown', e => {
    const keys = Object.keys(TABLES), i = keys.indexOf(current)
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key]
    if (!step) return
    e.preventDefault()
    current = keys[(i + step + keys.length) % keys.length]; render()
    seg.querySelector('[aria-checked="true"]')?.focus()
  })
}

const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

/** kind: xlsx (every table), csv, tsv, md-table (the table on screen). */
export async function exportTable(kind) {
  const s = snapshot()
  const name = slug(s.doc.title)
  if (kind === 'xlsx') {
    const tables = Object.keys(TABLES).map(k => table(k, s))
    tables.push(settingsTable(s.doc, s.a, s.opts))
    download(`${name}.xlsx`, buildXlsx(tables, { title: s.doc.title }), XLSX_TYPE)
    showToast(`Spreadsheet saved: ${tables.length} sheets`)
    return
  }
  const t = table(current, s)
  const suffix = TABLES[current].toLowerCase().replace(/\s+/g, '-')
  if (kind === 'csv') { download(`${name}-${suffix}.csv`, toCSV(t), 'text/csv;charset=utf-8'); return }
  if (kind === 'tsv') {
    showToast(await copyText(toTSV(t)) ? `${TABLES[current]} copied: paste into a sheet and it splits into cells` : 'Copy failed: use Download CSV')
    return
  }
  if (kind === 'md-table') showToast(await copyText(toMarkdownTable(t)) ? `${TABLES[current]} copied as a Markdown table` : 'Copy failed: your browser blocked the clipboard')
}
