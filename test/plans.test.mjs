// Named plans, Later and Done, Wipe, leave that makes a deliverable short,
// and the holiday tags: the 2026-09-21 second round.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyze, shareKey, pinShares, DEFAULT_SETTINGS } from '../js/capacity.js'
import { computeFlags, leaveLines } from '../js/flags.js'
import { buildTable, TABLES } from '../js/tables.js'
import { toMarkdown } from '../js/report.js'

// A fresh browser for every test: localStorage and sessionStorage in memory.
const memory = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] }, _m: m } }
globalThis.localStorage = memory()
globalThis.sessionStorage = memory()
const st = await import('../js/state.js')
const plans = await import('../js/plans.js')
const { examplePlan } = await import('../js/seed.js')
beforeEach(() => { globalThis.localStorage = memory(); globalThis.sessionStorage = memory(); st.ui.firstRun = false })

const load = cc => JSON.parse(fs.readFileSync(new URL(`../data/holidays/${cc}.json`, import.meta.url)))
const H = { CL: load('CL'), US: load('US'), AR: load('AR') }
const cal = { holidays: (c, y) => H[c]?.years[y] || null, status: () => 'ok', tag: (c, d) => H[c]?.tags?.[d] || '' }

const plan = (title, settings = {}, people = [], deliverables = []) => st.normalizeDoc({
  title, settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff: [],
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, ...p })), deliverables,
})
const deliv = (id, estimate, members, extra = {}) => ({ id, name: id.toUpperCase(), estimate, members, ...extra })

test('a plan saved before named plans migrates into the store as the open plan', () => {
  localStorage.setItem('reparto-v1', JSON.stringify({ v: 1, doc: plan('Mine') }))
  assert.equal(plans.loadSaved(), true)
  assert.equal(st.state.doc.title, 'Mine')
  const store = JSON.parse(localStorage.getItem('reparto-v1-plans'))
  assert.deepEqual(Object.keys(store.plans), [st.state.planId])
})

test('a link or an import opens beside your plan, never over it, and switching back finds it intact', () => {
  localStorage.setItem('reparto-v1', JSON.stringify({ v: 1, doc: plan('Mine', {}, [{}]) }))
  plans.loadSaved()
  const mine = st.state.planId
  const r = plans.openPlan(plan('Shared', {}, [{}, {}]), 'link')
  assert.equal(r.existing, false)
  assert.equal(st.state.doc.title, 'Shared')
  assert.deepEqual(plans.listPlans().map(p => p.title).sort(), ['Mine', 'Shared'])
  assert.ok(plans.switchPlan(mine))
  assert.equal(st.state.doc.title, 'Mine')
  assert.equal(st.state.doc.people.length, 1)
  assert.equal(plans.listPlans().find(p => p.title === 'Shared').origin, 'link')
})

test('the same plan opened twice is switched to, not stored twice', () => {
  plans.loadSaved(); plans.saveState()
  const shared = plan('Shared', {}, [{}])
  plans.openPlan(shared, 'link')
  plans.openPlan(plans.listPlans()[0].id === st.state.planId ? plan('Other') : plan('Other'), 'blank')
  const again = plans.openPlan(shared, 'link')
  assert.equal(again.existing, true)
  assert.equal(st.state.doc.title, 'Shared')
  assert.equal(plans.listPlans().filter(p => p.title === 'Shared').length, 1)
})

test('a first visit that arrives by link keeps nothing: the untouched example is nobody\'s plan', () => {
  assert.equal(plans.loadSaved(), false)
  assert.equal(st.ui.firstRun, true)
  plans.openPlan(plan('Shared'), 'link')
  assert.deepEqual(plans.listPlans().map(p => p.title), ['Shared'])
})

test('undo and redo belong to the plan: switching away and back keeps them', () => {
  plans.loadSaved(); plans.saveState()
  const first = st.state.planId
  st.snapshot(); st.state.doc.title = 'Renamed'; plans.saveState()
  assert.ok(st.canUndo())
  plans.newBlankPlan()
  assert.equal(st.canUndo(), false)
  plans.switchPlan(first)
  assert.ok(st.canUndo())
  st.undo()
  assert.notEqual(st.state.doc.title, 'Renamed')
})

test('deleting keeps a copy to restore, opens the next plan, and the last delete leaves a blank plan', () => {
  localStorage.setItem('reparto-v1', JSON.stringify({ v: 1, doc: plan('One', {}, [{}]) }))
  plans.loadSaved()
  plans.openPlan(plan('Two', {}, [{}]), 'blank')
  plans.deletePlan()
  assert.equal(st.state.doc.title, 'One')
  assert.equal(plans.previousPlans()[0].title, 'Two')
  assert.equal(plans.previousPlans()[0].why, 'deleted')
  plans.deletePlan()
  assert.equal(st.state.doc.title, 'New plan')
  assert.equal(st.state.doc.people.length, 0)
  const back = plans.restorePrevious(1)
  assert.equal(back.title, 'Two')
  assert.equal(st.state.doc.title, 'Two')
  assert.equal(plans.previousPlans().length, 1)
})

test('wipe empties people, deliverables, Later and days off; settings stay unless asked; undo brings it back', () => {
  plans.loadSaved()
  st.state.doc = plan('Busy', { countries: ['CL'], sprints: 6 }, [{}], [deliv('a', 8, [{ person: 'p0', pct: 20 }])])
  st.state.doc.backlog.push({ id: 'b', name: 'B', note: '', estimate: 3, members: [], when: 'later' })
  st.state.doc.daysOff.push({ date: '2026-10-09', label: 'Off', country: '' })
  const before = JSON.stringify(st.state.doc)
  st.snapshot(); st.wipe()
  assert.deepEqual([st.state.doc.people, st.state.doc.deliverables, st.state.doc.backlog, st.state.doc.daysOff], [[], [], [], []])
  assert.equal(st.state.doc.settings.sprints, 6)
  assert.deepEqual(st.state.doc.settings.countries, ['CL'])
  st.undo()
  assert.equal(JSON.stringify(st.state.doc), before)
  st.snapshot(); st.wipe({ settings: true })
  assert.equal(st.state.doc.settings.sprints, 4)
  assert.deepEqual(st.state.doc.settings.countries, [])
  assert.equal(st.state.doc.title, 'Busy')
})

test('Later and Done keep a deliverable and its people out of every number, and back restores them', () => {
  st.state.doc = plan('P', {}, [{}], [deliv('a', 8, [{ person: 'p0', pct: 25 }]), deliv('b', 13, [{ person: 'p0', pct: 40 }])])
  const a0 = analyze(st.state.doc)
  assert.ok(st.moveDeliverable('a', 'later'))
  const a1 = analyze(st.state.doc)
  assert.equal(a1.demand, a0.demand - 8)
  assert.equal(a1.people.get('p0').pct, 40)
  assert.ok(!computeFlags(st.state.doc, a1).some(f => f.target?.ids?.includes('a')))
  assert.ok(st.moveDeliverable('a', 'done'))
  assert.equal(st.state.doc.backlog[0].when, 'done')
  assert.equal(st.moveDeliverable('a', 'done'), false, 'no change is no change')
  assert.ok(st.moveDeliverable('a', 'plan'))
  assert.deepEqual(st.state.doc.deliverables.find(d => d.id === 'a').members, [{ person: 'p0', pct: 25 }])
  assert.equal(st.state.doc.deliverables.find(d => d.id === 'a').when, undefined)
  assert.equal(analyze(st.state.doc).demand, a0.demand)
})

test('a person removed while their deliverable is in Later leaves no ghost share when it comes back', () => {
  st.state.doc = plan('P', {}, [{}, {}], [deliv('a', 8, [{ person: 'p0', pct: 25 }, { person: 'p1', pct: 10 }])])
  st.moveDeliverable('a', 'later')
  st.removePerson('p1')
  assert.deepEqual(st.state.doc.backlog[0].members.map(m => m.person), ['p0'])
  st.moveDeliverable('a', 'plan')
  assert.doesNotThrow(() => analyze(st.state.doc))
})

test('the backlog survives a save, a link and an import: ids unique, people remapped, when kept', () => {
  const doc = st.normalizeDoc({ settings: {}, people: [{ id: 'a b', name: 'A' }],
    deliverables: [{ id: 'x', name: 'X', estimate: 8, members: [] }],
    backlog: [{ id: 'x', name: 'Dup', estimate: 5, members: [{ person: 'a b', pct: 30 }], when: 'done' }, { id: 'y', name: 'Y', when: 'someday' }, null] })
  assert.equal(doc.backlog.length, 2)
  assert.notEqual(doc.backlog[0].id, 'x')
  assert.equal(doc.backlog[0].members[0].person, doc.people[0].id)
  assert.deepEqual(doc.backlog.map(d => d.when), ['done', 'later'])
  assert.deepEqual(st.normalizeDoc({ people: [], deliverables: [] }).backlog, [])
})

test('moving a deliverable out and pinning keeps the person\'s other cards to the point', () => {
  st.state.doc = plan('P', {}, [{}], [deliv('a', 8, [{ person: 'p0', pct: 12.3 }]), deliv('b', 8, [{ person: 'p0', pct: 17.7 }]), deliv('c', 8, [{ person: 'p0', pct: 21.1 }])])
  const a = analyze(st.state.doc)
  const keep = new Map(['b', 'c'].map(id => [id, a.shares.get(shareKey(id, 'p0')).points]))
  st.moveDeliverable('a', 'later')
  st.state.doc = pinShares(st.state.doc, { holidays: () => null, status: () => 'none' }, 'p0', keep)
  const b = analyze(st.state.doc)
  for (const [id, pts] of keep) assert.equal(b.shares.get(shareKey(id, 'p0')).points, pts)
})

test('a short deliverable names the vacation that made it short; fixed shares and holidays are not leave', () => {
  const doc = plan('P', { countries: ['CL'] }, [
    { name: 'Ana', vacations: [{ from: '2026-10-19', to: '2026-10-23' }] },
    { name: 'Diego', sprintsOff: 1 },
    { name: 'Old', vacations: [{ from: '2026-10-19', to: '2026-10-23' }] },
  ], [deliv('pay', 34, [{ person: 'p0', pct: 100 }]), deliv('mob', 34, [{ person: 'p1', pct: 100 }]), deliv('fix', 13, [{ person: 'p2', points: 8 }])])
  const a = analyze(doc, cal)
  const pay = a.deliverables.get('pay')
  assert.ok(pay.gap > 0)
  assert.ok(pay.leavePts >= pay.gap, 'without the vacation it would be staffed')
  assert.match(leaveLines(pay, doc)[0], /^Ana's vacation \(19 to 23 Oct\) takes \d+ pts?$/)
  assert.match(leaveLines(a.deliverables.get('mob'), doc)[0], /^Diego's sprint away takes \d+ pts?$/)
  assert.equal(a.deliverables.get('fix').leavePts, 0, 'fixed points do not shrink with leave')
  const flag = computeFlags(doc, a).find(f => f.target?.ids?.[0] === 'pay' && f.cat === 'people')
  assert.match(flag.text, /Leave explains it: Ana's vacation \(19 to 23 Oct\)/)
  // A holiday is everyone's calendar, not leave.
  const hol = plan('P', { countries: ['CL'] }, [{}], [deliv('x', 55, [{ person: 'p0', pct: 100 }])])
  assert.equal(analyze(hol, cal).deliverables.get('x').leavePts, 0)
})

test('holiday data: Argentina\'s decreed non-working days count and are tagged; US days many firms work are tagged', () => {
  assert.deepEqual(Object.keys(H.AR.tags).filter(d => d.startsWith('2026')), ['2026-03-23', '2026-07-10', '2026-12-07'])
  assert.ok(H.AR.years['2026'].some(([d]) => d === '2026-07-10'))
  assert.deepEqual(Object.entries(H.US.tags).filter(([d]) => d.startsWith('2026')).map(([d, t]) => [d, t]), [['2026-10-12', 'often-worked'], ['2026-11-11', 'often-worked']])
  assert.ok(H.US.years['2026'].some(([, name]) => name === 'Labor Day'))
  // A July plan in Argentina loses the 10 Jul bridge day like any holiday, and working it gives it back.
  const jul = plan('P', { countries: ['AR'], startDate: '2026-07-06', sprints: 1 }, [{}])
  const worked = st.normalizeDoc({ ...jul, settings: { ...jul.settings, worked: [{ country: 'AR', date: '2026-07-10' }] } })
  assert.equal(analyze(worked, cal).people.get('p0').lost.holiday, analyze(jul, cal).people.get('p0').lost.holiday - 1)
})

test('exports: the note and leave on every deliverable, and the Later and Done table and report sections', () => {
  const doc = plan('P', {}, [{ name: 'Ana', vacations: [{ from: '2026-10-19', to: '2026-10-23' }] }],
    [deliv('pay', 55, [{ person: 'p0', pct: 100 }], { note: 'Needs PCI\nsign-off' })])
  doc.backlog.push({ id: 'l', name: 'Later thing', note: 'Q1', estimate: 8, members: [{ person: 'p0', pct: 10 }], when: 'later' },
    { id: 'd', name: 'Shipped', note: '', estimate: null, members: [], when: 'done' })
  const a = analyze(doc)
  const t = buildTable('deliverables', doc, a, computeFlags(doc, a))
  assert.equal(t.rows[0].note, 'Needs PCI\nsign-off')
  assert.ok(t.rows[0].leave > 0)
  const b = buildTable('backlog', doc, a, [])
  assert.equal(TABLES.backlog, 'Later and done')
  assert.deepEqual(b.rows.map(r => [r.name, r.when, r.estimate, r.people]), [['Later thing', 'Later', 8, 'Ana'], ['Shipped', 'Done', null, '']])
  const md = toMarkdown(doc, a, { today: new Date(2026, 8, 21) })
  assert.match(md, /\| Needs PCI sign-off \|/)
  assert.match(md, /leave: Ana's vacation/)
  assert.match(md, /## Later\n\nNot counted in this plan\.\n\n- Later thing, 8 pts, Ana: Q1/)
  assert.match(md, /## Done\n[\s\S]*- Shipped, unsized/)
  assert.ok(md.indexOf('## Later') < md.indexOf('## Flags'))
})

test('the example opens as its own plan and a second open finds it', () => {
  localStorage.setItem('reparto-v1', JSON.stringify({ v: 1, doc: plan('Mine') }))
  plans.loadSaved()
  const r1 = plans.openExample()
  const r2 = plans.openExample()
  assert.equal(r1.existing, false)
  assert.equal(r2.existing, true)
  assert.equal(plans.listPlans().filter(p => p.title === examplePlan().title).length, 1)
})
