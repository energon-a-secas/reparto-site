// ── Table formats ────────────────────────────────────────────
// One table ({ columns, rows } from tables.js) in the text formats people
// paste or open: CSV, tab-separated for a spreadsheet paste, Markdown.
// Pure, so test/tables.test.mjs parses the output back.

// A cell that starts with one of these is run as a formula by Excel and
// Sheets when a CSV is opened ("=HYPERLINK(...)" in a name, say). Text cells
// get a leading apostrophe, which both apps hide and neither evaluates.
const FORMULA = /^[=+\-@\t\r]/

function cellText(value, type) {
  if (value === null || value === undefined || value === '') return ''
  if (type === 'pct') return `${value}%`
  if (typeof value === 'number') return String(value)
  const s = String(value)
  return FORMULA.test(s) ? `'${s}` : s
}

const csvQuote = s => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s)

/** RFC 4180 CSV. `bom` makes Excel read UTF-8 (names like Méndez) instead of guessing. */
export function toCSV(table, { bom = true } = {}) {
  const lines = [table.columns.map(c => csvQuote(c.label)).join(',')]
  for (const r of table.rows) lines.push(table.columns.map(c => csvQuote(cellText(r[c.key], c.type))).join(','))
  return (bom ? '﻿' : '') + lines.join('\r\n') + '\r\n'
}

/**
 * Tab-separated, the format a paste into Google Sheets or Excel splits into
 * cells. Both treat a double quote as a text qualifier, so a cell holding one
 * is quoted and doubled, or '"Kiki" Ramos' loses its quotes and swallows the
 * rows after it.
 */
export function toTSV(table) {
  const flatCell = s => s.replace(/[\t\r\n]+/g, ' ')
  const clean = s => { const t = flatCell(s); return t.includes('"') ? `"${t.replace(/"/g, '""')}"` : t }
  const lines = [table.columns.map(c => clean(c.label)).join('\t')]
  for (const r of table.rows) lines.push(table.columns.map(c => clean(cellText(r[c.key], c.type))).join('\t'))
  return lines.join('\n') + '\n'
}

export function toMarkdownTable(table) {
  const esc = s => s.replace(/\|/g, '\\|').replace(/\r\n?|\n/g, ' ')
  const right = c => c.type !== 'text'
  const plain = (v, t) => (t === 'pct' && v !== null && v !== undefined && v !== '' ? `${v}%` : v === null || v === undefined ? '' : String(v))
  const head = `| ${table.columns.map(c => esc(c.label)).join(' | ')} |`
  const rule = `|${table.columns.map(c => (right(c) ? '---:' : '---')).join('|')}|`
  const body = table.rows.map(r => `| ${table.columns.map(c => esc(plain(r[c.key], c.type)) || ' ').join(' | ')} |`)
  return [head, rule, ...body].join('\n') + '\n'
}
