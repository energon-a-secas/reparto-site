// Regressions for the bugs the 2026-09-21 break-and-verify run reproduced.
// Each test names the finding it pins (EXP export, MB model, FIX fix-fuzzer).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyze, shareKey, splitPoints, pctForPoints, trimShares, pinShares, DEFAULT_SETTINGS, SCALE } from '../js/capacity.js'
import { computeFlags } from '../js/flags.js'
import { buildTable } from '../js/tables.js'
import { toTSV, toMarkdownTable } from '../js/formats.js'
import { toMarkdown } from '../js/report.js'

globalThis.localStorage ??= { getItem: () => null, setItem() {} }
const st = await import('../js/state.js')

const load = cc => JSON.parse(fs.readFileSync(new URL(`../data/holidays/${cc}.json`, import.meta.url)))
const H = { CL: load('CL'), US: load('US') }
const cal = { holidays: (c, y) => H[c]?.years[y] || null, status: () => 'ok' }
const plan = (settings = {}, people = [], deliverables = [], daysOff = []) => st.normalizeDoc({
  title: 't', settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff,
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, ...p })),
  deliverables,
})
const deliv = (id, estimate, members) => ({ id, name: id.toUpperCase(), estimate, members })
const pointsOf = (doc, id, pid) => analyze(doc, cal).shares.get(shareKey(id, pid))?.points

test('MB-5 / FIX-5: a default-country full-timer is always exactly bookable', () => {
  for (const sprints of [1, 3, 4, 6, 9, 13]) for (const buffer of [0, 5, 10, 12.5, 30, 50]) for (const weeks of [1, 2, 3, 4]) {
    const doc = plan({ sprints, buffer, weeksPerSprint: weeks, countries: ['CL'] }, [{}])
    const a = analyze(doc, cal)
    assert.equal(a.people.get('p0').cap, a.bookable, `${sprints} sprints, ${weeks} weeks, ${buffer}% buffer`)
  }
})

test('MB-1: the exact-points search finds the percentage when a person holds several shares', () => {
  for (const cap of [13, 21, 34, 55]) {
    const sprints = { 13: 2, 21: 3, 34: 4, 55: 6 }[cap]
    const doc = plan({ sprints }, [{}], [deliv('a', 8, [{ person: 'p0', pct: 33.33 }]), deliv('b', 8, [{ person: 'p0', pct: 33.33 }]), deliv('c', 8, [{ person: 'p0', pct: 20 }])])
    const before = ['b', 'c'].map(id => pointsOf(doc, id, 'p0'))
    for (let want = 1; want <= 9; want++) {
      const pct = pctForPoints(doc, cal, 'a', 'p0', want)
      const next = st.normalizeDoc({ ...doc, deliverables: doc.deliverables.map(d => d.id === 'a' ? { ...d, members: [{ person: 'p0', pct }] } : d) })
      const pts = ['a', 'b', 'c'].map(id => pointsOf(next, id, 'p0'))
      assert.equal(pts[0], want, `cap ${cap}: asked for ${want}, got ${pts[0]} at ${pct}%`)
      assert.deepEqual(pts.slice(1), before, `cap ${cap}, want ${want}: others moved`)
    }
  }
})

test('MB-2: trimming away a whole share leaves the person\'s other cards alone', () => {
  const doc = plan({}, [{}, {}], [
    deliv('x', 5, [{ person: 'p0', pct: 15 }, { person: 'p1', pct: 15 }]),
    deliv('y', 13, [{ person: 'p0', pct: 38.5 }]),
    deliv('z', 8, [{ person: 'p0', pct: 23.5 }]),
  ])
  const before = ['y', 'z'].map(id => pointsOf(doc, id, 'p0'))
  doc.deliverables.find(d => d.id === 'x').members = trimShares(doc, cal, 'x')
  assert.equal(analyze(doc, cal).deliverables.get('x').got, 5)
  assert.deepEqual(['y', 'z'].map(id => pointsOf(doc, id, 'p0')), before)
})

test('MB-3 / FIX-2: a share under 1% is kept, so a big capacity can give exactly 1 point', () => {
  const doc = plan({ sprints: 13, weeksPerSprint: 4, meetingDay: false }, [{}], [deliv('a', 1, [])])
  const a = analyze(doc, cal)
  assert.ok(a.people.get('p0').cap > 150)
  const pct = pctForPoints(doc, cal, 'a', 'p0', 1)
  assert.ok(pct < 1, `pct ${pct}`)
  st.state.doc = doc; st.assign('a', 'p0', pct)
  assert.equal(pointsOf(st.state.doc, 'a', 'p0'), 1)
  assert.equal(st.normalizeDoc(JSON.parse(JSON.stringify(st.state.doc))).deliverables[0].members[0].pct, pct)
})

test('MB-6: team points per sprint add up to the team capacity', () => {
  for (const n of [1, 3, 5, 9]) {
    const doc = plan({ countries: ['CL'], sprints: 6 }, Array.from({ length: n }, (_, i) => ({ load: 50 + i * 5 })))
    const a = analyze(doc, cal)
    assert.equal(a.perSprint.reduce((t, x) => t + x, 0), a.capacity)
  }
})

test('MB-7: a default calendar with no working days does not zero engineers elsewhere', () => {
  const allOff = Array.from({ length: 5 }, (_, i) => ({ date: `2026-10-0${5 + i}`, label: 'Off', country: 'CL' }))
  const doc = plan({ countries: ['CL', 'US'], sprints: 1, weeksPerSprint: 1 }, [{ country: 'CL' }, { country: 'US' }], [], allOff)
  const a = analyze(doc, cal)
  assert.equal(a.people.get('p0').cap, 0)
  assert.ok(a.people.get('p1').cap > 0)
})

test('MB-8: pinning after a merge keeps a third card where it was', () => {
  st.state.doc = plan({}, [{}], [deliv('a', 8, [{ person: 'p0', pct: 12.3 }]), deliv('b', 8, [{ person: 'p0', pct: 17.7 }]), deliv('c', 8, [{ person: 'p0', pct: 21.1 }])])
  const a = analyze(st.state.doc, cal)
  const moved = a.shares.get(shareKey('a', 'p0')), there = a.shares.get(shareKey('b', 'p0'))
  const third = a.shares.get(shareKey('c', 'p0')).points
  st.moveShare('a', 'b', 'p0', moved.pct, there.pct)
  st.state.doc = pinShares(st.state.doc, cal, 'p0', new Map([['c', third], ['b', moved.points + there.points]]))
  assert.equal(pointsOf(st.state.doc, 'c', 'p0'), third)
  assert.equal(pointsOf(st.state.doc, 'b', 'p0'), moved.points + there.points)
})

test('MB-9 / FIX-4: trimming a fixed share of someone with no capacity cuts only the surplus', () => {
  const doc = plan({}, [{ load: 0 }], [deliv('x', 5, [{ person: 'p0', points: 8 }])])
  doc.deliverables[0].members = trimShares(doc, cal, 'x')
  assert.deepEqual(doc.deliverables[0].members, [{ person: 'p0', points: 5 }])
})

test('FIX-1: a trim that would need more than 400% stays fixed points and survives a reload', () => {
  const doc = plan({ sprints: 1 }, [{ load: 5 }], [deliv('x', 13, [{ person: 'p0', points: 21 }])])
  assert.ok(13 / analyze(doc, cal).people.get('p0').cap > 4, 'the case needs more than 400%')
  doc.deliverables[0].members = trimShares(doc, cal, 'x')
  assert.deepEqual(doc.deliverables[0].members, [{ person: 'p0', points: 13 }])
  const back = st.normalizeDoc(JSON.parse(JSON.stringify(doc)))
  assert.equal(analyze(back, cal).deliverables.get('x').got, 13)
})

test('FIX-6: the shortfall fix never promises more than the 10 roles it adds', () => {
  const doc = plan({}, [{}], [deliv('huge', 233, []), deliv('huger', 233, []), deliv('more', 144, [])])
  const f = computeFlags(doc, analyze(doc)).find(x => x.fix?.action === 'open-roles')
  assert.ok(Number(f.fix.arg) <= 10 && /Add 10 open roles/.test(f.fix.label), f.fix.label)
})

test('EXP-1: the report shows the derived sprint and the cap, not a false product', () => {
  const doc = plan({ sprintCap: 6 }, [{}])
  const md = toMarkdown(doc, analyze(doc), { today: new Date(2026, 8, 21) })
  assert.match(md, /× 1 pt = 8, capped at 6 pts a sprint × 4 sprints = 24/)
})

test('EXP-2: a double quote in a cell is qualified for a Sheets paste', () => {
  const doc = plan({}, [{ name: '"Kiki" Ramos' }, { name: '"Cy' }, { name: 'Di' }])
  const tsv = toTSV(buildTable('engineers', doc, analyze(doc), []))
  const line = tsv.split('\n')[1]
  assert.ok(line.startsWith('"""Kiki"" Ramos"\t'), line.slice(0, 30))
  assert.ok(tsv.split('\n')[2].startsWith('"""Cy"\t'))
})

test('EXP-3 / EXP-5: line breaks of every kind stay inside their Markdown line', () => {
  const doc = plan({}, [{}], [deliv('a', null, [])])
  doc.title = 'Q4\r## Injected'; doc.deliverables[0].name = 'CR\ronly\n## Also'
  const md = toMarkdown(doc, analyze(doc), { today: new Date(2026, 8, 21) })
  assert.ok(!/\r/.test(md))
  assert.ok(!/^## (Injected|Also)/m.test(md))
  assert.ok(!/\r/.test(toMarkdownTable(buildTable('deliverables', doc, analyze(doc), []))))
})

test('EXP-4: no engineer unit means no engineers figure, not the points again', () => {
  const doc = plan({ sprints: 1, weeksPerSprint: 1 }, [{}], [deliv('auth', 8, [{ person: 'p0', pct: 50 }])],
    Array.from({ length: 5 }, (_, i) => ({ date: `2026-10-0${5 + i}`, label: 'Off' })))
  const a = analyze(doc)
  assert.equal(a.bookable, 0)
  assert.equal(buildTable('deliverables', doc, a, []).rows[0].engineers, null)
})

test('EXP-6: ids are cleaned, so a colon cannot make two shares one key', () => {
  const doc = st.normalizeDoc({ settings: { startDate: '2026-10-05' },
    people: [{ id: 'a', name: 'A' }, { id: 'a:b', name: 'AB' }],
    deliverables: [{ id: 'x:a', name: 'X', estimate: 8, members: [{ person: 'a:b', pct: 50 }] }, { id: 'x', name: 'Y', estimate: 8, members: [{ person: 'a', pct: 10 }] }] })
  assert.ok(doc.people.every(p => /^[A-Za-z0-9_-]+$/.test(p.id)))
  assert.equal(doc.deliverables[0].members[0].person, doc.people[1].id)       // the member follows its person
  const a = analyze(doc)
  assert.equal(a.shares.size, 2)
})

test('EXP-7: the 80-character cut never leaves half an emoji', () => {
  const doc = st.normalizeDoc({ settings: {}, people: [{ id: 'p', name: 'x'.repeat(79) + '😀' }], deliverables: [] })
  assert.ok(!/[\ud800-\udbff]$/.test(doc.people[0].name))
  assert.equal(doc.people[0].name.length, 79)
})

test('splitPoints still sums exactly after the floor change', () => {
  assert.equal(splitPoints(233, [0.43, 99.57]).reduce((t, x) => t + x, 0), 233)
  assert.ok(SCALE.includes(233))
})
