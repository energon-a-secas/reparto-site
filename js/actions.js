// ── Actions ──────────────────────────────────────────────────
// The operations more than one input path reaches: a pointer drop, a
// keyboard carry and a flag's fix all land here, so they cannot disagree.

import { state, ui, snapshot, person, deliverable, assign, unassign, moveShare, setShare, addPerson, scaleShares } from './state.js'
import { analyze, shareKey, pctForPoints, trimShares } from './capacity.js'
import { cal } from './holidays.js'
import { afterChange, renderAll } from './render.js'
import { showToast, fmtPct } from './utils.js'

const nameOf = p => p?.name.trim() || 'Unnamed'

/**
 * The share a drop gives when nobody typed a number, in points: what the
 * person has free, up to what the deliverable still needs. An unsized
 * deliverable, or one already covered, gets one sprint's worth instead of the
 * whole plan. It is stored as the matching percentage of their capacity.
 */
export function defaultShare(personId, delivId, a = analyze(state.doc, cal)) {
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
    const a = analyze(state.doc, cal)
    const moved = a.shares.get(shareKey(from, personId))?.pct ?? 0
    const there = a.shares.get(shareKey(target, personId))?.pct ?? 0
    snapshot(); moveShare(from, target, personId, moved, there); afterChange()
    showToast(`${nameOf(p)}'s share moved to ${d.name || 'the deliverable'}`)
    return true
  }
  const a = analyze(state.doc, cal)
  const pa = a.people.get(personId)
  const pts = defaultShare(personId, target, a)
  const had = a.shares.get(shareKey(target, personId))
  // The exact percentage that gives the points promised; no capacity: a full share, and the flags say why.
  const pct = pa.cap ? pctForPoints(state.doc, cal, target, personId, (had?.points ?? 0) + pts) : 100
  snapshot()
  if (had) setShare(target, personId, pct); else assign(target, personId, pct)
  afterChange()
  const after = analyze(state.doc, cal)
  const got = after.shares.get(shareKey(target, personId))
  const left = after.people.get(personId).free
  showToast(`${nameOf(p)} gives ${fmtPct(got.pct)} (${got.points} pts) to ${d.name || 'the deliverable'} · ${left < 0 ? `${-left} over` : `${left} free`}`)
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
// Every fix lands exactly: it computes the points it promises and stores the
// percentage that gives them (pctForPoints), so a fix never raises a new flag.
export function applyFix(action, arg, openEstimate) {
  // Instant scroll: the picker anchors to the card, so the card must be on screen first.
  if (action === 'size') { show('deliverable', [arg], { instant: true }); openEstimate(arg); return }
  if (action === 'assign') {
    const [did, pid] = arg.split(':')
    dropPerson(pid, null, did)
    show('deliverable', [did])
    return
  }
  if (action === 'topup') {
    const [did, pid] = arg.split(':')
    const a = analyze(state.doc, cal)
    const sh = a.shares.get(shareKey(did, pid)), free = a.people.get(pid)?.free ?? 0, gap = a.deliverables.get(did)?.gap ?? 0
    const n = Math.min(gap, free)
    if (!sh || n <= 0) return
    snapshot(); setShare(did, pid, pctForPoints(state.doc, cal, did, pid, sh.points + n)); afterChange()
    show('deliverable', [did])
    showToast(`${nameOf(person(pid))} gives ${n} more pts to ${deliverable(did)?.name || 'the deliverable'}`)
    return
  }
  if (action === 'rebalance') {
    const a = analyze(state.doc, cal)
    const pa = a.people.get(arg); if (!pa?.pct) return
    const effective = new Map(state.doc.deliverables.filter(d => d.members.some(m => m.person === arg)).map(d => [d.id, a.shares.get(shareKey(d.id, arg)).pct]))
    snapshot(); scaleShares(arg, 100 / pa.pct, effective); afterChange()
    const b = analyze(state.doc, cal)
    const split = state.doc.deliverables.filter(d => d.members.some(m => m.person === arg))
      .map(d => `${d.name || 'Untitled'} ${fmtPct(b.shares.get(shareKey(d.id, arg)).pct)}`).join(', ')
    showToast(`${nameOf(person(arg))}: ${split}, ${Math.max(0, -b.people.get(arg).free)} over`)
    return
  }
  if (action === 'countries') {
    const cal = document.getElementById('cal')
    if (cal) { cal.open = true; cal.scrollIntoView({ behavior: 'smooth', block: 'start' }) }
    document.querySelector('#countryPicks button')?.focus({ preventScroll: true })
    return
  }
  if (action === 'trim') {
    const d = deliverable(arg); if (!d?.estimate) return
    const members = trimShares(state.doc, cal, d.id)
    snapshot(); d.members = members; afterChange()
    showToast(`${d.name || 'Deliverable'} trimmed to ${d.estimate} pts`)
    return
  }
  if (action === 'open-roles') {
    const n = Math.max(1, Math.min(10, Number(arg) || 1))
    const countries = state.doc.settings.countries
    snapshot()
    const have = state.doc.people.filter(p => p.open).length
    const ids = []
    // With several countries a new role gets the default one, so it does not raise "has no country".
    for (let i = 1; i <= n; i++) ids.push(addPerson({ name: `Open role ${have + i}`, role: 'To hire', open: true, country: countries.length > 1 ? countries[0] : '' }).id)
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
