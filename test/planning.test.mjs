import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDoc, state, addDeliverable, moveDeliverable } from '../js/state.js'
import { analyze } from '../js/capacity.js'
import { computeFlags } from '../js/flags.js'
import { compactName } from '../js/utils.js'
import { normalizePlanning, priorityOf, progressOf, priorityColorOf, boxColorOf, sortByPriority } from '../js/planning.js'
import { buildTable } from '../js/tables.js'
import { toCSV } from '../js/formats.js'

const rawPlan = () => ({ people: [{ id: 'p', name: 'Luciano Adonis Villarroel' }], deliverables: [{ id: 'd', name: 'Payments', estimate: 21, members: [{ person: 'p', pct: 50 }] }] })

test('legacy plans gain safe planning defaults; imported metadata round-trips', () => {
  const raw = rawPlan()
  assert.deepEqual(normalizePlanning(normalizeDoc(raw).deliverables[0]), { priority: 'p3', progress: 'planned', boxColor: '' })
  Object.assign(raw.deliverables[0], { priority: 'urgent', progress: 'blocked', priorityColor: 'violet' })
  const doc = normalizeDoc(raw)
  assert.deepEqual(normalizeDoc(JSON.parse(JSON.stringify(doc))), doc)
  assert.deepEqual(normalizePlanning(doc.deliverables[0]), { priority: 'p1', progress: 'blocked', boxColor: 'violet' })
  for (const value of ['__proto__', 'constructor', ['high'], null, '<script>']) {
    assert.deepEqual(normalizePlanning({ priority: value, progress: value, priorityColor: value }), { priority: 'p3', progress: 'planned', boxColor: '' })
  }
})

test('priority sorting is stable in both directions and never changes plan order', () => {
  const list = [{ id: 1, priority: 'p3' }, { id: 2, priority: 'p1' }, { id: 3, priority: 'p2' }, { id: 4, priority: 'p3' }, { id: 5, priority: 'p6' }, { id: 6, priority: 'p4' }, { id: 7, priority: 'p5' }]
  assert.deepEqual(sortByPriority(list).map(d => d.id), [2, 3, 1, 4, 6, 7, 5])
  assert.deepEqual(sortByPriority(list, -1).map(d => d.id), [5, 7, 6, 1, 4, 3, 2])
  assert.deepEqual(list.map(d => d.id), [1, 2, 3, 4, 5, 6, 7])
  assert.equal(priorityOf({}), 'p3')
  assert.equal(priorityColorOf({ priority: 'urgent' }), 'rose')
  assert.equal(priorityColorOf({ priority: 'p1', boxColor: 'teal' }), 'rose')
  assert.equal(boxColorOf({ priority: 'p1', boxColor: 'teal' }), 'teal')
})

test('planning labels do not affect capacity; Done preserves metadata and restores the prior progress', () => {
  state.doc = normalizeDoc(rawPlan())
  const before = analyze(state.doc)
  for (const progress of ['planned', 'in-progress', 'blocked', 'on-hold']) {
    Object.assign(state.doc.deliverables[0], { progress, priority: 'p2', boxColor: 'teal' })
    assert.deepEqual(analyze(state.doc), before)
  }
  const shares = structuredClone(state.doc.deliverables[0].members)
  assert.equal(moveDeliverable('d', 'done'), true)
  assert.equal(progressOf(state.doc.backlog[0]), 'done')
  assert.equal(state.doc.backlog[0].progress, 'on-hold')
  assert.equal(analyze(state.doc).allocated, 0)
  assert.equal(moveDeliverable('d', 'plan'), true)
  assert.equal(progressOf(state.doc.deliverables[0]), 'on-hold')
  assert.equal(state.doc.deliverables[0].boxColor, 'teal')
  assert.deepEqual(state.doc.deliverables[0].members, shares)
  assert.deepEqual(analyze(state.doc), before)
  assert.equal(addDeliverable().progress, 'planned')
})

test('compact names are display-only, including single names and Unicode initials', () => {
  assert.equal(compactName('  Luciano  Adonis Villarroel  '), 'Luciano A.')
  assert.equal(compactName('Madonna'), 'Madonna')
  assert.equal(compactName('Ana Évora'), 'Ana É.')
  assert.equal(compactName('Alex 𐐀name'), 'Alex 𐐀.')
  assert.equal(compactName('   '), 'Unnamed')
  const doc = normalizeDoc(rawPlan())
  Object.assign(doc.deliverables[0], { priority: 'p2', progress: 'blocked', boxColor: 'violet' })
  const a = analyze(doc), flags = computeFlags(doc, a)
  const table = buildTable('deliverables', doc, a, flags)
  assert.equal(table.rows[0].priority, 'P2')
  assert.equal(table.rows[0].progress, 'Blocked')
  assert.equal(table.rows[0].boxColor, 'Violet')
  assert.match(toCSV(table), /Luciano Adonis Villarroel/)
  assert.equal(buildTable('engineers', doc, a, flags).rows[0].name, 'Luciano Adonis Villarroel')
  doc.backlog.push({ ...doc.deliverables.pop(), when: 'done' })
  const row = buildTable('backlog', doc, analyze(doc), []).rows[0]
  assert.equal(row.progress, 'Done')
  assert.equal(row.priority, 'P2')
  assert.equal(row.people, 'Luciano Adonis Villarroel')
})


test('all six priorities have fixed badges while box overrides migrate and remain independent', () => {
  const colors = ['rose', 'orange', 'amber', 'blue', 'teal', 'slate']
  for (let n = 1; n <= 6; n++) {
    assert.equal(priorityOf({ priority: `P${n}` }), `p${n}`)
    assert.equal(priorityOf({ priority: n }), `p${n}`)
    assert.equal(priorityColorOf({ priority: `p${n}`, boxColor: 'violet' }), colors[n - 1])
    assert.equal(boxColorOf({ priority: `p${n}` }), colors[n - 1])
    assert.equal(boxColorOf({ priority: `p${n}`, boxColor: 'violet' }), 'violet')
  }
  for (const [old, priority] of Object.entries({ urgent: 'p1', high: 'p2', normal: 'p3', low: 'p6' })) {
    assert.deepEqual(normalizePlanning({ priority: old, priorityColor: 'teal' }), { priority, progress: 'planned', boxColor: 'teal' })
  }
  assert.equal(boxColorOf({ priority: 'p1', boxColor: '', priorityColor: 'teal' }), 'rose', 'explicit Automatic beats a legacy override')
  assert.equal(normalizePlanning({ boxColor: 'url(evil)' }).boxColor, '')
  for (const priority of ['p0', 'p7', 7, 1.5]) assert.equal(priorityOf({ priority }), 'p3')
})
