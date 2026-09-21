// The acceptance checks from the 2026-09-21 role review (TPM, PM, EM, Scrum,
// QA), one test per item that has a Node-checkable half.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyze, shareKey, splitPoints, pctForPoints, trimShares, DEFAULT_SETTINGS } from '../js/capacity.js'
import { computeFlags, missingPeople, deliverableStatus, flagIndex } from '../js/flags.js'
import { daysOffFor } from '../js/calendar.js'
import { toMarkdown } from '../js/report.js'

globalThis.localStorage ??= { getItem: () => null, setItem() {} }
const st = await import('../js/state.js')
const { examplePlan, blankPlan } = await import('../js/seed.js')

const load = cc => JSON.parse(fs.readFileSync(new URL(`../data/holidays/${cc}.json`, import.meta.url)))
const H = { CL: load('CL'), US: load('US'), MX: load('MX') }
const cal = { holidays: (c, y) => H[c]?.years[y] || null, status: () => 'ok' }

const plan = (settings = {}, people = [], deliverables = [], daysOff = []) => st.normalizeDoc({
  title: 't', settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff,
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, role: '', ...p })),
  deliverables,
})
const deliv = (id, estimate, members) => ({ id, name: id.toUpperCase(), estimate, members })
const example = () => { const r = examplePlan(); r.settings.startDate = '2026-10-05'; return st.normalizeDoc(r) }

test('1. rounding: one factor from the full-timer, no cliffs', () => {
  const caps = [0, 1, 2, 3, 4, 5].map(n => {
    const vac = n ? [{ from: '2026-10-19', to: `2026-10-${String(18 + n).padStart(2, '0')}` }] : []
    return analyze(plan({ countries: ['CL'] }, [{ vacations: vac }]), cal).people.get('p0').cap
  })
  assert.deepEqual(caps, [34, 33, 32, 31, 30, 30])
  const loads = [100, 80, 60, 50].map(l => analyze(plan({ countries: ['CL'] }, [{ load: l }]), cal).people.get('p0').cap)
  assert.deepEqual(loads, [34, 27, 20, 17])
  const books = [0, 10, 15, 20, 30].map(b => analyze(plan({ countries: ['CL'], buffer: b }), cal))
  assert.deepEqual(books.map(a => a.bookable), [34, 31, 29, 27, 24])
  assert.ok(books.every(a => a.unit === 34))
  const q = analyze(plan({ sprints: 6 }, [{}]))
  assert.equal(q.people.get('p0').cap, 55); assert.equal(q.unit, 55)
  for (const order of [['US', 'CL'], ['CL', 'US']]) {
    const a = analyze(plan({ sprints: 6, countries: order }, [{ country: 'US' }, { country: 'CL' }]), cal)
    assert.ok(Math.abs(a.people.get('p0').cap - a.people.get('p1').cap) <= 2, order.join())
  }
  const six = plan({ sprints: 6, countries: ['CL'] }, [{}])
  assert.ok(computeFlags(six, analyze(six, cal)).some(f => /Rounding plans every engineer/.test(f.text)))
  const four = plan({ countries: ['CL'] }, [{}])
  assert.ok(!computeFlags(four, analyze(four, cal)).some(f => /Rounding plans every engineer/.test(f.text)))
})

test('2. Missing people is the hiring gap, and agrees with the team flags', () => {
  const doc = example(), a = analyze(doc, cal)
  const mp = missingPeople(doc, a)
  assert.equal(mp.points, Math.max(0, a.demand - a.hiredCap))
  const hiring = computeFlags(doc, a).find(f => /depend on hiring/.test(f.text))
  if (hiring) assert.ok(hiring.text.includes(`: ${mp.points} depend on hiring`), hiring.text)
  const one = plan({}, [{}], [deliv('big', 55, [{ person: 'p0', pct: 161.77 }])])
  const b = analyze(one)
  assert.equal(missingPeople(one, b).points, 21); assert.equal(missingPeople(one, b).status, 'error')
  assert.ok(computeFlags(one, b).some(f => /short 21/.test(f.text)))
  const idle = plan({}, [{}, {}], [deliv('x', 8, []), deliv('y', 8, [{ person: 'p0', pct: 30 }])])
  const c = analyze(idle)
  assert.equal(missingPeople(idle, c).points, 0); assert.equal(missingPeople(idle, c).status, 'warn')
})

test('3. at risk: staffed by an over-booked person or an open role', () => {
  const doc = example(), a = analyze(doc, cal)
  const st3 = id => { const d = doc.deliverables.find(x => x.id === id); return deliverableStatus(d, a.deliverables.get(id), a, doc) }
  assert.equal(st3('checkout').cls, 'risk'); assert.match(st3('checkout').text, /Bruno Silva/)
  assert.equal(st3('release').cls, 'risk')
  assert.equal(st3('export').cls, 'risk'); assert.match(st3('export').text, /Open role/)
  assert.ok(flagIndex(computeFlags(doc, a)).get('checkout').error >= 1)
})

test('5. holidays corrected per country: worked days and scoped team days', () => {
  const us = plan({ countries: ['US'] }, [{ country: 'US' }, { country: 'CL' }], [], [{ date: '2026-11-27', label: 'Bridge', country: 'US' }])
  const off = daysOffFor(us.people[0], us, cal.holidays)
  assert.ok(off.has('2026-10-12'))
  const before = analyze(us, cal).people.get('p0')
  const worked = st.normalizeDoc({ ...us, settings: { ...us.settings, worked: [{ country: 'US', date: '2026-10-12' }, { country: 'US', date: 'nope' }] } })
  assert.equal(worked.settings.worked.length, 1)
  const after = analyze(worked, cal).people.get('p0')
  assert.equal(after.lost.holiday, before.lost.holiday - 1)
  assert.equal(after.raw, before.raw + 1)
  assert.equal(before.lost.team, 1)                                        // the US bridge day hits the US engineer
  assert.equal(analyze(us, cal).people.get('p1').lost.team, 0)             // and not the Chilean one
})

test('9. a short deliverable is topped up by someone already on it first', () => {
  const doc = plan({}, [{ name: 'Ana Rojas', role: 'Backend' }, { name: 'Bruno', role: 'Frontend' }], [deliv('payments', 21, [{ person: 'p0', pct: 29.41 }])])
  const f = computeFlags(doc, analyze(doc)).find(x => /short/.test(x.text))
  assert.equal(f.fix.action, 'topup'); assert.equal(f.fix.arg, 'payments:p0')
  assert.equal(f.fix.label, 'Give Ana Rojas 11 more pts')
  const full = plan({}, [{ name: 'Ana', role: 'Backend' }, { name: 'Bea', role: 'Backend dev' }, { name: 'Quinn', role: 'QA' }],
    [deliv('payments', 55, [{ person: 'p0', pct: 100 }]), deliv('q', 21, [{ person: 'p2', pct: 62 }]), deliv('b', 21, [{ person: 'p1', pct: 76 }])])
  const g = computeFlags(full, analyze(full)).find(x => /Payments|PAYMENTS/.test(x.text) && /short/.test(x.text))
  assert.equal(g.fix.arg, 'payments:p1')                                    // the Backend person, not the one with more room
})

test('10. Scale to 100% clears the over-booking', () => {
  st.state.doc = example()
  const a = analyze(st.state.doc, cal)
  const eff = new Map(st.state.doc.deliverables.filter(d => d.members.some(m => m.person === 'bruno')).map(d => [d.id, a.shares.get(shareKey(d.id, 'bruno')).pct]))
  st.scaleShares('bruno', 100 / a.people.get('bruno').pct, eff)
  const b = analyze(st.state.doc, cal)
  assert.equal(b.people.get('bruno').free, 0)
  assert.ok(b.people.get('bruno').pct > 99.9 && b.people.get('bruno').pct < 100.1)
  const flags = computeFlags(st.state.doc, b)
  assert.ok(!flags.some(f => /Bruno Silva is booked/.test(f.text)))
  assert.ok(flags.some(f => /(Checkout redesign|Release automation) is short/.test(f.text)))
})

test('11. "bigger than one engineer" only while one person carries it', () => {
  const two = plan({}, [{}, {}], [deliv('big', 55, [{ person: 'p0', pct: 100 }, { person: 'p1', pct: 61.77 }])])
  assert.ok(!computeFlags(two, analyze(two)).some(f => /bigger than one engineer/.test(f.text)))
  const one = plan({}, [{}], [deliv('big', 55, [{ person: 'p0', pct: 100 }])])
  assert.ok(computeFlags(one, analyze(one)).some(f => /bigger than one engineer/.test(f.text)))
})

test('12. fixes land exactly: trim leaves no over-estimate flag', () => {
  const doc = plan({ countries: ['CL'] }, [{ vacations: [{ from: '2026-10-05', to: '2026-10-23' }] }, {}],
    [deliv('x', 8, [{ person: 'p0', pct: 50 }]), deliv('y', 13, [{ person: 'p0', pct: 50 }, { person: 'p1', pct: 8.83 }])])
  const d = doc.deliverables.find(x => x.id === 'x')
  d.members = trimShares(doc, cal, 'x')
  const a = analyze(doc, cal)
  assert.equal(a.deliverables.get('x').got, 8)
  const y = doc.deliverables.find(x => x.id === 'y'); y.members = trimShares(doc, cal, 'y')
  const b = analyze(doc, cal)
  assert.equal(b.deliverables.get('y').got, 13)
  assert.ok(!computeFlags(doc, b).some(f => /more than its estimate/.test(f.text)))
  const exact = pctForPoints(doc, cal, 'x', 'p0', 5)
  const c = analyze(st.normalizeDoc({ ...doc, deliverables: doc.deliverables.map(z => z.id === 'x' ? { ...z, members: [{ person: 'p0', pct: exact }] } : z) }), cal)
  assert.equal(c.shares.get(shareKey('x', 'p0')).points, 5)
})

test('13. a blank plan warns that no holidays count, and offers Pick countries', () => {
  const b = blankPlan(); b.people.push({ id: 'p', name: 'Someone' })
  const doc = st.normalizeDoc(b)
  const f = computeFlags(doc, analyze(doc)).find(x => /No public holidays/.test(x.text))
  assert.equal(f.level, 'warn'); assert.equal(f.fix.action, 'countries')
})

test('15. team points per sprint, and the thin sprint shows', () => {
  const xmas = { from: '2026-12-14', to: '2026-12-25' }
  const doc = plan({ countries: ['CL'], sprints: 6 }, [{}, {}, { vacations: [xmas] }, { vacations: [xmas] }, { vacations: [xmas] }])
  const a = analyze(doc, cal)
  assert.equal(a.perSprint.length, 6)
  assert.ok(a.perSprint[5] < a.perSprint[1] / 2, a.perSprint.join(','))
})

test('17. weeks and days are whole numbers after an import', () => {
  const doc = plan({ weeksPerSprint: 2.4, daysPerWeek: 5.6 })
  assert.equal(doc.settings.weeksPerSprint, 2); assert.equal(doc.settings.daysPerWeek, 6)
})

test('18. the report: as-of date, the real end date, the On column, At risk, no "= 32 = 32"', () => {
  const doc = example(), a = analyze(doc, cal)
  const md = toMarkdown(doc, a, { cal, countryName: c => ({ CL: 'Chile', MX: 'Mexico' })[c] || c, today: new Date(2026, 8, 21) })
  assert.match(md, /As of 21 Sep 2026/)
  assert.match(md, /ends 27 Nov 2026/)
  assert.match(md, /\| On \|/)
  assert.match(md, /Payments API v2 \d+ \(100%\)/)
  assert.match(md, /\| At risk: Staffed, but Bruno Silva/)
  assert.match(md, /Chile: 12 Oct/)
  const b = blankPlan(); b.people.push({ id: 'p', name: 'Solo' })
  const blank = st.normalizeDoc(b)
  assert.ok(!toMarkdown(blank, analyze(blank), { today: new Date(2026, 8, 21) }).includes('= 32 = 32'))
})

test('19. previews and storage agree: split points and reversed vacations', () => {
  assert.equal(splitPoints(34, [25, 25, 25, 25]).reduce((t, x) => t + x, 0), 34)
  assert.equal(splitPoints(21, [50, 50]).reduce((t, x) => t + x, 0), 21)
  const doc = plan({}, [{}])
  const off = daysOffFor({ vacations: [{ from: '2026-10-23', to: '2026-10-19' }] }, doc, () => null)
  assert.equal([...off.values()].filter(o => o.kind === 'vacation').length, 5)
})

test('23. the scale reaches 144 and 233', () => {
  const doc = plan({}, [], [deliv('huge', 144, []), deliv('bigger', 233, [])])
  assert.deepEqual(doc.deliverables.map(d => d.estimate), [144, 233])
})

// Item 4 (a replaced plan is kept) became named plans: nothing is replaced any more. test/plans.test.mjs covers it.
