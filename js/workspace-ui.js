// ── Workspace: the browser side ──────────────────────────────
// The Neorgon Workspace client (js/neorgon-workspace.js, vendored) with
// Reparto's two actions and its own section of the Settings sheet:
//   use   "New plan from my team": the chosen team (yours by default) as a
//         plan of its own, people with their country and load
//   save  "Save this plan's people to your workspace": names, roles, countries
// New blank plans read work days and week start from the visitor's settings
// (plans.js usePrefs). Call initWorkspace() before the plan reads its hash:
// a pick's answer arrives in the fragment and the client strips it.
//
// The sheet and the banner build their DOM with textContent; the section
// below does the same. Workspace values reach a plan only through
// planFromWorkspace (normalizeWorkspace) and openPlan (normalizeDoc).

import { NeoWorkspace } from './neorgon-workspace.js'
import { state } from './state.js'
import { openTeamPlan, usePrefs } from './plans.js'
import { TOOL, EVERYONE, teamChoices, planFromWorkspace, workspacePayload } from './workspace.js'
import { plural } from './utils.js'

let ws = null
let chosen = null       // the team the visitor picked in the section, or null for the preferred one
let onOpened = () => {}

const el = (tag, props = {}, ...kids) => {
  const n = document.createElement(tag)
  for (const [k, v] of Object.entries(props)) {
    if (k === 'text') n.textContent = v
    else n.setAttribute(k, v)
  }
  n.append(...kids)
  return n
}

/** The team a new plan starts from: the visitor's pick if it still exists, else theirs, else the first, else everyone. */
function teamFor(workspace) {
  const c = teamChoices(workspace)
  return chosen !== null && (chosen === EVERYONE || c.teams.some(t => t.id === chosen)) ? chosen : c.preferred
}

/** Open a new plan from the workspace. Returns the result of openPlan, or null when the team has nobody. */
export function planFromTeam(workspace, teamId = teamFor(workspace)) {
  const raw = planFromWorkspace(workspace, teamId, { prefs: ws ? ws.prefs() : {}, fiscalStart: state.doc?.settings.fiscalStart })
  if (!raw) return null
  const r = openTeamPlan(raw)
  onOpened(r, raw)
  return r
}

/** Reparto's part of the Settings sheet: which team "New plan from my team" uses, and what the settings change here. */
function renderSection(box) {
  const t = ws.team()
  const parts = []
  if (t.ws) {
    const c = teamChoices(t.ws)
    const sel = el('select', { id: 'wsTeamPick', class: 'neo-ws-input' })   // the kit's own field: 44px in every engine
    for (const team of c.teams) sel.append(el('option', { value: team.id, text: `${team.name} (${plural(team.size, 'person', 'people')})` }))
    sel.append(el('option', { value: EVERYONE, text: `Everyone in your workspace (${plural(c.everyone, 'person', 'people')})` }))
    sel.value = teamFor(t.ws)
    sel.addEventListener('change', () => { chosen = sel.value })
    parts.push(el('div', { class: 'neo-ws-field' }, el('label', { for: 'wsTeamPick', text: 'Team for a new plan' }), sel))
  } else {
    parts.push(el('p', { class: 'neo-ws-note', text: 'Load your team above, or add people on your workspace page, to start a plan from them.' }))
  }
  parts.push(el('p', { class: 'neo-ws-hint', text: 'New plans take your work days and week start from You. Each person keeps their country for public holidays, and their load on the team becomes their capacity.' }))
  box.replaceChildren(...parts)
}

/**
 * Start the client, mount the gear (and the , key) and the team offer.
 * `opened(result, raw)` is told when a plan was made from the team, so the
 * page can repaint and say so.
 */
export function initWorkspace({ opened } = {}) {
  if (typeof opened === 'function') onOpened = opened
  try {
    ws = NeoWorkspace.init({
      tool: TOOL,
      name: 'Reparto',
      actions: {
        use: { label: 'New plan from my team', run: workspace => planFromTeam(workspace) },
        save: { label: 'Save this plan\'s people to your workspace', payload: () => workspacePayload(state.doc) },
      },
      section: { title: 'Reparto', render: renderSection },
    })
  } catch (err) {
    console.error('[Reparto] workspace', err)
    return null
  }
  usePrefs(() => ws.prefs())
  return ws
}

/** The gear in the header and the team banner; after bindEvents, so the header's own buttons are in place. */
export function mountWorkspace() {
  if (!ws) return
  ws.mountGear({ keepMobile: true })   // Settings stays one tap away on a phone
  const banner = document.getElementById('wsBanner')
  if (banner) ws.banner(banner)
  // The example's tip offers the team too, as one button instead of a second banner.
  const tip = document.getElementById('firstRunTeam')
  if (tip) {
    const draw = () => { const t = ws.team(); tip.hidden = !(t.ws && t.ws.people.length) }
    draw()
    ws.on('team', draw)
  }
}

/** The tip's "New plan from my team": the same as the sheet's use action. */
export function useTeam() {
  const t = ws ? ws.team() : null
  return t && t.ws ? planFromTeam(t.ws) : null
}

export const workspace = () => ws
