// Regressions for the last round (2026-09-21): one test per reproduced
// finding with a Node-checkable half. J journeys, LM model, LP plans.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyze, trimShares, shareKey, DEFAULT_SETTINGS } from '../js/capacity.js'
import { computeFlags, deliverableStatus, engineers } from '../js/flags.js'
import { parseISO } from '../js/calendar.js'
import { toMarkdown } from '../js/report.js'

const memory = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] }, _m: m } }
globalThis.localStorage = memory()
globalThis.sessionStorage = memory()
const st = await import('../js/state.js')
const plans = await import('../js/plans.js')
beforeEach(() => { globalThis.localStorage = memory(); globalThis.sessionStorage = memory(); st.ui.firstRun = false })

const load = cc => JSON.parse(fs.readFileSync(new URL(`../data/holidays/${cc}.json`, import.meta.url)))
const H = { CL: load('CL'), AR: load('AR'), US: load('US') }
const cal = { holidays: (c, y) => H[c]?.years[y] || null, status: () => 'ok' }
const plan = (settings = {}, people = [], deliverables = [], extra = {}) => st.normalizeDoc({
  title: 'P', settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff: [],
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, ...p })), deliverables, ...extra,
})
const flagsOf = doc => computeFlags(doc, analyze(doc, cal))

test('J-3 / LM-5: the staffing fix never offers someone already on three cards, and prefers who covers the gap', () => {
  const doc = plan({}, [{ name: 'Diego' }, { name: 'Carla' }], [
    { id: 'a', name: 'A', estimate: 5, members: [{ person: 'p0', pct: 10 }] },
    { id: 'b', name: 'B', estimate: 5, members: [{ person: 'p0', pct: 10 }] },
    { id: 'c', name: 'C', estimate: 5, members: [{ person: 'p0', pct: 10 }] },
    { id: 'x', name: 'X', estimate: 8, members: [] },
    { id: 'y', name: 'Y', estimate: 21, members: [{ person: 'p1', pct: 90 }] },
  ])
  const fix = flagsOf(doc).find(f => f.target?.ids?.[0] === 'x' && f.cat === 'people').fix
  assert.equal(fix?.label, 'Add Carla', 'Carla, not Diego on his fourth card, although Diego has more room')
})

test('LM-2: leave is netted per card, so "Leave explains it" only where the card is staffed without it', () => {
  // Many shapes; for each short card that says leave explains it, removing all leave must staff it.
  for (const load of [100, 75, 50]) for (const off of [0, 1]) for (const days of [1, 2, 4, 6]) for (const a of [23, 37.5, 50]) {
    const to = `2026-10-${String(18 + days).padStart(2, '0')}`
    const mk = leave => plan({ countries: ['CL'] }, [
      { load, sprintsOff: leave ? off : 0, vacations: leave ? [{ from: '2026-10-19', to }] : [] },
      { vacations: leave ? [{ from: '2026-11-02', to: '2026-11-03' }] : [] },
    ], [
      { id: 'x', name: 'X', estimate: 21, members: [{ person: 'p0', pct: a }, { person: 'p1', pct: a }] },
      { id: 'y', name: 'Y', estimate: 13, members: [{ person: 'p0', pct: 100 - a }, { person: 'p1', pct: 20 }] },
    ])
    const withLeave = analyze(mk(true), cal), without = analyze(mk(false), cal)
    for (const id of ['x', 'y']) {
      const da = withLeave.deliverables.get(id)
      assert.equal(da.leavePts, Math.max(0, without.deliverables.get(id).got - da.got), `${load}% ${off} away ${days}d ${a}%: ${id}`)
      if (da.gap > 0 && da.leavePts >= da.gap) assert.ok(without.deliverables.get(id).gap <= 0)
    }
  }
})

test('LM-3: the report names the holidays of every calendar anyone follows, and only vacations that cost a day', () => {
  const doc = plan({ countries: [] }, [{ name: 'Ana', country: 'CL', vacations: [{ from: '2026-11-07', to: '2026-11-08' }, { from: '2026-10-19', to: '2026-10-20' }, { from: '2027-06-01', to: '2027-06-05' }] }])
  const md = toMarkdown(doc, analyze(doc, cal), { cal, countryName: c => c, today: new Date(2026, 8, 21) })
  assert.match(md, /holidays taken out: CL: 12 Oct/)
  assert.match(md, /vacation, 19 to 20 Oct \|/)
})

test('LM-4: with no engineer unit, no gap reads as a sliver of an engineer and no open-role fix is offered', () => {
  const doc = plan({ countries: ['CL'], sprints: 1, weeksPerSprint: 1 }, [{ country: 'US' }], [{ id: 'x', name: 'X', estimate: 13, members: [] }],
    { daysOff: Array.from({ length: 5 }, (_, i) => ({ date: `2026-10-0${5 + i}`, label: 'Off', country: 'CL' })) })
  const a = analyze(doc, cal)
  assert.equal(a.bookable, 0)
  assert.equal(engineers(11, 0), 'not countable in engineers (a full-timer has 0 pts here)')
  const flags = computeFlags(doc, a)
  assert.ok(!flags.some(f => f.fix?.action === 'open-roles'))
  assert.ok(!flags.some(f => /tenth of an engineer/.test(f.text)))
  assert.doesNotMatch(deliverableStatus(doc.deliverables[0], a.deliverables.get('x'), a, doc).text, /tenth/)
})

test('LM-6: a team day off label with line breaks stays on the Calendar line', () => {
  const doc = plan({}, [], [], { daysOff: [{ date: '2026-10-09', label: 'Offsite\n## Injected\n- item', country: '' }] })
  const md = toMarkdown(doc, analyze(doc), { today: new Date(2026, 8, 21) })
  assert.ok(!/^## Injected/m.test(md))
  assert.ok(!/^- item/m.test(md))
})

test('LM-7: an impossible date is refused, not rolled over into the next month', () => {
  assert.equal(parseISO('2026-04-31'), null)
  assert.equal(parseISO('2026-02-29'), null)
  assert.ok(parseISO('2028-02-29'))
  assert.deepEqual(plan({}, [], [], { daysOff: [{ date: '2026-04-31', label: 'x' }] }).daysOff, [])
})

test('LM-8: Trim to fit leaves a 0-point share alone and cuts from shares that hold points', () => {
  const doc = plan({}, [{ load: 0 }, {}], [{ id: 'x', name: 'X', estimate: 5, members: [{ person: 'p1', pct: 30 }, { person: 'p0', pct: 50 }] }])
  const a = analyze(doc)
  assert.equal(a.shares.get(shareKey('x', 'p0')).points, 0)
  const members = trimShares(doc, { holidays: () => null, status: () => 'none' }, 'x')
  assert.ok(members.some(m => m.person === 'p0'), 'the empty share is still there')
  doc.deliverables[0].members = members
  assert.equal(analyze(doc).deliverables.get('x').got, 5)
})

test('LP-1: when the copy cannot be stored, Delete refuses unless asked again, and says which', () => {
  plans.loadSaved()
  plans.openPlan(plan({}, [{}]), 'blank')
  const id = st.state.planId
  const store = globalThis.localStorage
  globalThis.localStorage = { ...store, getItem: store.getItem, setItem: (k, v) => { if (k === 'reparto-v1-previous') throw new Error('QuotaExceededError'); store.setItem(k, v) } }
  assert.equal(plans.keepPrevious(st.state.doc, 'deleted'), false)
  assert.equal(plans.deletePlan(), 'no-copy')
  assert.equal(st.state.planId, id, 'nothing was deleted')
  assert.equal(plans.deletePlan(undefined, { withoutCopy: true }), 'deleted')
  assert.notEqual(st.state.planId, id)
})

test('LP-1: a full restore list makes room for the newest copy instead of failing', () => {
  const store = memory()
  globalThis.localStorage = { getItem: store.getItem, setItem: (k, v) => { if (k === 'reparto-v1-previous' && v.length > 3000) throw new Error('QuotaExceededError'); store.setItem(k, v) } }
  for (let i = 0; i < 12; i++) assert.equal(plans.keepPrevious(plan({}, Array.from({ length: 3 }, () => ({})), [], { title: `Plan ${i}` }), 'deleted'), true)
  assert.equal(plans.previousPlans()[0].title, 'Plan 11')
})

test('LP-2: a tab whose writes were refused does not wipe another tab\'s plans when storage comes back', () => {
  const shared = memory()
  let full = false
  globalThis.localStorage = { getItem: shared.getItem, setItem: (k, v) => { if (full && k === 'reparto-v1-plans') throw new Error('QuotaExceededError'); shared.setItem(k, v) } }
  plans.loadSaved(); plans.saveState()
  full = true
  st.state.doc = { ...st.state.doc, title: 'Edited while full' }
  assert.equal(plans.saveState(), false)
  // Another tab adds a plan straight into storage meanwhile.
  full = false
  const other = JSON.parse(shared.getItem('reparto-v1-plans'))
  other.plans['pl-other'] = { doc: plan({}, [], [], { title: 'Made in tab B' }), savedAt: Date.now() + 1000, createdAt: 1, origin: 'blank' }
  shared.setItem('reparto-v1-plans', JSON.stringify(other))
  assert.equal(plans.saveState(), true)
  const titles = Object.values(JSON.parse(shared.getItem('reparto-v1-plans')).plans).map(p => p.doc.title)
  assert.deepEqual(titles.sort(), ['Edited while full', 'Made in tab B'])
  assert.equal(plans.isUnsaved(), false)
})

test('LP-3 / LP-4 / LP-5: a hostile document is capped, its rounding checked by own key, a member with no person dropped', () => {
  const t = performance.now()
  const doc = st.normalizeDoc({ settings: { rounding: '__proto__' },
    people: Array.from({ length: 3000 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, role: `r${i % 7}` })),
    deliverables: Array.from({ length: 3000 }, (_, i) => ({ id: `d${i}`, name: `D${i}`, estimate: 13, members: [] })) })
  assert.equal(doc.people.length, 400)
  assert.equal(doc.deliverables.length, 400)
  computeFlags(doc, analyze(doc))
  assert.ok(performance.now() - t < 3000, `${Math.round(performance.now() - t)} ms`)
  for (const r of ['__proto__', 'toString', ['up'], 'constructor']) assert.equal(st.normalizeDoc({ settings: { rounding: r }, people: [], deliverables: [] }).settings.rounding, 'nearest')
  const d = st.normalizeDoc({ people: [{ name: 'No id' }, { id: 'a', name: 'A' }], deliverables: [{ id: 'x', members: [{ pct: 50 }, { person: null, pct: 20 }, { person: 'undefined', pct: 10 }, { person: 'a', pct: 5 }] }] })
  assert.deepEqual(d.deliverables[0].members.map(m => m.person), ['a'])
})

test('LP-6: Duplicate makes a new plan when the title has an emoji across the cut', () => {
  plans.loadSaved()
  plans.openPlan(plan({}, [{}], [], { title: 'x'.repeat(67) + '😀 tail' }), 'blank')
  const first = plans.duplicatePlan()
  plans.switchPlan(plans.listPlans().find(p => p.title.startsWith('x')).id)
  const second = plans.duplicatePlan()
  assert.equal(first.existing, false)
  assert.equal(second.existing, false)
  assert.notEqual(first.id, second.id)
})
