// Regressions for the second break-and-verify run (2026-09-21): one test per
// reproduced finding with a Node-checkable half. PL plans, MO model.
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { analyze, DEFAULT_SETTINGS } from '../js/capacity.js'
import { computeFlags, leaveLines } from '../js/flags.js'
import { toMarkdown } from '../js/report.js'

const memory = () => { const m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v) }, removeItem: k => { delete m[k] } } }
const blocked = () => ({ getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } })
globalThis.localStorage = memory()
globalThis.sessionStorage = memory()
const st = await import('../js/state.js')
const plans = await import('../js/plans.js')
const { blankPlan } = await import('../js/seed.js')
beforeEach(() => { globalThis.localStorage = memory(); globalThis.sessionStorage = memory(); st.ui.firstRun = false })

const CL = JSON.parse(fs.readFileSync(new URL('../data/holidays/CL.json', import.meta.url)))
const cal = { holidays: (c, y) => (c === 'CL' ? CL.years[y] : null), status: () => 'ok' }
const plan = (title, settings = {}, people = [], deliverables = [], extra = {}) => st.normalizeDoc({
  title, settings: { ...DEFAULT_SETTINGS, startDate: '2026-10-05', ...settings }, daysOff: [],
  people: people.map((p, i) => ({ id: `p${i}`, name: `P${i}`, ...p })), deliverables, ...extra,
})

test('PL-1: when the browser will not save, a link opened over your edited plan leaves it listed, switchable and undoable', () => {
  globalThis.localStorage = blocked()
  plans.loadSaved()
  st.snapshot(); st.state.doc = plan('My real Q4', {}, [{ name: 'Zoe' }]); assert.equal(plans.saveState(), false)
  const mine = st.state.planId
  assert.ok(st.canUndo())
  plans.openPlan(plan('Colleague plan'), 'link')
  const list = plans.listPlans()
  assert.deepEqual(list.map(p => p.title).sort(), ['Colleague plan', 'My real Q4'])
  assert.ok(list.every(p => p.unsaved), 'the menu says none of it is saved')
  assert.equal(list.find(p => p.title === 'Colleague plan').origin, 'link', 'not labelled the example')
  assert.ok(plans.switchPlan(mine))
  assert.equal(st.state.doc.title, 'My real Q4')
  assert.ok(st.canUndo(), 'its undo history came back with it')
  assert.ok(plans.isUnsaved())
})

test('PL-2 / MO-3: a plan with only days off and settings is kept on delete; a truly blank one is not', () => {
  plans.loadSaved()
  plans.openPlan({ ...blankPlan(), title: 'Q1 calendar', settings: { ...blankPlan().settings, countries: ['AR', 'US'], sprints: 6 },
    daysOff: [{ date: '2026-11-20', label: 'Offsite' }] }, 'blank')
  assert.equal(plans.isBlankPlan(st.state.doc), false)
  plans.deletePlan()
  assert.equal(plans.previousPlans()[0].title, 'Q1 calendar')
  assert.equal(plans.isBlankPlan(st.normalizeDoc(blankPlan())), true)
  plans.newBlankPlan(); plans.deletePlan()
  assert.equal(plans.previousPlans()[0].title, 'Q1 calendar', 'nothing to keep in a blank plan')
})

test('PL-3: the same link or file with missing ids opens once, then is found', () => {
  plans.loadSaved(); plans.saveState()
  const raw = { title: 'Generated Q4', settings: { startDate: '2026-10-05', countries: ['CL'] },
    people: [{ id: 'ana', name: 'Ana' }, { name: 'No id' }], deliverables: [{ name: 'Payments API v2', estimate: 55, members: [{ person: 'ana', pct: 50 }] }, { id: 'ana', name: 'Clash' }] }
  assert.equal(JSON.stringify(st.normalizeDoc(raw)), JSON.stringify(st.normalizeDoc(raw)), 'normalising is deterministic')
  assert.equal(plans.openPlan(structuredClone(raw), 'link').existing, false)
  assert.equal(plans.openPlan(structuredClone(raw), 'link').existing, true)
  assert.equal(plans.listPlans().filter(p => p.title === 'Generated Q4').length, 1)
  const ids = [...st.state.doc.people, ...st.state.doc.deliverables].map(x => x.id)
  assert.equal(new Set(ids).size, ids.length, 'ids stay unique')
})

test('PL-5: deleting the untouched first-run example drops the example banner', () => {
  assert.equal(plans.loadSaved(), false)
  assert.ok(st.ui.firstRun)
  plans.deletePlan()
  assert.equal(st.ui.firstRun, false)
  assert.equal(st.state.doc.title, 'New plan')
})

test('PL-6: restoring by key finds the plan shown, even after the list moved', () => {
  plans.loadSaved()
  plans.openPlan(plan('A', {}, [{}]), 'blank'); plans.deletePlan()
  plans.openPlan(plan('B', {}, [{}]), 'blank')
  const shownKey = plans.previousKey(plans.previousPlans()[0])     // "A", as the dialog showed it
  plans.deletePlan()                                               // another tab: B goes on top of the list
  assert.equal(plans.restorePrevious(shownKey).title, 'A')
  assert.equal(plans.restorePrevious('gone'), null)
})

test('PL-7: Duplicate always makes a new plan, under a title no other plan has', () => {
  plans.loadSaved()
  plans.openPlan(plan('Q4', {}, [{}]), 'blank')
  const q4 = st.state.planId
  assert.equal(plans.duplicatePlan().existing, false)
  assert.equal(st.state.doc.title, 'Copy of Q4')
  plans.switchPlan(q4)
  assert.equal(plans.duplicatePlan().existing, false)
  assert.equal(st.state.doc.title, 'Copy 2 of Q4')
  plans.openPlan(plan('x'.repeat(80), {}, [{}]), 'blank')
  plans.duplicatePlan(); plans.duplicatePlan()
  const long = plans.listPlans().filter(p => p.title.startsWith('Copy')).map(p => p.title)
  assert.equal(new Set(long).size, long.length)
  assert.ok(long.every(t => t.length <= 80))
})

test('MO-1: leave is what the split really lost, so "Leave explains it" means staffed without it', () => {
  // One vacation day: Ana 33 instead of 34, but 50% of either is 17, so leave took nothing from the card.
  const doc = plan('P', { countries: ['CL'] }, [{ name: 'Ana', vacations: [{ from: '2026-10-19', to: '2026-10-19' }] }, { name: 'Bo' }],
    [{ id: 'pay', name: 'Payments', estimate: 55, members: [{ person: 'p0', pct: 50 }, { person: 'p1', pct: 50 }] }])
  const a = analyze(doc, cal)
  assert.equal(a.deliverables.get('pay').leavePts, 0)
  assert.ok(!computeFlags(doc, a).some(f => /Leave explains/.test(f.text)))
  // Against the same plans with every leave removed, over a spread of loads, shares and absences.
  for (const load of [100, 80, 60, 50]) for (const pct of [25, 50, 60, 75, 100]) for (const off of [0, 1]) for (const days of [1, 3, 5, 9]) {
    const to = new Date(Date.UTC(2026, 9, 18 + days)).toISOString().slice(0, 10)
    const mk = leave => plan('P', { countries: ['CL'] }, [{ load, sprintsOff: leave ? off : 0, vacations: leave ? [{ from: '2026-10-19', to }] : [] }],
      [{ id: 'x', name: 'X', estimate: 21, members: [{ person: 'p0', pct }] }, { id: 'y', name: 'Y', estimate: 8, members: [{ person: 'p0', pct: 100 - pct / 2 }] }])
    const withLeave = analyze(mk(true), cal), without = analyze(mk(false), cal)
    for (const id of ['x', 'y']) {
      assert.equal(withLeave.deliverables.get(id).leavePts, without.deliverables.get(id).got - withLeave.deliverables.get(id).got,
        `load ${load}, ${pct}%, ${off} away, ${days} days: ${id}`)
    }
  }
})

test('MO-2: a millennium-long vacation in a link is cut to three years and does not hang the page', () => {
  const raw = { title: 'Link', settings: { startDate: '2026-10-05' }, deliverables: [],
    people: [{ id: 'a', name: 'A', vacations: Array.from({ length: 40 }, (_, i) => ({ from: `1000-01-${String(i % 28 + 1).padStart(2, '0')}`, to: '2999-12-31' })) }] }
  const doc = st.normalizeDoc(raw)
  assert.ok(doc.people[0].vacations.every(v => v.to < '1004-01-01'))
  const t = performance.now()
  analyze(st.normalizeDoc({ ...raw, people: [{ id: 'b', name: 'B', vacations: [{ from: '2026-01-01', to: '2028-12-31' }] }] }))
  analyze(doc)
  assert.ok(performance.now() - t < 500, `${Math.round(performance.now() - t)} ms`)
})

test('MO-4: the leave line names only the periods that cost a working day', () => {
  const doc = plan('P', { countries: ['CL'] }, [{ name: 'Ana', vacations: [
    { from: '2026-10-12', to: '2026-10-12' },       // a Chilean holiday
    { from: '2026-10-19', to: '2026-10-23' },
    { from: '2026-11-07', to: '2026-11-08' },       // a weekend
  ] }], [{ id: 'pay', name: 'Payments', estimate: 34, members: [{ person: 'p0', pct: 100 }] }])
  const a = analyze(doc, cal)
  assert.deepEqual(leaveLines(a.deliverables.get('pay'), doc, a), ["Ana's vacation (19 to 23 Oct) takes 4 pts"])
})

test('MO-5 / MO-6: Later and Done names cannot open Markdown blocks, and one point is "1 pt"', () => {
  const doc = plan('P', {}, [], [], { backlog: [
    { id: 'a', name: '## Injected', estimate: 1, members: [], when: 'later' },
    { id: 'b', name: '> quote', estimate: 2, members: [], when: 'later' },
    { id: 'c', name: '1. list', estimate: null, members: [], when: 'done' },
  ] })
  const md = toMarkdown(doc, analyze(doc), { today: new Date(2026, 8, 21) })
  assert.match(md, /^- \\## Injected, 1 pt, P3 priority, planned$/m)
  assert.match(md, /^- \\> quote, 2 pts, P3 priority, planned$/m)
  assert.match(md, /^- 1\\\. list, unsized, P3 priority, done$/m)
  assert.ok(!/^#+ Injected/m.test(md))
})
