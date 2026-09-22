// The spans review (2026-09-22): over-booking judged on time, room judged by
// the tightest sprint, per-sprint capacity that leave elsewhere cannot move,
// keeping points across a change of sprints, and two years meaning two years.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyze, shareKey, freeIn, keepPoints, pctForPoints, fitFactors, DEFAULT_SETTINGS } from '../js/capacity.js'
import { computeFlags } from '../js/flags.js'
import { landing, spanOf } from '../js/timeline.js'
import { buildTable } from '../js/tables.js'
import { iso } from '../js/calendar.js'
import { landingText } from '../js/flags.js'

globalThis.localStorage ??= { getItem: () => null, setItem() {} }
const st = await import('../js/state.js')
const plan = (settings = {}, people = [{}], deliverables = []) => st.normalizeDoc({
  title: 'P', settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff: [],
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, ...p })), deliverables,
})
const deliv = (id, estimate, members, window = null) => ({ id, name: id.toUpperCase(), estimate, members, window })
const loadFlags = (doc, a = analyze(doc)) => computeFlags(doc, a).filter(f => f.cat === 'load' && f.level === 'error')
const points = (doc, id) => new Map(doc.deliverables.find(d => d.id === id).members.map(m => [m.person, analyze(doc).shares.get(shareKey(id, m.person)).points]))
const withWindow = (doc, id, window) => { const next = structuredClone(doc); next.deliverables.find(d => d.id === id).window = window; return next }
const AWAY_S3 = [{ from: '2026-11-02', to: '2026-11-13' }]
const CL = JSON.parse(fs.readFileSync(new URL('../data/holidays/CL.json', import.meta.url)))
const cal = { holidays: (c, y) => (c === 'CL' ? CL.years[y] : null), status: () => 'ok' }

test('a 100% share on one sprint is not over-booked, and neither are two 50% shares there', () => {
  for (const members of [[{ person: 'p0', pct: 100 }]]) {
    const doc = plan({}, [{}], [deliv('a', 8, members, { from: 1, to: 1 })])
    const a = analyze(doc), pa = a.people.get('p0')
    assert.equal(a.shares.get('a:p0').points, 9, 'rounding still gives the card 9 of 8.5')
    assert.deepEqual(pa.overSprints, [])
    assert.equal(pa.over, false)
    assert.equal(Math.round(pa.peak), 100)
    assert.deepEqual(loadFlags(doc), [])
  }
  const two = plan({}, [{}], [deliv('a', 5, [{ person: 'p0', pct: 50 }], { from: 1, to: 1 }), deliv('b', 5, [{ person: 'p0', pct: 50 }], { from: 1, to: 1 })])
  assert.equal(analyze(two).people.get('p0').over, false)
  assert.deepEqual(loadFlags(two), [])
})

test('the busiest sprint counts only sprints someone has time in, so Scale to 100% scales to the real one', () => {
  const doc = plan({}, [{ vacations: AWAY_S3 }], [
    deliv('a', 21, [{ person: 'p0', pct: 100 }]),
    deliv('c', 2, [{ person: 'p0', pct: 20 }], { from: 1, to: 1 }),
    deliv('b', 5, [{ person: 'p0', pct: 50 }], { from: 3, to: 3 }),
  ])
  const pa = analyze(doc).people.get('p0')
  assert.equal(pa.sprintCap[2], 0)
  assert.equal(pa.load[2], 0, 'S3 holds no work: they are away')
  assert.equal(Math.round(pa.peak), 120, 'S1: the whole-plan card and C')
})

test('over-booked points only grow with the work: adding a point never turns 17 over into 1 over', () => {
  const two = [deliv('a', 21, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 }), deliv('b', 21, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 })]
  const before = plan({}, [{}], two)
  const pa = analyze(before).people.get('p0')
  assert.deepEqual(pa.overSprints, [0, 1])
  assert.equal(pa.overPts, 17, 'summed exactly, then rounded once (not 9 + 9)')
  const after = plan({}, [{}], [...two, deliv('c', 1, [{ person: 'p0', pct: 3 }])])
  const pb = analyze(after).people.get('p0')
  assert.ok(pb.free < 0, 'the plan is over too')
  assert.ok(pb.overPts >= pa.overPts, `${pb.overPts} over after adding work, ${pa.overPts} before`)
  const [flag] = loadFlags(after)
  assert.match(flag.text, /time in S1 and S2/, 'the flag still names the sprints')
  assert.match(flag.text, /across the plan/)
})

test('room on a span is what its tightest sprint allows: no top-up or drop over-books a sprint', () => {
  // A fills S1; B runs S1 to S2: there is no room for B, however free S2 is.
  const full = plan({}, [{}], [deliv('a', 8, [{ person: 'p0', pct: 94.12 }], { from: 1, to: 1 }), deliv('b', 13, [{ person: 'p0', pct: 5.88 }], { from: 1, to: 2 })])
  const a = analyze(full)
  assert.equal(freeIn(a.people.get('p0'), a.spans.get('b')), 0)
  // Half of S1 is free: B (S1 to S2) can take half of 17, and taking all of it over-books nothing.
  const half = plan({}, [{}], [deliv('a', 5, [{ person: 'p0', pct: 50 }], { from: 1, to: 1 }), deliv('b', 13, [], { from: 1, to: 2 })])
  const h = analyze(half)
  const room = freeIn(h.people.get('p0'), h.spans.get('b'))
  assert.equal(room, 8)
  const topped = structuredClone(half)
  topped.deliverables[1].members.push({ person: 'p0', pct: pctForPoints(half, undefined, 'b', 'p0', room) })
  const t = analyze(topped)
  assert.equal(t.shares.get('b:p0').points, room)
  assert.equal(t.people.get('p0').over, false)
  // Across a whole-plan card, a full S1 leaves nothing either.
  const whole = plan({}, [{}], [deliv('a', 13, [{ person: 'p0', pct: 76.47 }], { from: 1, to: 2 }), deliv('c', 13, [])])
  const w = analyze(whole)
  assert.equal(freeIn(w.people.get('p0'), w.spans.get('c')), 8, 'a quarter of S1 is free, so a quarter of 34')
})

test('a vacation outside a deliverable\'s sprints takes nothing from it', () => {
  const card = [deliv('a', 13, [{ person: 'p0', pct: 100 }], { from: 1, to: 1 })]
  const clear = analyze(plan({}, [{}], card))
  const away = analyze(plan({}, [{ vacations: [{ from: '2026-11-02', to: '2026-11-16' }] }], card))
  assert.equal(away.people.get('p0').sprintCap[0], clear.people.get('p0').sprintCap[0], 'S1 is S1, whatever happens in S3')
  assert.equal(away.shares.get('a:p0').points, 9)
  assert.equal(away.deliverables.get('a').leavePts, 0)
  assert.deepEqual(away.deliverables.get('a').leave, [])
  assert.equal(+away.deliverables.get('a').lands.date, +clear.deliverables.get('a').lands.date)
  assert.ok(away.people.get('p0').cap < clear.people.get('p0').cap, 'the vacation still costs them points, in S3 and S4')
})

test('keeping points across new sprints: no time there keeps them as points, and moving back restores the plan', () => {
  const doc = plan({}, [{ vacations: AWAY_S3 }, {}], [deliv('a', 13, [{ person: 'p0', pct: 100 }, { person: 'p1', pct: 50 }], { from: 2, to: 2 })])
  const start = points(doc, 'a')
  assert.equal(start.get('p0'), 9)
  const moved = keepPoints(withWindow(doc, 'a', { from: 3, to: 3 }), undefined, 'a', start)
  assert.deepEqual(moved.fixed, ['p0'], 'P0 has no time in S3, so their 9 points are held as points')
  assert.deepEqual(points(moved.doc, 'a'), start)
  assert.ok(analyze(moved.doc).people.get('p0').over, 'and they are over-booked there, which the flags say')
  const back = keepPoints(withWindow(moved.doc, 'a', { from: 2, to: 2 }), undefined, 'a', points(moved.doc, 'a'))
  assert.deepEqual(back.fixed, [])
  assert.deepEqual(points(back.doc, 'a'), start)
  assert.ok(back.doc.deliverables[0].members[0].pct != null, 'a percentage again (the one nearest 9 of 8.5 pts, not necessarily the 100% it started at)')
  assert.equal(analyze(back.doc).people.get('p0').over, false)
})

test('keeping points past 400%: a whole-plan card squeezed into one sprint keeps its points, and grows back intact', () => {
  const doc = plan({ sprints: 6 }, [{}], [deliv('a', 55, [{ person: 'p0', pct: 100 }])])
  const start = points(doc, 'a')
  assert.equal(start.get('p0'), 55)
  const squeezed = keepPoints(withWindow(doc, 'a', { from: 1, to: 1 }), undefined, 'a', start)
  assert.deepEqual(squeezed.fixed, ['p0'])
  assert.deepEqual(points(squeezed.doc, 'a'), start)
  const grown = keepPoints(withWindow(squeezed.doc, 'a', null), undefined, 'a', points(squeezed.doc, 'a'))
  assert.deepEqual(points(grown.doc, 'a'), start)
  assert.equal(grown.doc.deliverables[0].members[0].pct, 100)
  assert.equal(analyze(grown.doc).people.get('p0').over, false)
  assert.equal(+analyze(grown.doc).deliverables.get('a').lands.date, +analyze(doc).deliverables.get('a').lands.date)
})

test('two years is two years of calendar time, whatever the sprint length', () => {
  const at = (weeksPerSprint, estimate, perSprint) => {
    const s = { ...DEFAULT_SETTINGS, startDate: '2026-10-05', weeksPerSprint, sprints: 4 }
    return landing([perSprint, perSprint, perSprint, perSprint], estimate, spanOf({ window: null }, 4), s)
  }
  const weekly = at(1, 55, 0.75)            // 3 pts over 4 weekly sprints: about 73 weeks
  assert.equal(weekly.kind, 'late')
  const monthly = at(4, 233, 4.25)          // 17 pts over 4 four-week sprints: more than four years
  assert.equal(monthly.kind, 'far')
})

test('exports say what a windowed share is a percentage of, and give one a pivot can add up', () => {
  const doc = plan({}, [{}], [deliv('a', 8, [{ person: 'p0', pct: 94.12 }], { from: 1, to: 1 }), deliv('b', 13, [{ person: 'p0', pct: 76.47 }], { from: 2, to: 3 })])
  const a = analyze(doc)
  const flags = computeFlags(doc, a)
  const t = buildTable('assignments', doc, a, flags)
  assert.deepEqual(t.rows.map(r => r.sprints), ['S1', 'S2 to S3'])
  assert.equal(t.columns.find(c => c.key === 'pct').label, 'Share of their time in its sprints')
  const sum = t.rows.reduce((x, r) => x + r.planPct, 0)
  const booked = buildTable('engineers', doc, a, flags).rows[0].pct
  assert.ok(Math.abs(sum - booked) < 0.2, `${sum} adds up to the engineer's ${booked}`)
})

test('a landing date falls on a day its people work: not Christmas, not the only person\'s vacation', () => {
  // Six sprints from 5 Oct end on Christmas Day, a Chilean holiday: an exactly staffed card lands the day before.
  const xmas = plan({ sprints: 6, countries: ['CL'] }, [{}], [deliv('a', 55, [{ person: 'p0', pct: 100 }])])
  const a = analyze(xmas, cal)
  assert.equal(a.deliverables.get('a').got, a.people.get('p0').cap)
  const lands = a.deliverables.get('a').lands
  assert.equal(lands.kind, 'on-time')
  assert.notEqual(iso(lands.date), '2026-12-25')
  assert.equal(iso(lands.date), '2026-12-24')
  // Ana is away the first week of S2; a small S2 card lands in the week she is back.
  const hotfix = plan({ countries: ['CL'] }, [{ vacations: [{ from: '2026-10-19', to: '2026-10-23' }] }], [deliv('h', 2, [{ person: 'p0', pct: 100 }], { from: 2, to: 2 })])
  const h = analyze(hotfix, cal).deliverables.get('h').lands
  assert.equal(h.kind, 'on-time')
  assert.ok(iso(h.date) >= '2026-10-26' && iso(h.date) <= '2026-10-30', iso(h.date))
})

test('people on a card with no time in its sprints read as that, not as nobody on it', () => {
  const doc = plan({}, [{ vacations: [{ from: '2026-10-19', to: '2026-10-30' }] }], [deliv('h', 2, [{ person: 'p0', pct: 100 }], { from: 2, to: 2 })])
  const a = analyze(doc)
  const da = a.deliverables.get('h')
  assert.equal(da.lands.kind, 'idle')
  assert.equal(landingText(da.lands, doc.settings, da.span).text, 'No date: nobody on it has time in S2')
  const empty = plan({}, [{}], [deliv('e', 2, [], { from: 2, to: 2 })])
  assert.equal(analyze(empty).deliverables.get('e').lands.kind, 'none')
})

test('bringing someone back to 100% cuts where they are over: the card on the busy sprints gives way, the whole-plan card stays', () => {
  const doc = plan({ sprints: 6 }, [{}], [
    deliv('checkout', 55, [{ person: 'p0', pct: 100 }]),
    deliv('search', 2, [{ person: 'p0', pct: 30 }], { from: 4, to: 6 }),
  ])
  const a = analyze(doc)
  assert.ok(a.people.get('p0').peak > 129)
  const f = fitFactors(doc, a, 'p0')
  assert.equal(f.get('checkout'), 1, 'S1 to S3 were never over')
  assert.ok(f.get('search') < 0.01)
  // Every share on the whole plan: the same even scale it always was.
  const even = plan({}, [{}], [deliv('a', 21, [{ person: 'p0', pct: 80 }]), deliv('b', 13, [{ person: 'p0', pct: 40 }])])
  const e = fitFactors(even, analyze(even), 'p0')
  assert.ok(Math.abs(e.get('a') - 100 / 120) < 1e-9 && Math.abs(e.get('b') - 100 / 120) < 1e-9)
  // Two over sprints with no card inside them alone: each share takes its busiest sprint's factor, and no sprint stays over.
  const mixed = plan({}, [{}], [deliv('a', 13, [{ person: 'p0', pct: 100 }], { from: 1, to: 2 }), deliv('b', 13, [{ person: 'p0', pct: 60 }], { from: 2, to: 3 })])
  const m = analyze(mixed), fm = fitFactors(mixed, m, 'p0')
  const after = structuredClone(mixed)
  for (const d of after.deliverables) for (const x of d.members) x.pct = Math.round(x.pct * fm.get(d.id) * 100) / 100
  assert.equal(analyze(after).people.get('p0').overSprints.length, 0)
})
