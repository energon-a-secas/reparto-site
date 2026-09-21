// ── Flags ────────────────────────────────────────────────────
// Reads the document and its analysis, returns what is missing or wrong.
// Pure: no DOM, no state import. Every flag names its target so a click can
// take the reader to the card, and some carry a one-step fix.
//
//   level  error | warn | info      (sorted in that order)
//   cat    data | people | load | practice
//   target { kind: 'deliverable' | 'person' | 'settings', ids: [] } or null
//   fix    { action, arg, label } or undefined

import { analyze, asEngineers } from './capacity.js'

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`

export const CATEGORIES = {
  data: 'Missing data',
  people: 'Missing people',
  load: 'Load',
  practice: 'Practice',
}

const LEVEL_ORDER = { error: 0, warn: 1, info: 2 }
const SPREAD_LIMIT = 3      // more deliverables than this per person is context switching
const SOLO_FROM = 21        // a deliverable this big on one person stalls on one absence

const pts = n => `${n} pt${n === 1 ? '' : 's'}`

/** "about 0.6 of an engineer", "about one engineer", "about 1.5 engineers". Shared with the cards and tiles. */
export function engineers(points, unit) {
  const e = asEngineers(points, unit)
  if (e >= 1.05) return `about ${e} engineers`
  if (e >= 0.95) return 'about one engineer'
  return `about ${e} of an engineer`
}

// Country names in English whatever the browser's language, like the rest of the page.
const REGION = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null
const countryLabel = code => { try { return REGION?.of(code) || code } catch { return code } }

export function computeFlags(doc, a = analyze(doc)) {
  const out = []
  const add = (level, cat, text, target = null, fix) => out.push({ level, cat, text, target, fix, id: `${cat}-${out.length}` })
  const nameOf = new Map(doc.people.map(p => [p.id, p.name.trim() || 'Unnamed']))
  const openIds = new Set(doc.people.filter(p => p.open).map(p => p.id))

  // Who has the most room, for the "assign" fixes. Open roles go last.
  const byFree = doc.people
    .map(p => ({ p, free: a.people.get(p.id).free }))
    .filter(x => x.free > 0)
    .sort((x, y) => (x.p.open - y.p.open) || (y.free - x.free))

  // ── Settings ──
  if (doc.settings.sprintCap > 0 && doc.settings.sprintCap > a.derived) {
    add('warn', 'data', `The sprint cap of ${pts(doc.settings.sprintCap)} is above what the focus days give (${pts(a.derived)} a sprint), so it changes nothing.`, { kind: 'settings', ids: [] })
  }
  if (!a.unit) add('error', 'data', 'The capacity formula comes to zero: check focus days and sprints.', { kind: 'settings', ids: [] })

  // ── Calendar ──
  for (const c of a.calendar.failed) {
    add('warn', 'data', `Could not load ${countryLabel(c)}'s public holidays, so none are taken out. Add them as team days off.`, { kind: 'settings', ids: [] })
  }
  if (!doc.settings.country && doc.people.some(p => !p.country)) {
    add('info', 'data', 'No public holidays are taken out: pick a country under Public holidays.', { kind: 'settings', ids: [] })
  }
  const away = doc.people.filter(p => a.people.get(p.id).lost.vacation > 0)
  if (away.length) {
    add('info', 'load', `Vacations in this plan: ${away.map(p => `${nameOf.get(p.id)} ${plural(a.people.get(p.id).lost.vacation, 'day')}`).join(', ')}.`,
      { kind: 'person', ids: away.map(p => p.id) })
  }

  // ── Deliverables ──
  for (const d of doc.deliverables) {
    const t = { kind: 'deliverable', ids: [d.id] }
    const label = d.name.trim() || 'Untitled deliverable'
    const da = a.deliverables.get(d.id)
    if (!d.name.trim()) add('warn', 'data', 'A deliverable has no name.', t)
    if (!d.estimate) add('error', 'data', `${label} has no estimate. Size it on the Fibonacci scale.`, t, { action: 'size', arg: d.id, label: 'Size it' })
    if (!d.members.length) {
      const best = byFree[0]
      add('error', 'people', `Nobody is on ${label}${d.estimate ? ` (${pts(d.estimate)})` : ''}.`, t,
        best ? { action: 'assign', arg: `${d.id}:${best.p.id}`, label: `Add ${nameOf.get(best.p.id)}` } : undefined)
    } else if (da.gap > 0) {
      const best = byFree.find(x => !d.members.some(m => m.person === x.p.id))
      add('error', 'people', `${label} is short ${pts(da.gap)}, ${engineers(da.gap, a.unit)}.`, t,
        best ? { action: 'assign', arg: `${d.id}:${best.p.id}`, label: `Add ${nameOf.get(best.p.id)}` } : undefined)
    } else if (d.estimate && da.gap < 0) {
      add('warn', 'load', `${label} has ${pts(-da.gap)} more than its estimate.`, t, { action: 'trim', arg: d.id, label: 'Trim to fit' })
    }
    const open = d.members.filter(m => openIds.has(m.person))
    if (open.length) {
      add('warn', 'people', `${label} relies on ${open.map(m => nameOf.get(m.person)).join(' and ')}, not hired yet.`, t)
    }
    if (a.unit && d.estimate > a.unit) {
      add('warn', 'practice', `${label} (${pts(d.estimate)}) is bigger than one engineer's whole plan (${pts(a.unit)}). Split it, or put more than one person on it.`, t)
    }
  }

  // ── People ──
  for (const p of doc.people) {
    const pa = a.people.get(p.id)
    const t = { kind: 'person', ids: [p.id] }
    const name = nameOf.get(p.id)
    if (!p.name.trim()) add('warn', 'data', 'Someone on the team has no name.', t)
    if (!pa.cap) add('warn', 'data', `${name} has no capacity in this plan (load or sprints away).`, t)
    if (pa.free < 0) add('error', 'load', `${name} is booked ${pa.used} of ${pts(pa.cap)}, ${-pa.free} over.`, t)
    if (pa.count > SPREAD_LIMIT) add('warn', 'practice', `${name} is split across ${pa.count} deliverables. Every switch costs focus.`, t)
  }

  const idle = doc.people.filter(p => a.people.get(p.id).free > 0 && a.people.get(p.id).cap > 0)
  if (idle.length) {
    const list = idle.map(p => `${nameOf.get(p.id)} ${pts(a.people.get(p.id).free)}`).join(', ')
    add('info', 'load', `Free capacity: ${list}.`, { kind: 'person', ids: idle.map(p => p.id) })
  }

  const solo = doc.deliverables.filter(d => d.members.length === 1 && (d.estimate || 0) >= SOLO_FROM)
  if (solo.length) {
    add('info', 'practice', `${solo.length === 1 ? 'One deliverable rests' : `${solo.length} deliverables rest`} on a single person: ${solo.map(d => d.name.trim() || 'Untitled deliverable').join(', ')}.`,
      { kind: 'deliverable', ids: solo.map(d => d.id) })
  }

  // ── Team ──
  if (!doc.people.length) add('error', 'people', 'The team is empty. Add the people this plan counts on.', null)
  if (!doc.deliverables.length) add('error', 'data', 'There are no deliverables yet.', null)
  if (a.demand > a.capacity) {
    const gap = a.demand - a.capacity
    const hires = Math.max(1, Math.ceil(gap / (a.unit || gap)))
    add('error', 'people', `The plan needs ${pts(a.demand)} and the team has ${a.capacity}: short ${gap}, ${engineers(gap, a.unit)}.`, null,
      { action: 'open-roles', arg: String(hires), label: `Add ${hires} open role${hires === 1 ? '' : 's'}` })
  } else if (a.openCap && a.demand > a.hiredCap) {
    add('warn', 'people', `Without open roles the team has ${a.hiredCap} of the ${pts(a.demand)} planned: ${a.demand - a.hiredCap} depend on hiring.`, null)
  }

  return out.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level])
}

/** Flag counts per target id, for the badges on cards and roster rows. */
export function flagIndex(flags) {
  const idx = new Map()
  for (const f of flags) {
    if (!f.target || f.level === 'info') continue
    for (const id of f.target.ids) {
      const cur = idx.get(id) || { error: 0, warn: 0 }
      cur[f.level] += 1
      idx.set(id, cur)
    }
  }
  return idx
}
