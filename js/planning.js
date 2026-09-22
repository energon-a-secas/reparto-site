// Deliverable planning metadata, independent of staffing calculations.
export const PRIORITIES = {
  p1: { label: 'P1', rank: 1, color: 'rose' },
  p2: { label: 'P2', rank: 2, color: 'orange' },
  p3: { label: 'P3', rank: 3, color: 'amber' },
  p4: { label: 'P4', rank: 4, color: 'blue' },
  p5: { label: 'P5', rank: 5, color: 'teal' },
  p6: { label: 'P6', rank: 6, color: 'slate' },
}
export const PROGRESS = {
  planned: { label: 'Planned', rank: 3 },
  'in-progress': { label: 'In progress', rank: 2 },
  blocked: { label: 'Blocked', rank: 0 },
  'on-hold': { label: 'On hold', rank: 1 },
  done: { label: 'Done', rank: 4 },
}
export const BOX_COLORS = { slate: 'Slate', blue: 'Blue', teal: 'Teal', violet: 'Violet', amber: 'Amber', orange: 'Orange', rose: 'Red' }
const known = (list, key) => typeof key === 'string' && Object.hasOwn(list, key)
const LEGACY_PRIORITY = { urgent: 'p1', high: 'p2', normal: 'p3', low: 'p6' }
export function priorityOf(d) {
  const key = typeof d.priority === 'string' ? d.priority.toLowerCase() : Number.isInteger(d.priority) ? `p${d.priority}` : ''
  return known(PRIORITIES, key) ? key : known(LEGACY_PRIORITY, key) ? LEGACY_PRIORITY[key] : 'p3'
}
// Completion is the existing Done list; restoring a deliverable restores its
// previous progress. There is no second, contradictory completed state.
export const progressOf = d => d.when === 'done' ? 'done' : known(PROGRESS, d.progress) && d.progress !== 'done' ? d.progress : 'planned'
// Badge colors are fixed. Only the box color can be overridden; older custom
// badge colors migrate to box colors so the user's choice is retained.
export const priorityColorOf = d => PRIORITIES[priorityOf(d)].color
const boxOverride = d => {
  const value = d.boxColor ?? d.priorityColor
  return known(BOX_COLORS, value) ? value : ''
}
export const boxColorOf = d => boxOverride(d) || priorityColorOf(d)
export function normalizePlanning(d) {
  return {
    priority: priorityOf(d),
    progress: progressOf({ ...d, when: undefined }),
    boxColor: boxOverride(d),
  }
}
export function sortByPriority(list, direction = 1) {
  return list.map((d, index) => ({ d, index })).sort((a, b) =>
    (PRIORITIES[priorityOf(a.d)].rank - PRIORITIES[priorityOf(b.d)].rank) * direction || a.index - b.index
  ).map(x => x.d)
}
