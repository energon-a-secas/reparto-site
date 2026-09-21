// node --test test/   (no dependencies; the modules are plain ES modules)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { roundFib, fibFloor, fibCeil, fibNearest, analyze, personCapacity, sprintPoints, DEFAULT_SETTINGS } from '../js/capacity.js'
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
  const doc = plan({ country: 'CL' }, [{}])
  const off = daysOffFor(doc.people[0], doc, cal.holidays)
  assert.ok(off.has('2026-10-12') && off.has('2026-10-31') && off.has('2026-11-01'))
  const a = analyze(doc, cal)
  assert.equal(a.offDays, 1)
  assert.equal(a.unitRaw, 31)
  assert.equal(a.unit, 34)
})

test('a full vacation week costs its meeting day too: 32 - 1 - 4 = 27 -> 21', () => {
  const doc = plan({ country: 'CL' }, [{ vacations: [{ from: '2026-10-19', to: '2026-10-23' }] }])
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
  const doc = plan({ country: 'CL', buffer: 10 }, [{ load: 50, sprintsOff: 1 }])
  // 31 after the holiday, x 3/4 sprints, x 50%, x 90%
  assert.equal(+personCapacity(doc.people[0], doc, cal).raw.toFixed(3), +(31 * 0.75 * 0.5 * 0.9).toFixed(3))
})

test('a plan that crosses the year reads both years of holidays', () => {
  const doc = plan({ country: 'CL', startDate: '2026-12-07' }, [{}])
  const w = sprintWindows(doc.settings)
  assert.equal(w.length, 4)
  const off = daysOffFor(doc.people[0], doc, cal.holidays)
  assert.ok(off.has('2026-12-08') && off.has('2027-01-01'))
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
  has(/^error:load:P0 is booked 42 of 34/)
  has(/^error:people:The plan needs 97 pts and the team has 68/)
  has(/^warn:practice:C \(55 pts\) is bigger than one engineer/)
})
