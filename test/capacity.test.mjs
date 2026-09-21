// node --test test/   (no dependencies; the modules are plain ES modules)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { roundFib, fibFloor, fibCeil, fibNearest, analyze, personCapacity, sprintPoints, DEFAULT_SETTINGS, shareKey, pctFor } from '../js/capacity.js'
import { sprintWindows, daysOffFor, nextQuarterStart, workdaysIn } from '../js/calendar.js'
import { computeFlags } from '../js/flags.js'

const CL = JSON.parse(fs.readFileSync(new URL('../data/holidays/CL.json', import.meta.url)))
const cal = { holidays: (c, y) => (c === 'CL' ? CL.years[y] || [] : null), status: c => (c === 'CL' ? 'ok' : 'none') }
const plan = (settings = {}, people = [], deliverables = [], daysOff = []) => ({
  title: 't', settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff,
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, role: '', load: 100, sprintsOff: 0, open: false, country: '', vacations: [], ...p })),
  deliverables,
})

test('Fibonacci rounding: the brief\'s own numbers', () => {
  assert.equal(roundFib(32), 34)                  // 8 pts x 4 sprints
  assert.equal(roundFib(48), 55)                  // a full quarter
  assert.equal(roundFib(32, 'down'), 21)
  assert.equal(roundFib(32, 'up'), 34)
  assert.equal(roundFib(32, 'none'), 32)
  assert.equal(fibNearest(27), 21)                // 6 below, 7 above
  assert.equal(fibNearest(28), 34)
  assert.equal(fibFloor(0.5), 0)
  assert.equal(fibCeil(0), 0)
})

test('sprint cap is a ceiling, not an override', () => {
  assert.equal(sprintPoints({ ...DEFAULT_SETTINGS }), 8)
  assert.equal(sprintPoints({ ...DEFAULT_SETTINGS, sprintCap: 5 }), 5)
  assert.equal(sprintPoints({ ...DEFAULT_SETTINGS, sprintCap: 13 }), 8)
  assert.equal(sprintPoints({ ...DEFAULT_SETTINGS, meetingDay: false }), 10)
})

test('no calendar: 2 weeks x 4 focus days x 4 sprints = 32 -> 34', () => {
  const a = analyze(plan({}, [{}]))
  assert.equal(a.unitRaw, 32)
  assert.equal(a.unit, 34)
  assert.equal(a.offPts, 0)
})

test('Chile Q4 2026: one weekday holiday (12 Oct), two on a weekend', () => {
  const doc = plan({ countries: ['CL'] }, [{}])
  const off = daysOffFor(doc.people[0], doc, cal.holidays)
  assert.ok(off.has('2026-10-12') && off.has('2026-10-31') && off.has('2026-11-01'))
  const a = analyze(doc, cal)
  assert.equal(a.offDays, 1)
  assert.equal(a.unitRaw, 31)
  assert.equal(a.unit, 34)
})

test('a full vacation week costs its meeting day too: 32 - 1 - 4 = 27 -> 21', () => {
  const doc = plan({ countries: ['CL'] }, [{ vacations: [{ from: '2026-10-19', to: '2026-10-23' }] }])
  const pc = personCapacity(doc.people[0], doc, cal)
  assert.equal(pc.lost.vacation, 5)
  assert.equal(pc.raw, 27)
  assert.equal(analyze(doc, cal).people.get('p0').cap, 21)
})

test('team days off hit everyone, weekends cost nothing', () => {
  const doc = plan({}, [{}], [], [{ date: '2026-11-20', label: 'Offsite' }, { date: '2026-11-21', label: 'Saturday' }])
  assert.equal(analyze(doc).unitRaw, 31)
  assert.equal(workdaysIn(['2026-11-20', '2026-11-21', '2026-11-22'], doc.settings), 1)
})

test('load, sprints away and buffer scale after the calendar', () => {
  const doc = plan({ countries: ['CL'], buffer: 10 }, [{ load: 50, sprintsOff: 1 }])
  // 31 after the holiday, x 3/4 sprints, x 50%, x 90%
  assert.equal(+personCapacity(doc.people[0], doc, cal).raw.toFixed(3), +(31 * 0.75 * 0.5 * 0.9).toFixed(3))
})

test('a plan that crosses the year reads both years of holidays', () => {
  const doc = plan({ countries: ['CL'], startDate: '2026-12-07' }, [{}])
  const w = sprintWindows(doc.settings)
  assert.equal(w.length, 4)
  const off = daysOffFor(doc.people[0], doc, cal.holidays)
  assert.ok(off.has('2026-12-08') && off.has('2027-01-01'))
})

test('each person follows their own country, the rest the team default', () => {
  const US = JSON.parse(fs.readFileSync(new URL('../data/holidays/US.json', import.meta.url)))
  const both = { holidays: (c, y) => (c === 'CL' ? CL.years[y] : c === 'US' ? US.years[y] : null) || null, status: () => 'ok' }
  const doc = plan({ countries: ['CL', 'US'] }, [{}, { country: 'US' }])
  const a = analyze(doc, both)
  assert.equal(a.people.get('p0').raw, 31)        // Chile: 12 Oct
  assert.equal(a.people.get('p1').raw, 29)        // US: Columbus Day, Veterans Day, Thanksgiving
  assert.equal(a.unitRaw, 31)                     // the formula follows the default country
})

test('a plan saved with one country migrates to a list', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} }
  const { normalizeDoc } = await import('../js/state.js')
  const doc = normalizeDoc({ settings: { country: 'CL', startDate: '2026-10-05' }, people: [], deliverables: [] })
  assert.deepEqual(doc.settings.countries, ['CL'])
})

test('next quarter starts on a Monday', () => {
  assert.equal(nextQuarterStart(new Date('2026-09-21T12:00:00Z')), '2026-10-05')
  assert.equal(nextQuarterStart(new Date('2026-11-02T12:00:00Z')), '2027-01-04')
})

test('flags: missing estimate, nobody on it, short, over-booked, team short', () => {
  const doc = plan({}, [{}, {}], [
    { id: 'a', name: 'A', estimate: null, note: '', members: [{ person: 'p0', points: 8 }] },
    { id: 'b', name: 'B', estimate: 8, note: '', members: [] },
    { id: 'c', name: 'C', estimate: 55, note: '', members: [{ person: 'p1', points: 34 }] },
    { id: 'd', name: 'D', estimate: 34, note: '', members: [{ person: 'p0', points: 34 }] },
  ])
  const texts = computeFlags(doc).map(f => `${f.level}:${f.cat}:${f.text}`)
  const has = re => assert.ok(texts.some(t => re.test(t)), `no flag matching ${re}\n${texts.join('\n')}`)
  has(/^error:data:A has no estimate/)
  has(/^error:people:Nobody is on B/)
  has(/^error:people:C is short 21 pts/)
  has(/^error:load:P0 is booked 124% of their time \(42 of 34 pts\), 8 over/)
  has(/^error:people:The plan needs 97 pts and the team has 68/)
  has(/^warn:practice:C \(55 pts\) is bigger than one engineer/)
})

// ── Percentage shares ────────────────────────────────────────
const deliv = (id, estimate, members) => ({ id, name: id.toUpperCase(), estimate, note: '', members })

test('a percentage share follows the person\'s capacity', () => {
  const d = plan({}, [{}], [deliv('x', 21, [{ person: 'p0', pct: 50 }])])
  assert.equal(analyze(d).shares.get(shareKey('x', 'p0')).points, 17)          // 50% of 34
  d.people[0].vacations = [{ from: '2026-10-19', to: '2026-10-30' }]           // two weeks off: 32 - 8 = 24 -> 21
  assert.equal(analyze(d).shares.get(shareKey('x', 'p0')).points, 11)          // 50% of 21, rounded half up
})

test('one person\'s shares round together and add up exactly', () => {
  const d = plan({}, [{}], [deliv('a', 13, [{ person: 'p0', pct: 33.33 }]), deliv('b', 13, [{ person: 'p0', pct: 33.33 }]), deliv('c', 13, [{ person: 'p0', pct: 33.34 }])])
  const a = analyze(d)
  const pts = ['a', 'b', 'c'].map(x => a.shares.get(shareKey(x, 'p0')).points)
  assert.equal(pts.reduce((t, x) => t + x, 0), 34)                             // never 33 or 36
  assert.ok(pts.every(x => x === 11 || x === 12), pts.join(','))
  assert.equal(a.people.get('p0').used, 34)
  assert.equal(Math.round(a.people.get('p0').pct), 100)
})

test('50 / 20 / 30 of a 34-point engineer', () => {
  const d = plan({}, [{}], [deliv('a', 21, [{ person: 'p0', pct: 50 }]), deliv('b', 8, [{ person: 'p0', pct: 20 }]), deliv('c', 13, [{ person: 'p0', pct: 30 }])])
  const a = analyze(d)
  assert.deepEqual(['a', 'b', 'c'].map(x => a.shares.get(shareKey(x, 'p0')).points), [17, 7, 10])
  assert.equal(a.people.get('p0').free, 0)
})

test('over 100% books past capacity and is flagged', () => {
  const d = plan({}, [{}], [deliv('a', 21, [{ person: 'p0', pct: 50 }]), deliv('b', 21, [{ person: 'p0', pct: 62 }])])
  const a = analyze(d)
  assert.equal(a.people.get('p0').used, 38)                                    // 17 + 21.08 -> 38
  assert.equal(a.people.get('p0').free, -4)
  assert.ok(computeFlags(d, a).some(f => /booked 112% of their time/.test(f.text)))
})

test('several people on one deliverable, one person on several', () => {
  const d = plan({}, [{}, {}], [deliv('a', 34, [{ person: 'p0', pct: 50 }, { person: 'p1', pct: 50 }]), deliv('b', 34, [{ person: 'p0', pct: 50 }, { person: 'p1', pct: 50 }])])
  const a = analyze(d)
  assert.equal(a.deliverables.get('a').got, 34)
  assert.equal(a.deliverables.get('b').got, 34)
  assert.equal(a.people.get('p0').free, 0)
})

test('a fixed-points share from an older plan keeps its points', () => {
  const d = plan({}, [{}], [deliv('a', 21, [{ person: 'p0', points: 21 }])])
  const sh = analyze(d).shares.get(shareKey('a', 'p0'))
  assert.equal(sh.points, 21)
  assert.ok(sh.fixed)
  assert.equal(pctFor(21, 34), 61.76)
})

test('state: assign merges, moveShare merges by effective percent', async () => {
  globalThis.localStorage ??= { getItem: () => null, setItem() {} }
  const st = await import('../js/state.js')
  st.state.doc = st.normalizeDoc(plan({}, [{}], [deliv('a', 21, [{ person: 'p0', points: 17 }]), deliv('b', 21, [{ person: 'p0', pct: 10 }])]))
  st.assign('a', 'p0', 10, 50)                          // fixed 17 pts (50%) + 10% -> 60%
  assert.deepEqual(st.state.doc.deliverables[0].members[0], { person: 'p0', pct: 60 })
  st.moveShare('a', 'b', 'p0', 60, 10)
  assert.equal(st.state.doc.deliverables[0].members.length, 0)
  assert.deepEqual(st.state.doc.deliverables[1].members[0], { person: 'p0', pct: 70 })
  const back = st.normalizeDoc(JSON.parse(JSON.stringify(st.state.doc)))
  assert.equal(back.deliverables[1].members[0].pct, 70)
})
