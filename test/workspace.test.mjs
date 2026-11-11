// The Workspace adapter: the Neorgon Workspace to a Reparto plan and back.
// Pure (js/workspace.js); the browser side is checked by test/workspace-browser.mjs.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeDoc } from '../js/state.js'
import { planFromWorkspace, workspacePayload, prefsSettings, teamChoices, workspaceId, faceOf, EVERYONE } from '../js/workspace.js'
import { normalizeWorkspace, previewMerge, colorFor, initials, inkOn } from '../js/neorgon-workspace-core.js'

const TODAY = new Date(2026, 10, 11)   // 11 Nov 2026: next fiscal quarter (October start) is Jan to Mar 2027

const WS = {
  v: 1,
  me: { person: 'ana-rojas' },
  people: [
    { id: 'ana-rojas', name: 'Ana Rojas', title: 'Backend', country: 'CL', load: 80, email: 'ana@example.com' },
    { id: 'bruno-silva', name: 'Bruno Silva', title: 'Frontend', country: 'CL', color: '#be185d' },
    { id: 'diego-fuentes', name: 'Diego Fuentes', country: 'MX' },
    { id: 'zoe', name: 'Zoe Park', country: 'US' },
  ],
  teams: [
    { id: 'growth', name: 'Growth', members: [{ person: 'zoe' }] },
    { id: 'payments', name: 'Payments', lead: 'ana-rojas', members: [{ person: 'ana-rojas' }, { person: 'bruno-silva', pct: 50 }, { person: 'diego-fuentes' }] },
  ],
}

test('a team becomes a plan: people, countries for holidays, load as capacity', () => {
  const raw = planFromWorkspace(WS, 'payments', { today: TODAY })
  const doc = normalizeDoc(raw)
  assert.equal(doc.title, 'Payments')
  assert.deepEqual(doc.people.map(p => [p.id, p.ws, p.name, p.role, p.country, p.load]), [
    ['ana-rojas', 'ana-rojas', 'Ana Rojas', 'Backend', 'CL', 80],
    ['bruno-silva', 'bruno-silva', 'Bruno Silva', 'Frontend', 'CL', 50],
    ['diego-fuentes', 'diego-fuentes', 'Diego Fuentes', '', 'MX', 100],
  ])
  assert.deepEqual(doc.settings.countries, ['CL', 'MX'], 'the country most people follow is the default')
  assert.equal(doc.people[1].color, '#be185d')
  assert.deepEqual([doc.deliverables, doc.backlog, doc.daysOff], [[], [], []])
  assert.equal(doc.settings.startDate, '2027-01-04', 'no settings: next quarter\'s first Monday')
})

test('everyone, and a team with nobody, and a team that is not there', () => {
  assert.equal(normalizeDoc(planFromWorkspace(WS, EVERYONE, { today: TODAY })).people.length, 4)
  assert.equal(planFromWorkspace(WS, 'nope', { today: TODAY }), null)
  assert.equal(planFromWorkspace({ v: 1, people: [], teams: [] }, EVERYONE, { today: TODAY }), null)
  assert.equal(planFromWorkspace('garbage', EVERYONE, { today: TODAY }), null)
})

test('your team is offered first: the one you are in, else the first', () => {
  assert.equal(teamChoices(WS).preferred, 'payments')
  assert.equal(teamChoices({ ...WS, me: {} }).preferred, 'growth')
  assert.equal(teamChoices({ v: 1, people: [{ name: 'A' }], teams: [] }).preferred, EVERYONE)
})

test('work days and week start from your settings', () => {
  assert.deepEqual(prefsSettings({ d: '12345', w: 1 }, { today: TODAY }), { daysPerWeek: 5, startDate: '2027-01-04' })
  assert.deepEqual(prefsSettings({ d: '1234', w: 7 }, { today: TODAY }), { daysPerWeek: 4, startDate: '2027-01-03' }, 'a Sunday start')
  assert.deepEqual(prefsSettings({ d: '123456', w: 6 }, { today: TODAY }), { daysPerWeek: 6, startDate: '2027-01-02' }, 'a Saturday start')
  assert.deepEqual(prefsSettings({ d: 'x', w: 3, cc: '<b>' }, { today: TODAY }), { startDate: '2027-01-04' }, 'garbage changes nothing')
  assert.deepEqual(prefsSettings({ w: 1 }, { fiscalStart: 1, today: TODAY }), { startDate: '2027-01-04' })
  const doc = normalizeDoc(planFromWorkspace(WS, 'payments', { prefs: { d: '1234', w: 7 }, today: TODAY }))
  assert.equal(doc.settings.daysPerWeek, 4)
  assert.equal(doc.settings.startDate, '2027-01-03')
})

test('nobody with a country: the visitor\'s country is the plan\'s', () => {
  const raw = planFromWorkspace({ v: 1, people: [{ id: 'a', name: 'A' }], teams: [] }, EVERYONE, { prefs: { cc: 'AR' }, today: TODAY })
  assert.deepEqual(normalizeDoc(raw).settings.countries, ['AR'])
})

test('hostile workspace values never reach the plan unchecked', () => {
  const evil = {
    v: 1,
    people: [
      { id: 'x', name: '<img src=x onerror=alert(1)>', title: '"><script>', country: 'ZZ', load: 1e9, color: 'red;background:url(x)' },
      { id: '__proto__', name: 'Proto', load: -5 },
      { name: 'A'.repeat(5000) },
    ],
    teams: [],
  }
  const doc = normalizeDoc(planFromWorkspace(evil, EVERYONE, { today: TODAY }))
  for (const p of doc.people) {
    assert.ok(p.load >= 0 && p.load <= 100)
    assert.ok(p.name.length <= 80)
    assert.equal(p.color, undefined)
    assert.equal(p.country, '')
    assert.match(p.id, /^[A-Za-z0-9_-]+$/)
  }
  assert.ok(doc.people.some(p => p.name.startsWith('<img')), 'kept as text: the view escapes it')
})

test('a long workspace id is cut to Reparto\'s 40 characters and kept whole as ws', () => {
  const id = 'a'.repeat(30) + '-' + 'b'.repeat(17)
  const doc = normalizeDoc(planFromWorkspace({ v: 1, people: [{ id, name: 'Long' }], teams: [] }, EVERYONE, { today: TODAY }))
  assert.equal(doc.people[0].id.length <= 40, true)
  assert.equal(doc.people[0].ws, id)
  assert.equal(workspaceId(doc.people[0]), id)
})

test('normalizeDoc keeps ws and color only when valid, and plans without them are unchanged', () => {
  const base = { title: 'T', people: [{ id: 'p1', name: 'A' }], deliverables: [] }
  assert.deepEqual(Object.keys(normalizeDoc(base).people[0]).sort(), ['country', 'id', 'load', 'name', 'open', 'role', 'sprintsOff', 'vacations'])
  const bad = normalizeDoc({ ...base, people: [{ id: 'p1', name: 'A', ws: 'Not An Id', color: '#zzzzzz' }] }).people[0]
  assert.equal('ws' in bad || 'color' in bad, false)
  const good = normalizeDoc({ ...base, people: [{ id: 'p1', name: 'A', ws: 'ana-rojas', color: '#BE185D' }] }).people[0]
  assert.deepEqual([good.ws, good.color], ['ana-rojas', '#be185d'])
})

test('saving back: names, roles as titles, countries; open roles left out; ids prefixed', () => {
  const doc = normalizeDoc({
    title: 'Q1', settings: { countries: ['CL'] },
    people: [
      { id: 'ana', name: 'Ana Rojas', role: 'Backend', ws: 'ana-rojas' },
      { id: 'p-7', name: 'Nuevo Pérez', role: '', country: 'MX' },
      { id: 'open-1', name: 'Open role', role: 'Backend hire', open: true },
      { id: 'blank', name: '   ' },
    ],
    deliverables: [],
  })
  assert.deepEqual(workspacePayload(doc), { people: [
    { id: 'ana-rojas', name: 'Ana Rojas', title: 'Backend', country: 'CL' },
    { id: 'reparto-p-7', name: 'Nuevo Pérez', country: 'MX' },
  ] })
  assert.equal(workspacePayload({ people: [{ id: 'o', name: 'Open', open: true }] }), null)
  assert.equal(workspacePayload(null), null)
  // With two countries, someone without their own is not guessed.
  const two = normalizeDoc({ title: 'T', settings: { countries: ['CL', 'MX'] }, people: [{ id: 'x', name: 'X' }], deliverables: [] })
  assert.equal(workspacePayload(two).people[0].country, undefined)
})

test('a round trip: plan from the workspace, save it back, nobody is added twice', () => {
  const { ws } = normalizeWorkspace(WS)
  const doc = normalizeDoc(planFromWorkspace(ws, 'payments', { today: TODAY }))
  doc.people.push({ id: 'p-9', name: 'Carla Méndez', role: 'QA', load: 100, sprintsOff: 0, open: false, country: 'CL', vacations: [] })
  const first = previewMerge(ws, workspacePayload(doc))
  assert.deepEqual(first.added, ['reparto-p-9'])
  assert.equal(first.next.people.find(p => p.id === 'ana-rojas').email, 'ana@example.com', 'a save never drops what Reparto does not hold')
  const second = previewMerge(first.next, workspacePayload(doc))
  assert.deepEqual(second.added, [])
  assert.equal(second.next.people.length, first.next.people.length)
})

test('a Reparto-only person matches a stored one by an unambiguous name', () => {
  const { ws } = normalizeWorkspace(WS)
  const r = previewMerge(ws, workspacePayload(normalizeDoc({ title: 'T', people: [{ id: 'z1', name: 'zoe park', country: 'US' }], deliverables: [] })))
  assert.deepEqual(r.added, [])
})

test('every tool draws the same face: the kit\'s colour and initials, keyed on the workspace id', () => {
  const p = { id: 'ana', ws: 'ana-rojas', name: 'Ana María Rojas' }
  assert.deepEqual(faceOf(p), { bg: colorFor('ana-rojas'), ink: inkOn(colorFor('ana-rojas')), text: initials('Ana María Rojas') })
  assert.equal(faceOf({ id: 'b', name: 'B', color: '#be185d' }).bg, '#be185d')
  assert.equal(faceOf({ id: 'p-1', name: 'X' }).bg, colorFor('reparto-p-1'), 'a Reparto-only person: the id they would have in the workspace')
  assert.equal(faceOf({ id: 'p', name: 'X', color: 'url(javascript:1)' }).bg, colorFor('reparto-p'))
  assert.match(faceOf({}).bg, /^#[0-9a-f]{6}$/)
})
