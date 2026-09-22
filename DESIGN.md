# Reparto interface

## Purpose and scene

Product register. An engineering manager plans on a laptop and shares the screen
with their team. Keep the existing dark fleet identity, with clear text and enough
separation to read names, capacity and staffing status at a smaller screen size.
The work is the focus; configuration and explanations unfold when needed.

## Visual language

- Use the fleet's canonical tokens from CDN `base.css`. Do not copy or redefine
  those tokens locally, or edit the vendored header, footer, beacon or theme kits.
- Local planner tokens live in `css/style.css`: quiet slate surfaces in OKLCH,
  readable muted text, semantic status inks and a system font stack. The system
  font applies to the workspace, popovers and dialogs; fleet chrome keeps its font.
- Teal identifies the primary action, actionable links, capacity and selection.
  Status colors accompany one icon and a short label. Status buttons open
  focused details; explanations do not compete with names in the board.
- Type: 24–26px plan title, 16px section titles, 14px names and controls, 12–13px
  supporting text. Use weight 500–600 for hierarchy and tabular numeric data.
- Reuse the local Lucide SVG map in `js/icon-data.js`, generated from the names
  in `tools/build-icons.cjs`. No remote icon font or image library is needed.
  Initial avatars have muted, stable colors keyed to person IDs.

## Layout and interactions

- The editable plan name and section links introduce the workspace.
- Capacity settings use a native, initially closed `details` element. The summary
  always shows bookable points per engineer, sprint length and buffer. Calendar
  settings expand independently, using the same summary grid, teal highlights
  and edit affordance. Expanded editors use labeled fields and grouped controls.
  A flag linking to settings opens the rules and focuses their summary.
- The capacity calculation is one grouped strip with larger tabular values and
  a tinted final result. Changed values roll in their direction of change, with
  a brief highlight and signed delta. Only actual changes animate; unrelated
  renders and plan switches stay quiet. Reduced motion uses static deltas.
- Totals share a single row separated by thin rules, becoming two columns on
  phones. Staffing detail is expandable, and its open state survives repaints.
- Desktop: team roster and deliverable board. The roster becomes a normal
  section below 760px. Section links let phone users jump to the team or work.
- Flags live in a dialog reached from the workspace header. Deliverable status
  buttons and person availability indicators open the same dialog scoped to
  that item. Hover/focus previews are supplemental; clicking reveals full
  details on touch and keyboard too. Preserve flag categories, fixes and export.
- Table columns begin with deliverable name and status. Center the estimate,
  booked and short numbers beneath their headings. Compact assignment rows
  use a name, aligned points/percentage and removal action, without avatars.
- Cards abbreviate people to a first name and second-name initial. Long first
  names truncate within the chip; full names remain available on hover, in
  table cells, editors and every export. Never change stored names for layout.
- Priority badges have fixed colors for P1 through P6: red, orange, amber,
  blue, teal and slate. P1 is highest, P6 is lowest. Deliverable boxes and table
  rows get a subtle tint that follows priority automatically. The Box color
  palette overrides only this tint; choosing Automatic restores the link to
  priority. Badge colors never follow the override. Priority sorting is shared
  by cards, tables and backlog.
- Progress (Planned, In progress, Blocked, On hold, Done) is independent of
  staffing. Show both in the table's Status column; priority has its own column.
  Blocked and On hold retain their planned capacity. Done uses the existing
  Done section; returning work restores its assignments. Metadata and a move
  save as one undo step and are included in imports, share links and exports.
- The person selector filters Cards, Table, This plan, Later and Done. Totals
  remain whole-plan values and the filter notice says so. Filtering is ephemeral
  and never changes assignments. Clear it when adding new work, carrying a
  person or following a flag so the destination remains reachable.
- Deliverables are real drag targets and keep their card boundaries. Team rows
  use lighter grouping. Preserve data attributes, input IDs, focus keys
  and the shared drag/carry contract when changing markup.
- Scope and view buttons retain pressed states. Keep settings, Later, Done,
  exports, flags, calendar, keyboard carry and undo reachable in every layout.
- Empty plans explain how to begin. An empty board does not claim that staffing
  has been checked. Longer instructions live in inline disclosures.
- Use visible keyboard focus, native disclosure behavior and reduced-motion
  support. On tablets our utility button labels compact; in the phone overflow
  menu their labels return. The vendor header itself stays unchanged.
- Estimate and assignment popovers stay within the viewport and scroll when
  needed. Touch text inputs use 16px to avoid zooming the page when focused.

## Verification

Run `make test` for the planning, calendar, state and export logic. Check the
browser at desktop, tablet and phone widths, including 320px, with settings and
calendar both expanded. Exercise drag and keyboard assignment, estimates, person
editing, flags, undo, cards/table, Later/Done, plan persistence and exports.
