// ── Example plan ─────────────────────────────────────────────
// Six people and seven deliverables, wrong on purpose so every kind of flag
// shows up on first load: an unsized deliverable, one nobody took, one short
// of people, Bruno split 50% and 62% (112%, over-booked), one open role carrying work, and a 55 that
// one person cannot carry. Ana's week of vacation takes her to 30 points. Fixing them is
// the tour. The team spans Chile and Mexico (Diego works from Mexico), and the
// open role has no country yet, which is itself a flag. The accessibility audit
// runs over the first two sprints only, so the map shows a deliverable on part of the plan.

import { DEFAULT_SETTINGS, defaultStart } from './capacity.js'
import { parseISO, addDays, iso } from './calendar.js'

export function examplePlan({ fiscalStart = DEFAULT_SETTINGS.fiscalStart } = {}) {
  // Dates follow the calendar so the example never plans a quarter already gone:
  // it starts next quarter, and Ana takes the third week off.
  const start = defaultStart(fiscalStart)
  const week3 = addDays(parseISO(start), 14)
  return {
    v: 1,
    title: 'Example quarter',
    settings: { ...DEFAULT_SETTINGS, startDate: start, countries: ['CL', 'MX'], fiscalStart },
    daysOff: [],
    people: [
      { id: 'ana', name: 'Ana Rojas', role: 'Backend', load: 100, sprintsOff: 0, open: false, country: 'CL', vacations: [{ from: iso(week3), to: iso(addDays(week3, 4)) }] },
      { id: 'bruno', name: 'Bruno Silva', role: 'Frontend', load: 100, sprintsOff: 0, open: false, country: 'CL' },
      { id: 'carla', name: 'Carla Méndez', role: 'Full stack', load: 100, sprintsOff: 0, open: false, country: 'CL' },
      { id: 'diego', name: 'Diego Fuentes', role: 'Mobile', load: 100, sprintsOff: 1, open: false, country: 'MX' },
      { id: 'elena', name: 'Elena Torres', role: 'QA, shared with Growth', load: 50, sprintsOff: 0, open: false, country: 'CL' },
      { id: 'open-1', name: 'Open role', role: 'Backend hire', load: 100, sprintsOff: 0, open: true },
    ],
    deliverables: [
      { id: 'checkout', name: 'Checkout redesign', estimate: 34, note: '', members: [{ person: 'bruno', pct: 50 }, { person: 'carla', pct: 50 }] },
      { id: 'payments', name: 'Payments API v2', estimate: 55, note: '', members: [{ person: 'ana', pct: 100 }] },
      { id: 'onboarding', name: 'Mobile onboarding', estimate: 21, note: '', members: [{ person: 'diego', pct: 84 }] },
      { id: 'search', name: 'Search relevance', estimate: null, note: '', members: [{ person: 'carla', pct: 25 }] },
      { id: 'export', name: 'Data export', estimate: 13, note: '', members: [{ person: 'open-1', pct: 38 }] },
      { id: 'a11y', name: 'Accessibility audit', estimate: 8, note: '', members: [], window: { from: 1, to: 2 } },
      { id: 'release', name: 'Release automation', estimate: 21, note: '', members: [{ person: 'bruno', pct: 62 }] },
    ],
  }
}

export function blankPlan({ fiscalStart = DEFAULT_SETTINGS.fiscalStart } = {}) {
  return { v: 1, title: 'New plan', settings: { ...DEFAULT_SETTINGS, fiscalStart, startDate: defaultStart(fiscalStart) }, daysOff: [], people: [], deliverables: [] }
}
