// ── Actions ──────────────────────────────────────────────────
// The operations more than one input path reaches: a pointer drop, a
// keyboard carry and a flag's fix all land here, so they cannot disagree.

import { state, ui, snapshot, person, deliverable, assign, unassign, moveShare, setPoints, addPerson } from './state.js'
import { analyze } from './capacity.js'
import { afterChange, renderAll } from './render.js'
import { showToast } from './utils.js'

const nameOf = p => p?.name.trim() || 'Unnamed'

/**
 * The share a drop gives when nobody typed a number: what the person has
 * free, up to what the deliverable still needs. An unsized deliverable, or
 * one already covered, gets one sprint's worth instead of the whole plan.
 */
export function defaultShare(personId, delivId) {
  const a = analyze(state.doc)
  const free = a.people.get(personId)?.free ?? 0
  const need = deliverable(delivId)?.estimate ? a.deliverables.get(delivId).gap : 0
  const sprint = Math.max(1, a.sprint)
  if (need > 0) return free > 0 ? Math.min(free, need) : Math.min(need, sprint)
  return free > 0 ? Math.min(free, sprint) : sprint
}

/**
 * Land a person on a target. `from` is the deliverable a share is being
 * dragged out of, or null when the person comes from the roster.
 *   roster      -> deliverable  add a share (defaultShare)
 *   deliverable -> deliverable  move the whole share
 *   deliverable -> roster       remove the share
 */
export function dropPerson(personId, from, target) {
  const p = person(personId); if (!p) return false
  if (target === 'roster') {
    if (!from) return false
    const d = deliverable(from)
    snapshot(); unassign(from, personId); afterChange()
    showToast(`${nameOf(p)} taken off ${d?.name || 'the deliverable'}`)
    return true
  }
  const d = deliverable(target)
  if (!d || from === target) return false
  if (from) {
    snapshot(); moveShare(from, target, personId); afterChange()
    showToast(`${nameOf(p)}'s share moved to ${d.name || 'the deliverable'}`)
    return true
  }
  const pts = defaultShare(personId, target)
  snapshot(); assign(target, personId, pts); afterChange()
  const left = analyze(state.doc).people.get(personId).free
  showToast(`${nameOf(p)} gives ${pts} pts to ${d.name || 'the deliverable'} (${left < 0 ? `${-left} over` : `${left} free`})`)
  return true
}

// ── Carry: pick up with a click or Enter, put down on a deliverable ──
export function pickUp(personId, from = null) {
  if (ui.carry && ui.carry.person === personId && ui.carry.from === from) { cancelCarry(); return }
  ui.carry = { person: personId, from }
  renderAll()
  document.querySelector(`[data-action="drop"]`)?.focus()
}
export function cancelCarry() {
  if (!ui.carry) return false
  const key = ui.carry.from ? `s-${ui.carry.from}-${ui.carry.person}` : `p-${ui.carry.person}`
  ui.carry = null
  renderAll()
  document.querySelector(`[data-key="${key}"]`)?.focus()
  return true
}
export function putDown(target) {
  if (!ui.carry) return false
  const { person: pid, from } = ui.carry
  ui.carry = null
  if (!dropPerson(pid, from, target)) renderAll()
  return true
}

// ── Flag fixes ───────────────────────────────────────────────
export function applyFix(action, arg, openEstimate) {
  // Instant scroll: the picker anchors to the card, so the card must be on screen first.
  if (action === 'size') { show('deliverable', [arg], { instant: true }); openEstimate(arg); return }
  if (action === 'assign') {
    const [did, pid] = arg.split(':')
    dropPerson(pid, null, did)
    show('deliverable', [did])
    return
  }
  if (action === 'trim') {
    const d = deliverable(arg); if (!d?.estimate) return
    snapshot()
    let extra = d.members.reduce((s, m) => s + m.points, 0) - d.estimate
    for (const m of [...d.members].reverse()) {
      if (extra <= 0) break
      const cut = Math.min(extra, m.points)
      extra -= cut
      if (cut === m.points) unassign(d.id, m.person); else setPoints(d.id, m.person, m.points - cut)
    }
    afterChange()
    showToast(`${d.name || 'Deliverable'} trimmed to ${d.estimate} pts`)
    return
  }
  if (action === 'open-roles') {
    const n = Math.max(1, Math.min(10, Number(arg) || 1))
    snapshot()
    const have = state.doc.people.filter(p => p.open).length
    const ids = []
    for (let i = 1; i <= n; i++) ids.push(addPerson({ name: `Open role ${have + i}`, role: 'To hire', open: true }).id)
    afterChange()
    show('person', ids)
    showToast(`${n} open role${n === 1 ? '' : 's'} added. Drag them onto what is short.`)
  }
}

// ── Show: scroll to a flag's target and pulse it ─────────────
let _focusTimer = null
export function show(kind, ids, { instant = false } = {}) {
  if (kind === 'settings') { document.getElementById('calc')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return }
  ui.focus = { kind, ids }
  renderAll()
  const first = document.getElementById(`${kind === 'person' ? 'p' : 'd'}-${ids[0]}`)
  first?.scrollIntoView({ behavior: instant ? 'instant' : 'smooth', block: 'center', inline: 'nearest' })
  clearTimeout(_focusTimer)
  _focusTimer = setTimeout(() => { ui.focus = null; renderAll() }, 2200)
}
