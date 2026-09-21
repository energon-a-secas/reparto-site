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
  if (e < 0.1) return 'under a tenth of an engineer'
  return `about ${e} of an engineer`
}

// Country names in English whatever the browser's language, like the rest of the page.
const REGION = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'region' }) : null
const countryLabel = code => { try { return REGION?.of(code) || code } catch { return code } }

/** The first word of a role, lower-cased: "Backend hire" and "backend" match. */
const roleKey = r => String(r || '').trim().split(/[\s,]+/)[0].toLowerCase()

export function computeFlags(doc, a = analyze(doc)) {
  const out = []
  const add = (level, cat, text, target = null, fix) => out.push({ level, cat, text, target, fix, id: `${cat}-${out.length}` })
  const nameOf = new Map(doc.people.map(p => [p.id, p.name.trim() || 'Unnamed']))
  const byId = new Map(doc.people.map(p => [p.id, p]))
  const unit = a.bookable || a.unit
  const s = doc.settings

  // Who has the most room, for the fixes. Open roles go last.
  const byFree = doc.people
    .map(p => ({ p, free: a.people.get(p.id).free }))
    .filter(x => x.free > 0)
    .sort((x, y) => (x.p.open - y.p.open) || (y.free - x.free))

  /**
   * The fix for a deliverable that needs more: first give more to someone
   * already on it who has room, then add someone whose role matches the
   * people there, then whoever has the most room. The role is named when it
   * matches nobody on the card, so "Add Elena Torres (QA)" is a choice, not a surprise.
   */
  function staffingFix(d, gap) {
    const members = new Set(d.members.map(m => m.person))
    const topUp = byFree.filter(x => members.has(x.p.id) && !x.p.open)[0]
    if (topUp && gap > 0) return { action: 'topup', arg: `${d.id}:${topUp.p.id}`, label: `Give ${nameOf.get(topUp.p.id)} ${Math.min(gap, topUp.free)} more pts` }
    const roles = new Set(d.members.map(m => roleKey(byId.get(m.person)?.role)).filter(Boolean))
    const pick = byFree.filter(x => !members.has(x.p.id))
      .sort((x, y) => (x.p.open - y.p.open) || (roles.has(roleKey(y.p.role)) - roles.has(roleKey(x.p.role))) || (y.free - x.free))[0]
    if (!pick) return undefined
    const role = pick.p.role.split(',')[0].trim()   // "QA, shared with Growth" reads as "QA"
    return { action: 'assign', arg: `${d.id}:${pick.p.id}`, label: `Add ${nameOf.get(pick.p.id)}${role && !roles.has(roleKey(role)) ? ` (${role})` : ''}` }
  }

  // ── Settings ──
  if (s.sprintCap > 0 && s.sprintCap > a.derived) {
    add('warn', 'data', `The sprint cap of ${pts(s.sprintCap)} is above what the focus days give (${pts(a.derived)} a sprint), so it changes nothing.`, { kind: 'settings', ids: [] })
  }
  if (!a.unit) add('error', 'data', 'The capacity formula comes to zero: check focus days and sprints.', { kind: 'settings', ids: [] })
  // Rounding is one factor applied to everyone: say so when it moves the plan a lot.
  const drift = a.unitRaw ? a.unit / a.unitRaw - 1 : 0
  if (s.rounding === 'nearest' && Math.abs(drift) >= 0.2) {
    add('warn', 'practice', `Rounding plans every engineer ${Math.round(Math.abs(drift) * 100)}% ${drift > 0 ? 'above' : 'below'} their focus days (${Math.round(a.unitRaw)} to ${a.unit}). Fibonacci below or no rounding is steadier for this horizon.`, { kind: 'settings', ids: [] })
  }

  // ── Calendar ──
  for (const c of a.calendar.failed) {
    add('warn', 'data', `Could not load ${countryLabel(c)}'s public holidays, so none are taken out. Add them as team days off.`, { kind: 'settings', ids: [] })
  }
  const countries = s.countries || []
  const stateless = doc.people.filter(p => !p.country)
  if (!countries.length && stateless.length) {
    add('warn', 'data', 'No public holidays are taken out: pick the team\'s countries under Public holidays.', { kind: 'settings', ids: [] },
      { action: 'countries', arg: '', label: 'Pick countries' })
  } else if (countries.length > 1 && stateless.length) {
    // With one country the default is obvious; with several it is a guess worth naming.
    add('warn', 'data', `${stateless.map(p => nameOf.get(p.id)).join(', ')} ${stateless.length === 1 ? 'has' : 'have'} no country, so ${stateless.length === 1 ? 'follows' : 'follow'} ${countryLabel(countries[0])}'s holidays. Set it in the person's editor.`,
      { kind: 'person', ids: stateless.map(p => p.id) })
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
      add('error', 'people', `Nobody is on ${label}${d.estimate ? ` (${pts(d.estimate)})` : ''}.`, t, staffingFix(d, d.estimate || 0))
    } else if (da.gap > 0) {
      add('error', 'people', `${label} is short ${pts(da.gap)}, ${engineers(da.gap, unit)}.`, t, staffingFix(d, da.gap))
    } else if (d.estimate && da.gap < 0) {
      add('warn', 'load', `${label} has ${pts(-da.gap)} more than its estimate.`, t, { action: 'trim', arg: d.id, label: 'Trim to fit' })
    }
    const open = d.members.filter(m => byId.get(m.person)?.open)
    if (open.length) {
      add('warn', 'people', `${label} relies on ${open.map(m => nameOf.get(m.person)).join(' and ')}, not hired yet.`, t)
    }
    // A big deliverable is fine once it has a team; the warning is about one person carrying it.
    if (unit && d.estimate > unit && d.members.length < 2) {
      add('warn', 'practice', `${label} (${pts(d.estimate)}) is bigger than one engineer's whole plan (${pts(unit)}). Split it, or put more than one person on it.`, t)
    }
  }

  // ── People ──
  for (const p of doc.people) {
    const pa = a.people.get(p.id)
    const t = { kind: 'person', ids: [p.id] }
    const name = nameOf.get(p.id)
    if (!p.name.trim()) add('warn', 'data', 'Someone on the team has no name.', t)
    if (!pa.cap) add('warn', 'data', `${name} has no capacity in this plan (load or sprints away).`, t)
    if (pa.free < 0) {
      // `also`: the cards this person is on carry the badge too, so a green card cannot hide it.
      const on = doc.deliverables.filter(d => d.members.some(m => m.person === p.id)).map(d => d.id)
      add('error', 'load', `${name} is booked ${Math.round(pa.pct)}% of their capacity (${pa.used} of ${pts(pa.cap)}), ${-pa.free} over.`, { ...t, also: on },
        pa.pct > 0 ? { action: 'rebalance', arg: p.id, label: `Scale ${name} to 100%` } : undefined)
    }
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
  const openN = doc.people.filter(p => p.open).length
  if (a.demand > a.capacity) {
    const gap = a.demand - a.capacity
    const hires = Math.min(10, Math.max(1, Math.ceil(gap / (unit || gap))))   // the fix adds at most 10 at a time
    add('error', 'people', `The plan needs ${pts(a.demand)} and the team has ${a.capacity}: short ${gap}, ${engineers(gap, unit)}${openN ? ` on top of ${plural(openN, 'open role')}` : ''}.`, null,
      { action: 'open-roles', arg: String(hires), label: `Add ${hires} open role${hires === 1 ? '' : 's'}` })
  } else if (a.openCap && a.demand > a.hiredCap) {
    add('warn', 'people', `Without open roles the team has ${a.hiredCap} of the ${pts(a.demand)} planned: ${a.demand - a.hiredCap} depend on hiring.`, null)
  }

  return out.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level])
}

/**
 * The hiring gap, the one number the Missing people tile shows. Demand the
 * hired team cannot cover (open roles do not count as hired), with what
 * explains it: open roles, work nobody is on yet, and over-booked people.
 */
export function missingPeople(doc, a) {
  const hired = doc.people.filter(p => !p.open)
  const points = Math.max(0, a.demand - a.hiredCap)
  const freeHired = hired.filter(p => a.people.get(p.id).free > 0).map(p => ({ name: p.name.trim() || 'Unnamed', free: a.people.get(p.id).free }))
  const overPeople = doc.people.filter(p => a.people.get(p.id).free < 0).map(p => ({ name: p.name.trim() || 'Unnamed', over: -a.people.get(p.id).free }))
  const sized = doc.deliverables.some(d => d.estimate)
  return {
    points,
    onOpen: Math.min(points, a.openCap),
    beyond: Math.max(0, a.demand - a.capacity),
    unstaffed: a.shortfall,
    unstaffedOn: [...a.deliverables.values()].filter(x => x.gap > 0).length,
    over: a.over,
    freeHired, overPeople,
    engineers: asEngineers(points, a.bookable || a.unit),
    status: points > 0 ? 'error' : (a.shortfall > 0 || a.over > 0) ? 'warn' : sized ? 'ok' : 'none',
  }
}

/**
 * One status per deliverable, shared by the cards, the Markdown and the
 * exports so they cannot disagree. "Staffed" only when the people on it are
 * hired and not over-booked; otherwise it is at risk.
 */
export function deliverableStatus(d, da, a, doc) {
  const unit = a.bookable || a.unit
  if (!d.estimate) return { cls: 'unsized', icon: '?', text: da.got ? `Unsized · ${da.got} pts booked` : 'Unsized: pick a Fibonacci size' }
  if (!d.members.length) return { cls: 'empty', icon: '!', text: `Nobody on it · needs ${d.estimate}` }
  if (da.gap > 0) return { cls: 'short', icon: '!', text: `Short ${da.gap} · ${engineers(da.gap, unit)}` }
  if (da.gap < 0) return { cls: 'over', icon: '↑', text: `${-da.gap} over the estimate` }
  const people = new Map(doc.people.map(p => [p.id, p]))
  const busy = d.members.map(m => m.person).find(id => (a.people.get(id)?.free ?? 0) < 0)
  if (busy) return { cls: 'risk', icon: '!', text: `Staffed, but ${people.get(busy)?.name.trim() || 'Unnamed'} is ${-a.people.get(busy).free} over`, risk: true }
  const open = d.members.map(m => people.get(m.person)).find(p => p?.open)
  if (open) return { cls: 'risk', icon: '!', text: `Staffed by ${open.name.trim() || 'an open role'}, not hired yet`, risk: true }
  return { cls: 'ok', icon: '✓', text: 'Staffed' }
}

/** The status as the exports print it: a risk says so first. */
export const statusText = st => (st.risk ? `At risk: ${st.text}` : st.text)

/** Flag counts per target id, for the badges on cards and roster rows. */
export function flagIndex(flags) {
  const idx = new Map()
  for (const f of flags) {
    if (!f.target || f.level === 'info') continue
    for (const id of [...f.target.ids, ...(f.target.also || [])]) {
      const cur = idx.get(id) || { error: 0, warn: 0 }
      cur[f.level] += 1
      idx.set(id, cur)
    }
  }
  return idx
}
