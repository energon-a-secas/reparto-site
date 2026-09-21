// node --test test/*.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { inflateRawSync } from 'node:zlib'
import { analyze, shareKey } from '../js/capacity.js'
import { computeFlags } from '../js/flags.js'
import { buildTable, settingsTable, TABLES } from '../js/tables.js'
import { toCSV, toTSV, toMarkdownTable } from '../js/formats.js'
import { buildXlsx } from '../js/xlsx.js'

globalThis.localStorage ??= { getItem: () => null, setItem() {} }
const { normalizeDoc } = await import('../js/state.js')
const { examplePlan } = await import('../js/seed.js')

const CL = JSON.parse(fs.readFileSync(new URL('../data/holidays/CL.json', import.meta.url)))
const MX = JSON.parse(fs.readFileSync(new URL('../data/holidays/MX.json', import.meta.url)))
const cal = { holidays: (c, y) => ({ CL, MX })[c]?.years[y] || null, status: () => 'ok' }

function example(edit) {
  const raw = examplePlan()
  raw.settings.startDate = '2026-10-05'            // fixed dates: the example follows the calendar otherwise
  edit?.(raw)
  const doc = normalizeDoc(raw)
  const a = analyze(doc, cal)
  return { doc, a, flags: computeFlags(doc, a) }
}

/** A minimal RFC 4180 reader, to prove the writer round-trips. */
function parseCSV(text) {
  const rows = [[]]; let cur = '', q = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++ } else q = false } else cur += ch }
    else if (ch === '"') q = true
    else if (ch === ',') { rows.at(-1).push(cur); cur = '' }
    else if (ch === '\r') continue
    else if (ch === '\n') { rows.at(-1).push(cur); cur = ''; rows.push([]) }
    else cur += ch
  }
  if (cur || rows.at(-1).length) rows.at(-1).push(cur)
  return rows.filter(r => r.length && !(r.length === 1 && r[0] === ''))
}

/** Read a zip through its central directory; stored or deflated entries, CRCs checked by length only. */
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let end = bytes.length - 22
  while (dv.getUint32(end, true) !== 0x06054b50) end--
  const count = dv.getUint16(end + 10, true)
  let p = dv.getUint32(end + 16, true)
  const out = {}
  for (let i = 0; i < count; i++) {
    assert.equal(dv.getUint32(p, true), 0x02014b50)
    const method = dv.getUint16(p + 10, true), size = dv.getUint32(p + 20, true)
    const nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true)
    const local = dv.getUint32(p + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen))
    assert.equal(dv.getUint32(local, true), 0x04034b50, `local header for ${name}`)
    const start = local + 30 + dv.getUint16(local + 26, true) + dv.getUint16(local + 28, true)
    const raw = bytes.subarray(start, start + dv.getUint32(p + 20, true))
    const data = method === 0 ? raw : inflateRawSync(raw)
    assert.equal(data.length, size)
    out[name] = new TextDecoder().decode(data)
    p += 46 + nlen + elen + clen
  }
  return out
}

test('by deliverable: one row each, split and flags carried', () => {
  const { doc, a, flags } = example()
  const t = buildTable('deliverables', doc, a, flags)
  assert.equal(t.rows.length, 7)
  const checkout = t.rows.find(r => r.name === 'Checkout redesign')
  assert.equal(checkout.booked, 34)
  assert.equal(checkout.status, 'Staffed')
  assert.match(checkout.split, /^Bruno Silva 50% \(17\); Carla Méndez 50% \(17\)$/)
  const payments = t.rows.find(r => r.name === 'Payments API v2')
  assert.equal(payments.gap, 34)
  assert.equal(payments.engineers, 1)
  assert.match(payments.flags, /short 34 pts/)
  assert.equal(t.rows.find(r => r.name === 'Search relevance').estimate, null)
})

test('by engineer: capacity, days off, split and the 112% over-booking', () => {
  const { doc, a, flags } = example()
  const t = buildTable('engineers', doc, a, flags, { countryName: c => ({ CL: 'Chile', MX: 'Mexico' })[c] || c })
  const bruno = t.rows.find(r => r.name === 'Bruno Silva')
  assert.deepEqual([bruno.cap, bruno.used, bruno.pct, bruno.free], [34, 38, 112, -4])
  assert.match(bruno.split, /Checkout redesign 50% \(17\); Release automation 62% \(21\)/)
  assert.match(bruno.flags, /booked 112%/)
  const ana = t.rows.find(r => r.name === 'Ana Rojas')
  assert.equal(ana.vacation, 5)
  assert.equal(t.rows.find(r => r.name === 'Open role').country, 'Chile (team default)')
  assert.equal(t.rows.find(r => r.name === 'Diego Fuentes').country, 'Mexico')
})

test('assignments: one row per person per deliverable, points add up per person', () => {
  const { doc, a, flags } = example()
  const t = buildTable('assignments', doc, a, flags)
  assert.equal(t.rows.length, doc.deliverables.reduce((n, d) => n + d.members.length, 0))
  const brunoPts = t.rows.filter(r => r.person === 'Bruno Silva').reduce((s, r) => s + r.points, 0)
  assert.equal(brunoPts, a.people.get('bruno').used)
})

test('flags table matches computeFlags one to one', () => {
  const { doc, a, flags } = example()
  const t = buildTable('flags', doc, a, flags)
  assert.equal(t.rows.length, flags.length)
  assert.ok(t.rows.some(r => r.level === 'Error' && r.about === 'Bruno Silva'))
  assert.ok(t.rows.some(r => r.fix === 'Size it' && r.about === 'Search relevance'))
})

test('CSV round-trips hostile names and neutralises formulas', () => {
  const { doc, a, flags } = example(raw => {
    raw.people[0].name = 'Rojas, Ana "the closer"'
    raw.people[1].name = '=HYPERLINK("http://x","click")'
    raw.deliverables[0].name = 'Line\nbreak'
  })
  const t = buildTable('engineers', doc, a, flags)
  const csv = toCSV(t)
  assert.ok(csv.startsWith('﻿'), 'UTF-8 BOM for Excel')
  const rows = parseCSV(csv.slice(1))
  assert.equal(rows.length, t.rows.length + 1)
  assert.ok(rows.every(r => r.length === t.columns.length), 'every row has every column')
  assert.equal(rows[1][0], 'Rojas, Ana "the closer"')
  assert.equal(rows[2][0], `'=HYPERLINK("http://x","click")`)
  const pctCol = t.columns.findIndex(c => c.key === 'pct')
  assert.match(rows[2][pctCol], /^\d+(\.\d)?%$/)
  const d = parseCSV(toCSV(buildTable('deliverables', doc, a, flags)).slice(1))
  assert.equal(d[1][0], 'Line\nbreak')
})

test('TSV pastes as a grid: no tabs or newlines inside cells', () => {
  const { doc, a, flags } = example(raw => { raw.deliverables[0].name = 'Tab\there\nand newline' })
  const t = buildTable('deliverables', doc, a, flags)
  const lines = toTSV(t).replace(/\n$/, '').split('\n')    // not trimEnd: empty last cells end in tabs
  assert.equal(lines.length, t.rows.length + 1)
  assert.ok(lines.every(l => l.split('\t').length === t.columns.length))
})

test('Markdown table has a header rule and escaped pipes', () => {
  const { doc, a, flags } = example(raw => { raw.deliverables[0].name = 'A | B' })
  const md = toMarkdownTable(buildTable('deliverables', doc, a, flags)).trimEnd().split('\n')
  assert.match(md[1], /^\|---\|---:/)
  assert.match(md[2], /A \\\| B/)
  assert.equal(md.length, 2 + 7)
})

test('xlsx: a valid zip with one sheet per table, numbers typed, strings escaped', () => {
  const { doc, a, flags } = example(raw => { raw.people[0].name = 'Ana <b>&</b> "Rojas"' })
  const tables = ['deliverables', 'engineers', 'assignments', 'flags'].map(k => buildTable(k, doc, a, flags))
  tables.push(settingsTable(doc, a))
  const files = unzip(buildXlsx(tables))
  for (const part of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml']) assert.ok(files[part], part)
  assert.equal(Object.keys(files).filter(n => n.startsWith('xl/worksheets/')).length, 5)
  assert.match(files['xl/workbook.xml'], new RegExp(`<sheet name="${TABLES.deliverables}"`))
  const people = files['xl/worksheets/sheet2.xml']
  assert.match(people, /Ana &lt;b&gt;&amp;&lt;\/b&gt; &quot;Rojas&quot;/)
  assert.match(people, /<c r="K3"><v>34<\/v><\/c>/)                 // Bruno (row 3): planned capacity, a number
  assert.match(people, /<c r="M3" s="2"><v>1.12<\/v><\/c>/)          // his 112% as a percent cell
  assert.match(people, /<c r="N3"><v>-4<\/v><\/c>/)                 // and 4 over as a negative number
  assert.match(people, /<pane ySplit="1"/)
})
