// ── Flags ────────────────────────────────────────────────────
// Reads the document and its analysis, returns what is missing or wrong.
// Pure: no DOM, no state import. Every flag names its target so a click can
// take the reader to the card, and some carry a one-step fix.
//
//   level  error | warn | info      (sorted in that order)
//   cat    data | people | load | practice
//   target { kind: 'deliverable' | 'person' | 'settings', ids: [] } or null
//   fix    { action, arg, label } or undefined

import { analyze, asEngineers, freeIn } from './capacity.js'
import { planRange, parseISO, fmtSpan, fmtDay } from './calendar.js'
import { spanLabel } from './timeline.js'

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
  if (!unit) return 'not countable in engineers (a full-timer has 0 pts here)'
  const e = asEngineers(points, unit)
  if (e >= 1.05) return `about ${e} engineers`
  if (e >= 0.95) return 'about one engineer'
  if (e < 0.1) return 'under a tenth of an engineer'
  return `about ${e} of an engineer`
}

/** Sprint numbers as a reader says them: "S2", "S1 and S2", "S1 to S3, S5". Indices are 0-based. */
export function sprintList(indices) {
  const runs = []
  for (const i of [...indices].sort((x, y) => x - y)) {
    const last = runs[runs.length - 1]
    if (last && i === last[1] + 1) last[1] = i; else runs.push([i, i])
  }
  const say = ([x, y]) => (x === y ? `S${x + 1}` : y === x + 1 ? `S${x + 1} and S${y + 1}` : `S${x + 1} to S${y + 1}`)
  return runs.map(say).join(', ')
}

/**
 * When a deliverable lands, in words the card, the table, the map and the
 * exports share: { short, text, late, afterPlan, date }. `short` fits a cell
 * ("13 Nov", "~9 Jan 2027"); `text` is the sentence.
 */
export function landingText(lands, s, span = null) {
  const start = parseISO(s.startDate)
  const day = d => fmtDay(d, !start || d.getUTCFullYear() !== start.getUTCFullYear())
  const where = span && !span.whole ? spanLabel(span) : 'the plan'
  switch (lands?.kind) {
    case 'on-time': return { short: day(lands.date), text: `Lands ${day(lands.date)}, in S${lands.sprint + 1}`, date: lands.date, late: false }
    case 'late': return {
      short: `~${day(lands.date)}`, date: lands.date, late: true, afterPlan: lands.afterPlan,
      text: `At this pace it lands about ${day(lands.date)}, after ${lands.afterPlan ? 'the plan ends' : where}`,
    }
    case 'far': return { short: 'Not in sight', text: 'At this pace it does not land within two years', late: true, afterPlan: true }
    case 'none': return { short: 'No date', text: 'No date: nobody is on it yet' }
    case 'idle': return { short: 'No date', text: `No date: nobody on it has time in ${span && !span.whole ? spanLabel(span) : 'this plan'}` }
    default: return { short: 'No date', text: 'No date until it is sized' }
  }
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

  // Everyone, hired before open roles, for the fixes. Role keys are worked out once: staffingFix
  // runs for every short card, and a big plan made that quadratic in the sort. Room is per span.
  const byFree = doc.people
    .map(p => ({ p, pa: a.people.get(p.id), role: roleKey(p.role) }))
    .sort((x, y) => (x.p.open - y.p.open) || (y.pa.free - x.pa.free))

  /**
   * The fix for a deliverable that needs more: first give more to someone
   * already on it who has room, then add someone whose role matches the
   * people there, then whoever has the most room. The role is named when it
   * matches nobody on the card, so "Add Elena Torres (QA)" is a choice, not a surprise.
   */
  function staffingFix(d, gap) {
    const span = a.spans.get(d.id)
    const members = new Set(d.members.map(m => m.person))
    // Room is what someone has free in this deliverable's sprints, not across the quarter.
    const withRoom = byFree.map(x => ({ ...x, free: freeIn(x.pa, span) })).filter(x => x.free > 0)
    const topUp = withRoom.filter(x => members.has(x.p.id) && !x.p.open).sort((x, y) => y.free - x.free)[0]
    if (topUp && gap > 0) return { action: 'topup', arg: `${d.id}:${topUp.p.id}`, label: `Give ${nameOf.get(topUp.p.id)} ${Math.min(gap, topUp.free)} more pts` }
    const roles = new Set(d.members.map(m => roleKey(byId.get(m.person)?.role)).filter(Boolean))
    // Never someone already on SPREAD_LIMIT cards at once in these sprints: adding them would raise
    // "split across" and break the promise that a fix raises no new flag. Then hired first, whoever
    // covers the whole gap, the role match, the most room.
    const atOnce = x => { let m = 0; for (let i = span.a; i <= span.b; i++) m = Math.max(m, x.pa.active[i]); return m }
    const pick = withRoom.filter(x => !members.has(x.p.id) && atOnce(x) < SPREAD_LIMIT)
      .sort((x, y) => (x.p.open - y.p.open) || ((y.free >= gap) - (x.free >= gap)) || (roles.has(y.role) - roles.has(x.role)) || (y.free - x.free))[0]
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
    const span = da.span, when = span.whole ? '' : ` in ${spanLabel(span)}`
    if (!d.name.trim()) add('warn', 'data', 'A deliverable has no name.', t)
    if (!d.estimate) add('error', 'data', `${label} has no estimate. Size it on the Fibonacci scale.`, t, { action: 'size', arg: d.id, label: 'Size it' })
    if (span.clamped) {
      add('warn', 'data', `${label} is set for S${d.window.from} to S${d.window.to}, past this plan's ${plural(s.sprints, 'sprint')}, so it runs in ${spanLabel(span, { whole: false })}.`, t,
        { action: 'window', arg: d.id, label: 'Change its sprints' })
    }
    if (!d.members.length) {
      add('error', 'people', `Nobody is on ${label}${d.estimate ? ` (${pts(d.estimate)}${when})` : ''}.`, t, staffingFix(d, d.estimate || 0))
    } else if (da.gap > 0) {
      // Say when leave made it short: "Ana's vacation (19 to 23 Oct) takes 4" is a different conversation from a missing hire.
      const why = da.leavePts ? ` ${da.leavePts >= da.gap ? 'Leave explains it' : `Leave explains ${pts(da.leavePts)} of it`}: ${leaveLines(da, doc, a).join('; ')}.` : ''
      // And when it would land at the pace it has: the date is what a stakeholder asks for.
      const lands = da.lands.kind === 'late' || da.lands.kind === 'far' ? ` ${landingText(da.lands, s, span).text}.` : ''
      add('error', 'people', `${label} is short ${pts(da.gap)}${when}, ${engineers(da.gap, da.unitWindow || unit)}.${why}${lands}`, t, staffingFix(d, da.gap))
    } else if (d.estimate && da.gap < 0) {
      add('warn', 'load', `${label} has ${pts(-da.gap)} more than its estimate.`, t, { action: 'trim', arg: d.id, label: 'Trim to fit' })
    }
    const open = d.members.filter(m => byId.get(m.person)?.open)
    if (open.length) {
      add('warn', 'people', `${label} relies on ${open.map(m => nameOf.get(m.person)).join(' and ')}, not hired yet.`, t)
    }
    // A big deliverable is fine once it has a team; the warning is about one person carrying it in its sprints.
    if (da.unitWindow && d.estimate > da.unitWindow && d.members.length < 2) {
      add('warn', 'practice', `${label} (${pts(d.estimate)}) is bigger than one engineer's ${span.whole ? 'whole plan' : spanLabel(span)} (${pts(da.unitWindow)}). Split it, give it more sprints, or put more than one person on it.`, t)
    }
  }

  // ── People ──
  for (const p of doc.people) {
    const pa = a.people.get(p.id)
    const t = { kind: 'person', ids: [p.id] }
    const name = nameOf.get(p.id)
    if (!p.name.trim()) add('warn', 'data', 'Someone on the team has no name.', t)
    if (!pa.cap) add('warn', 'data', `${name} has no capacity in this plan (load or sprints away).`, t)
    if (pa.over) {
      // `also`: the cards this person is on carry the badge too, so a green card cannot hide it.
      const on = doc.deliverables.filter(d => d.members.some(m => m.person === p.id)).map(d => d.id)
      // Over across the quarter, or over in some sprints while the quarter adds up (two deliverables on the same sprints).
      const worst = Math.max(0, ...pa.overSprints.map(i => pa.load[i]))
      const away = pa.overSprints.filter(i => !(pa.sprintCap[i] > 1e-9))
      const quarter = `${Math.round(pa.pct)}% of their capacity (${pa.used} of ${pts(pa.cap)})`
      // The plan when it is over in every sprint they have time in, else the sprints (with the plan too when it is over).
      const everywhere = pa.free < 0 && pa.sprintCap.every((c, i) => !(c > 1e-9) || pa.overSprints.includes(i))
      const text = pa.overSprints.length && !everywhere
        ? `${name} is booked ${worst ? `${Math.round(worst)}% of their time in ${sprintList(pa.overSprints.filter(i => pa.sprintCap[i] > 1e-9))}` : ''}${worst && away.length ? ', and ' : ''}${away.length ? `points in ${sprintList(away)}, where they have no time` : ''}${pa.free < 0 ? `, and ${Math.round(pa.pct)}% of their capacity across the plan (${pa.used} of ${pts(pa.cap)});` : ','} ${pts(pa.overPts)} over. Move one of their deliverables to other sprints, or lower a share.`
        : `${name} is booked ${quarter}, ${pa.overPts} over.`
      // Scaling helps only when some sprint is past 100% of their time.
      add('error', 'load', text, { ...t, also: on },
        pa.peak > 100 ? { action: 'rebalance', arg: p.id, label: `Bring ${name} back to 100%` } : undefined)
    }
    // Context switching is about deliverables at the same time: four in a row is a sequence, not a split.
    if (pa.concurrent > SPREAD_LIMIT) {
      add('warn', 'practice', pa.concurrent === pa.count
        ? `${name} is split across ${pa.count} deliverables. Every switch costs focus.`
        : `${name} is on ${pa.concurrent} deliverables at once in ${sprintList(pa.active.map((x, i) => (x === pa.concurrent ? i : -1)).filter(i => i >= 0))}. Every switch costs focus.`, t)
    }
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
    // No engineer unit (the calendar leaves a full-timer nothing): a new role would have nothing either, so no fix.
    add('error', 'people', `The plan needs ${pts(a.demand)} and the team has ${a.capacity}: short ${gap}, ${engineers(gap, unit)}${openN ? ` on top of ${plural(openN, 'open role')}` : ''}.`, null,
      unit ? { action: 'open-roles', arg: String(hires), label: `Add ${hires} open role${hires === 1 ? '' : 's'}` } : undefined)
  } else if (a.openCap && a.demand > a.hiredCap) {
    add('warn', 'people', `Without open roles the team has ${a.hiredCap} of the ${pts(a.demand)} planned: ${a.demand - a.hiredCap} depend on hiring.`, null)
  }

  return out.sort((x, y) => LEVEL_ORDER[x.level] - LEVEL_ORDER[y.level])
}

/**
 * What each person's leave takes from a deliverable, as sentences:
 * "Ana Rojas's vacation (19 to 23 Oct) takes 4 pts". Vacation periods are
 * the ones that touch the plan.
 */
export function leaveLines(da, doc, a = null) {
  const range = planRange(doc.settings)
  const touches = v => range && parseISO(v.to) >= range.from && parseISO(v.from) < range.to
  return (da.leave || []).map(l => {
    const p = doc.people.find(x => x.id === l.person)
    const name = p?.name.trim() || 'Unnamed'
    const bits = []
    if (l.vacation) {
      // Only the periods that cost a working day: one on a weekend or a holiday took nothing.
      const cost = a?.people.get(l.person)?.vacationDays
      const costs = v => !cost || cost.some(d => d >= v.from && d <= v.to)
      const spans = (p?.vacations || []).filter(v => touches(v) && costs(v)).map(v => fmtSpan(v.from, v.to))
      bits.push(`${name}'s vacation${spans.length ? ` (${spans.join(', ')})` : ''} takes ${pts(l.vacation)}`)
    }
    if (l.away) bits.push(`${name}'s ${p?.sprintsOff === 1 ? 'sprint' : 'sprints'} away take${p?.sprintsOff === 1 ? 's' : ''} ${pts(l.away)}`)
    return bits.join(', ')
  })
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
  const overPeople = doc.people.filter(p => a.people.get(p.id).over).map(p => ({ name: p.name.trim() || 'Unnamed', over: a.people.get(p.id).overPts }))
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
  if (da.gap > 0) return { cls: 'short', icon: '!', text: `Short ${da.gap} · ${engineers(da.gap, da.unitWindow || unit)}`, leave: da.leavePts || 0 }
  if (da.gap < 0) return { cls: 'over', icon: '↑', text: `${-da.gap} over the estimate` }
  const people = new Map(doc.people.map(p => [p.id, p]))
  // Over-booked across the quarter, or in any sprint of this deliverable's span.
  const span = da.span
  const busy = d.members.map(m => m.person).find(id => {
    const pa = a.people.get(id)
    return pa && (pa.free < 0 || pa.overSprints.some(i => !span || (i >= span.a && i <= span.b)))
  })
  if (busy) return { cls: 'risk', icon: '!', text: `Staffed, but ${people.get(busy)?.name.trim() || 'Unnamed'} is ${a.people.get(busy).overPts} over`, risk: true }
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
