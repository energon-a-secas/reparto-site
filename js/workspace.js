// ── Workspace adapter ────────────────────────────────────────
// Pure: the Neorgon Workspace (people, teams, your settings) to a Reparto
// plan, and a plan's people back to a workspace payload. No DOM, so
// test/workspace.test.mjs runs it under Node. The browser side (the gear,
// the sheet's actions and section) is js/workspace-ui.js.
//
// Every workspace value is untrusted: it goes through normalizeWorkspace
// here, and the plan this builds goes through normalizeDoc in openPlan().

import { normalizeWorkspace, cleanPrefs, slug, colorFor, inkOn, initials as wsInitials, str } from './neorgon-workspace-core.js'
import { DEFAULT_SETTINGS } from './capacity.js'
import { quarterOf, shiftQuarter } from './quarters.js'
import { addDays, iso } from './calendar.js'

export const TOOL = 'reparto'
export const EVERYONE = ''          // the team choice that means every person in the workspace
const MAX_PEOPLE = 400              // what normalizeDoc keeps
const MAX_COUNTRIES = 12

/**
 * The id a Reparto person has (or would have) in the workspace: the workspace
 * id it came with, else Reparto's own id prefixed with the tool, so two
 * tools' ids never collide and a second save matches the first.
 */
export const workspaceId = p => (p && p.ws) || slug(`${TOOL}-${p?.id ?? ''}`) || `${TOOL}-p`

/** The face every tool draws for this person: the workspace colour (own, else from the id) and Rama's initials. */
export function faceOf(p) {
  const bg = colorFor({ id: workspaceId(p), color: p?.color })
  return { bg, ink: inkOn(bg), text: wsInitials(p?.name || '') }
}

/** The teams a new plan can start from, and which one to offer first: yours (the team `me` is in), else the first. */
export function teamChoices(raw) {
  const { ws } = normalizeWorkspace(raw)
  const teams = ws.teams.map(t => ({ id: t.id, name: t.name, size: t.members.length }))
  const me = ws.me && ws.me.person
  const mine = me ? ws.teams.find(t => t.members.some(m => m.person === me) || t.lead === me) : null
  return { teams, everyone: ws.people.length, preferred: mine ? mine.id : teams[0]?.id ?? EVERYONE }
}

/**
 * Work days and week start from the visitor's settings, for a new plan:
 * `daysPerWeek` is how many days they work (Reparto's weeks work their first
 * N weekdays, so '12345' and '71234' both give 5), and the plan starts on
 * next quarter's first day that is their week start (1 Monday, 6 Saturday,
 * 7 Sunday). Settings that are missing or invalid change nothing.
 */
export function prefsSettings(prefs, { fiscalStart = DEFAULT_SETTINGS.fiscalStart, today = new Date() } = {}) {
  const p = cleanPrefs(prefs)
  const out = {}
  if (p.d) out.daysPerWeek = p.d.length
  const w = p.w || 1
  const q = shiftQuarter(quarterOf(new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())), fiscalStart), 1, fiscalStart)
  let d = q.from
  while ((d.getUTCDay() || 7) !== w) d = addDays(d, 1)
  out.startDate = iso(d)
  return out
}

/** Countries most people follow first (the first is the plan's default), at most twelve. */
function countriesOf(people, fallback) {
  const count = new Map()
  for (const p of people) if (p.country) count.set(p.country, (count.get(p.country) || 0) + 1)
  const list = [...count.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c).slice(0, MAX_COUNTRIES)
  return list.length ? list : fallback ? [fallback] : []
}

const round2 = x => Math.round(x * 100) / 100

/**
 * A new plan from the workspace: one team's members (or everyone with
 * `teamId` EVERYONE), each with their country for holidays and their load as
 * capacity (their own load times their share of the team). Work days, week
 * start and, when nobody has a country, the visitor's country come from
 * `prefs`. Returns null when there is nobody to plan.
 */
export function planFromWorkspace(raw, teamId = EVERYONE, { prefs = {}, fiscalStart = DEFAULT_SETTINGS.fiscalStart, today = new Date() } = {}) {
  const { ws } = normalizeWorkspace(raw)
  const byId = new Map(ws.people.map(p => [p.id, p]))
  const team = teamId ? ws.teams.find(t => t.id === teamId) : null
  if (teamId && !team) return null
  const rows = team
    ? team.members.map(m => ({ p: byId.get(m.person), pct: m.pct })).filter(r => r.p)
    : ws.people.map(p => ({ p, pct: 100 }))
  if (!rows.length) return null
  const people = rows.slice(0, MAX_PEOPLE).map(({ p, pct }) => {
    const out = {
      id: p.id.slice(0, 40).replace(/-+$/, ''), ws: p.id, name: str(p.name, 80), role: str(p.title || '', 80),
      load: round2(((p.load ?? 100) * pct) / 100), sprintsOff: 0, open: false, country: p.country || '', vacations: [],
    }
    if (p.color) out.color = p.color
    return out
  })
  const clean = cleanPrefs(prefs)
  return {
    v: 1,
    title: str(team ? team.name : 'My workspace', 80) || 'My team',
    settings: { ...DEFAULT_SETTINGS, fiscalStart, ...prefsSettings(clean, { fiscalStart, today }), countries: countriesOf(people, clean.cc) },
    daysOff: [], people, deliverables: [], backlog: [],
  }
}

/**
 * The plan's people as a workspace payload: name, role as title, and the
 * country their holidays follow (their own, or the plan's only country).
 * Open roles are seats, not people, and are left out. Null when nobody is left.
 */
export function workspacePayload(doc) {
  const only = doc?.settings?.countries?.length === 1 ? doc.settings.countries[0] : ''
  const people = []
  for (const p of Array.isArray(doc?.people) ? doc.people : []) {
    if (!p || p.open || !str(p.name, 120).trim()) continue
    const out = { id: workspaceId(p), name: str(p.name, 120) }
    if (str(p.role, 120).trim()) out.title = str(p.role, 120)
    const cc = p.country || only
    if (cc) out.country = cc
    if (p.color) out.color = p.color
    people.push(out)
    if (people.length >= 500) break
  }
  return people.length ? { people } : null
}
