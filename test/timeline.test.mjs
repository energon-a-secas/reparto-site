// Quarters, deliverables on some of the plan's sprints, per-sprint booking
// and landing dates (2026-09-22).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyze, shareKey, pctForPoints, defaultStart, DEFAULT_SETTINGS, freeIn } from '../js/capacity.js'
import { computeFlags, landingText } from '../js/flags.js'
import { quarterOf, planQuarters, quartersAround, quarterStartMonday, monthsIn, shiftQuarter, sprintsToEnd } from '../js/quarters.js'
import { spanOf, landing, spread, splitExact, mapRange } from '../js/timeline.js'
import { planRange, iso } from '../js/calendar.js'
import { buildTable, settingsTable } from '../js/tables.js'
import { toMarkdown } from '../js/report.js'

globalThis.localStorage ??= { getItem: () => null, setItem() {} }
const st = await import('../js/state.js')
const CL = JSON.parse(fs.readFileSync(new URL('../data/holidays/CL.json', import.meta.url)))
const cal = { holidays: (c, y) => (c === 'CL' ? CL.years[y] : null), status: () => 'ok' }
const D = s => new Date(`${s}T00:00:00Z`)
const plan = (settings = {}, people = [{}], deliverables = []) => st.normalizeDoc({
  title: 'P', settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff: [],
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, ...p })), deliverables,
})
const deliv = (id, estimate, members, window = null) => ({ id, name: id.toUpperCase(), estimate, members, window })

test('fiscal quarters: with an October start, September 2026 is Q4 FY26 and October to December is Q1 FY27', () => {
  assert.equal(quarterOf(D('2026-09-22'), 10).label, 'Q4 FY26')
  const q1 = quarterOf(D('2026-10-05'), 10)
  assert.deepEqual([q1.label, iso(q1.from), iso(q1.to)], ['Q1 FY27', '2026-10-01', '2027-01-01'])
  assert.equal(shiftQuarter(q1, 1, 10).label, 'Q2 FY27')
  assert.equal(quarterOf(D('2026-10-05'), 1).label, 'Q4 2026')
  // A February fiscal year: Feb to Apr is Q1, and the year is named for where it ends.
  const feb = quarterOf(D('2026-03-10'), 2)
  assert.deepEqual([feb.label, iso(feb.from), iso(feb.to)], ['Q1 FY27', '2026-02-01', '2026-05-01'])
  assert.equal(quarterStartMonday(q1), '2026-10-05')
  assert.equal(defaultStart(10, new Date(2026, 8, 22)), '2026-10-05')
  assert.deepEqual(quartersAround(D('2026-09-22'), 10, 1, 2).map(q => q.label), ['Q3 FY26', 'Q4 FY26', 'Q1 FY27', 'Q2 FY27'])
  assert.deepEqual(monthsIn(D('2026-10-05'), D('2026-12-18')).map(m => m.label), ['October 2026', 'November 2026', 'December 2026'])
  assert.equal(planQuarters(planRange(plan({ sprints: 6 }).settings), 10), 'Q1 FY27')
  assert.equal(planQuarters(planRange(plan({ sprints: 9 }).settings), 10), 'Q1 to Q2 FY27')
})

test('fiscal start and windows go through normalizeDoc: clamped, swapped, or dropped', () => {
  assert.equal(st.normalizeDoc({ people: [], deliverables: [] }).settings.fiscalStart, 10)
  assert.equal(st.normalizeDoc({ settings: { fiscalStart: 99 }, people: [], deliverables: [] }).settings.fiscalStart, 12)
  const doc = st.normalizeDoc({ people: [], deliverables: [
    { id: 'a', window: { from: 3, to: 1 } }, { id: 'b', window: { from: 0, to: 40 } }, { id: 'c', window: 'soon' }, { id: 'd' },
  ] })
  assert.deepEqual(doc.deliverables.map(d => d.window), [{ from: 1, to: 3 }, { from: 1, to: 13 }, null, null])
})

test('a plan with every deliverable on the whole plan reads exactly as before spans existed', () => {
  const doc = plan({ countries: ['CL'] }, [{}, { load: 50 }], [deliv('x', 21, [{ person: 'p0', pct: 60 }, { person: 'p1', pct: 50 }]), deliv('y', 13, [{ person: 'p0', pct: 40 }])])
  const a = analyze(doc, cal)
  for (const p of doc.people) {
    const pa = a.people.get(p.id)
    assert.ok(Math.abs(pa.sprintCap.reduce((t, x) => t + x, 0) - pa.cap) < 1e-9, 'per-sprint capacity adds up')
    assert.equal(pa.overSprints.length, 0)
    assert.ok(Math.abs(pa.peak - pa.pct) < 1e-9, 'with whole-plan shares the busiest sprint is the total')
  }
  assert.equal(a.bookedPerSprint.reduce((t, x) => t + x, 0), a.allocated)
  for (const [, da] of a.deliverables) assert.ok(Math.abs(da.perSprint.reduce((t, x) => t + x, 0) - da.got) < 1e-9)
})

test('a share is a percentage of the span: 100% in S1 to S2 then 100% in S3 to S4 is a full plan, not an over-booking', () => {
  const doc = plan({}, [{}], [deliv('a', 13, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 }), deliv('b', 13, [{ person: 'p0', pct: 100 }], { from: 3, to: 4 })])
  const a = analyze(doc), pa = a.people.get('p0')
  assert.equal(pa.cap, 34)
  assert.equal(a.shares.get(shareKey('a', 'p0')).points + a.shares.get(shareKey('b', 'p0')).points, 34)
  assert.equal(pa.overSprints.length, 0)
  assert.equal(pa.peak, 100)
  assert.equal(pa.concurrent, 1)
  assert.ok(!computeFlags(doc, a).some(f => f.cat === 'load' && f.level === 'error'))
})

test('two deliverables on the same sprints over-book those sprints, and the flag names them', () => {
  const doc = plan({}, [{}], [deliv('a', 8, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 }), deliv('b', 8, [{ person: 'p0', pct: 50 }])])
  const a = analyze(doc), pa = a.people.get('p0')
  assert.equal(pa.free, 0, 'the quarter adds up: 17 in S1 to S2 and 17 across the plan')
  assert.deepEqual(pa.overSprints, [0, 1])
  assert.equal(pa.peak, 150)
  const flag = computeFlags(doc, a).find(f => f.cat === 'load' && f.level === 'error')
  assert.match(flag.text, /booked 150% of their time in S1 and S2, \d+ pts? over/)
  assert.equal(flag.fix.action, 'rebalance')
})

test('the exact-points search works against a span, and keeping points across a shorter span raises the percentage', () => {
  const doc = plan({ countries: ['CL'] }, [{}], [deliv('a', 13, [{ person: 'p0', pct: 50 }]), deliv('b', 8, [{ person: 'p0', pct: 20 }])])
  const before = analyze(doc, cal).shares.get(shareKey('a', 'p0')).points
  doc.deliverables[0].window = { from: 1, to: 2 }
  const pct = pctForPoints(doc, cal, 'a', 'p0', before)
  doc.deliverables[0].members[0].pct = pct
  const a = analyze(doc, cal)
  assert.equal(a.shares.get(shareKey('a', 'p0')).points, before)
  assert.ok(pct > 90 && pct < 110, `about double: ${pct}`)
})

test('landing: a whole-plan deliverable exactly staffed lands on the plan\'s last working day; a short one lands after, at its pace', () => {
  const doc = plan({}, [{}, {}], [deliv('x', 34, [{ person: 'p0', pct: 100 }]), deliv('y', 34, [{ person: 'p1', pct: 50 }]), deliv('z', 8, [{ person: 'p1', pct: 47 }], { from: 1, to: 2 }), deliv('u', null, []), deliv('n', 8, [])])
  const a = analyze(doc)
  assert.deepEqual([a.deliverables.get('x').lands.kind, iso(a.deliverables.get('x').lands.date)], ['on-time', '2026-11-27'])
  const y = a.deliverables.get('y').lands
  assert.equal(y.kind, 'late'); assert.equal(y.afterPlan, true)
  assert.equal(iso(y.date), '2027-01-22', 'twice the plan at half the pace: four more sprints')
  assert.equal(a.deliverables.get('z').lands.kind, 'on-time')
  assert.ok(a.deliverables.get('z').lands.date <= D('2026-10-30'), 'inside S1 to S2')
  assert.equal(a.deliverables.get('u').lands.kind, 'unsized')
  assert.equal(a.deliverables.get('n').lands.kind, 'none')
  assert.match(landingText(y, doc.settings, a.deliverables.get('y').span).text, /^At this pace it lands about 22 Jan 2027, after the plan ends$/)
  // More people than it needs: it lands early.
  const early = analyze(plan({}, [{}, {}], [deliv('e', 34, [{ person: 'p0', pct: 100 }, { person: 'p1', pct: 100 }])])).deliverables.get('e').lands
  assert.ok(early.date < D('2026-11-02'), iso(early.date))
})

test('a short flag says when it would land; a window past a shorter plan is pulled in and flagged', () => {
  const doc = plan({}, [{}], [deliv('y', 55, [{ person: 'p0', pct: 100 }])])
  assert.match(computeFlags(doc, analyze(doc)).find(f => /is short/.test(f.text)).text, /At this pace it lands about .* after the plan ends\./)
  const cut = plan({ sprints: 4 }, [{}], [deliv('w', 8, [], { from: 5, to: 6 })])
  const a = analyze(cut)
  assert.deepEqual([a.spans.get('w').a, a.spans.get('w').b, a.spans.get('w').clamped], [3, 3, true])
  const f = computeFlags(cut, a).find(x => x.fix?.action === 'window')
  assert.match(f.text, /set for S5 to S6, past this plan's 4 sprints, so it runs in S4/)
})

test('room is per span: someone full in S1 to S2 is not offered for another S1 to S2 card, but is for S3 to S4', () => {
  const doc = plan({}, [{ name: 'Busy' }, { name: 'Other', load: 20 }], [
    deliv('a', 17, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 }),
    deliv('b', 5, [], { from: 1, to: 2 }),
    deliv('c', 5, [], { from: 3, to: 4 }),
  ])
  const a = analyze(doc)
  assert.equal(freeIn(a.people.get('p0'), a.spans.get('b')), 0)
  assert.ok(freeIn(a.people.get('p0'), a.spans.get('c')) >= 16)
  const fixes = new Map(computeFlags(doc, a).filter(f => f.fix?.action === 'assign').map(f => [f.target.ids[0], f.fix.label]))
  assert.equal(fixes.get('b'), 'Add Other')
  assert.equal(fixes.get('c'), 'Add Busy')
})

test('leave in a sprint the deliverable does not use costs it nothing', () => {
  const doc = plan({}, [{ vacations: [{ from: '2026-11-02', to: '2026-11-13' }] }], [deliv('a', 17, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 })])
  const a = analyze(doc)
  assert.equal(a.deliverables.get('a').leavePts, 0)
  assert.ok(a.people.get('p0').sprintCap[2] < 1e-9, 'the vacation empties S3')
})

test('spread and splitExact: a share\'s points land in its sprints and add up', () => {
  const parts = spread(10, [8, 4, 8, 8], { a: 0, b: 1 }, 4)
  assert.deepEqual(parts.map(x => Math.round(x * 100) / 100), [6.67, 3.33, 0, 0])
  assert.deepEqual(splitExact([2.5, 2.5, 3]), [3, 2, 3])
  assert.equal(landing([4, 4, 4, 4], 8, spanOf(null, 4), { startDate: '2026-10-05', weeksPerSprint: 2, daysPerWeek: 5, sprints: 4 }).sprint, 1)
})

test('exports carry the sprints, the estimated completion and the quarter', () => {
  const doc = plan({}, [{}], [deliv('x', 13, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 }), deliv('y', 55, [])])
  const a = analyze(doc)
  const t = buildTable('deliverables', doc, a, computeFlags(doc, a))
  assert.deepEqual([t.rows[0].sprints, t.rows[0].landsNote], ['S1 to S2', 'In its sprints'])
  assert.match(t.rows[0].lands, /^2026-1\d-\d\d$/)
  assert.deepEqual([t.rows[1].lands, t.rows[1].landsNote], ['', 'No date: nobody on it'])
  const set = new Map(settingsTable(doc, a).rows.map(r => [r.k, r.v]))
  assert.equal(set.get('Quarter'), 'Q1 FY27')
  assert.equal(set.get('Fiscal year starts'), 'October')
  const md = toMarkdown(doc, a, { today: new Date(2026, 8, 22) })
  assert.match(md, /\*\*Calendar:\*\* Q1 FY27, starts 5 Oct 2026/)
  assert.match(md, /\| X \| 13 \| \d+ \| S1 to S2 \| \d+ (Oct|Nov) \|/)
})

test('changing a deliverable\'s sprints scales its estimate by default: nearest on the scale, and back again', async () => {
  const { scaleEstimate } = await import('../js/capacity.js')
  assert.equal(scaleEstimate(34, 4, 2), 21)          // 17, a tie between 13 and 21, goes up
  assert.equal(scaleEstimate(21, 2, 4), 34)          // and doubling back returns to 34
  assert.equal(scaleEstimate(55, 4, 2), 34)
  assert.equal(scaleEstimate(34, 2, 4), 55)
  assert.equal(scaleEstimate(13, 6, 2), 5)
  assert.equal(scaleEstimate(8, 4, 4), 8, 'moving without resizing changes nothing')
  assert.equal(scaleEstimate(null, 4, 2), null, 'unsized stays unsized')
  assert.equal(scaleEstimate(233, 1, 13), 233, 'the scale tops out at 233')
  assert.equal(scaleEstimate(1, 13, 1), 1, 'and bottoms out at 1')
  // Halving is one step down the scale and doubling one step back up, from 5 on; at 1 and 3
  // the halves are exact ties, so they come back as 2 and 5 (Ctrl+Z restores exactly).
  for (const est of [2, 5, 8, 13, 21, 34, 55, 89, 144, 233]) {
    assert.equal(scaleEstimate(scaleEstimate(est, 4, 2), 2, 4), est, `${est}: halve then double`)
  }
  // Same share of their time over half the sprints: the scaled estimate is still covered.
  const doc = plan({}, [{}], [deliv('x', 34, [{ person: 'p0', pct: 100 }])])
  doc.deliverables[0].window = { from: 1, to: 2 }
  doc.deliverables[0].estimate = scaleEstimate(34, 4, 2)
  const da = analyze(doc).deliverables.get('x')
  assert.equal(da.got, 17)
  assert.equal(doc.deliverables[0].estimate, 21)
})

test('the map shows the whole quarter: a 4-sprint plan from 5 Oct runs to the sprint that covers 31 Dec, with 6 fitting', () => {
  const doc = plan({ sprints: 4 }, [{}], [deliv('a', 8, [{ person: 'p0', pct: 50 }])])
  const a = analyze(doc, cal)
  const m = mapRange(a, doc.settings)
  assert.equal(iso(m.from), '2026-10-05')
  assert.equal(iso(m.planEnd), '2026-11-30')
  assert.equal(iso(m.quarterEnd), '2027-01-01')
  assert.ok(m.to >= m.quarterEnd, 'the map reaches the end of the quarter')
  assert.equal(m.sprints, 7, 'closed on a sprint boundary: the 7th sprint (28 Dec to 10 Jan) holds the last days of the quarter')
  assert.equal(iso(m.to), '2027-01-11')
  assert.equal(m.n, 98)
  assert.equal(sprintsToEnd(quarterOf(m.from, 10), m.from, 2), 6, 'the quarter holds 6 whole sprints from 5 Oct')
  assert.equal(sprintsToEnd(quarterOf(m.from, 10), m.from, 1), 12)
})

test('the map follows a late landing past the quarter, but only a quarter further', () => {
  const late = plan({ sprints: 4 }, [{}], [deliv('a', 89, [{ person: 'p0', pct: 20 }])])
  const a = analyze(late, cal)
  const da = a.deliverables.get('a')
  assert.equal(da.lands.kind, 'late')
  const m = mapRange(a, late.settings)
  assert.ok(m.to > da.lands.date || m.to - m.quarterEnd >= 13 * 7 * 86400000, 'the landing is on the map, or the map stops a quarter past')
  assert.ok(m.to - m.quarterEnd <= (13 * 7 + 14) * 86400000, 'never more than a quarter and a sprint past the quarter')
})
