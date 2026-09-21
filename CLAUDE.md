# CLAUDE.md: Reparto

Sprint capacity planner: turn a quarter into story points per engineer (focus days,
meeting day, sprint cap, holidays, vacations, Fibonacci rounding), drag people onto
deliverables, and read flags for missing estimates, missing people and over-booking.
For an engineering manager the week before quarter planning.

**Live:** reparto.neorgon.com · **Port:** 8893

## Run

```bash
make serve     # http://localhost:8893 (ES modules: file:// will not load them)
make test      # node --test: arithmetic, calendar, flags, exports, review and breaker regressions
make holidays  # regenerate data/holidays/ (needs npm; installs outside the repo)
```

## Architecture

The model is pure and Node-tested; the view is ES modules over one `state.doc`.

| Module | Owns |
|---|---|
| `js/capacity.js` | Fibonacci scale and rounding (`roundFib`), `sprintPoints`, `personCapacity`, `analyze(doc, cal)` |
| `js/calendar.js` | sprint windows from `settings.startDate`, `daysOffFor` (holidays, team days, vacations), per-sprint focus days |
| `js/flags.js` | `computeFlags(doc, a)`: level, category, target ids, optional one-step fix |
| `js/state.js` | `state.doc`, `ui` (never saved), `normalizeDoc` (the one gate for saved, imported and shared plans), undo 40 deep, mutations |
| `js/holidays.js` | `cal` lookup, lazy `fetch` of `data/holidays/<CC>.json`, repaint through `onHolidays` |
| `js/render.js` | `afterChange()` (save + repaint), the formula chain, the totals |
| `js/render-calendar.js`, `js/render-board.js`, `js/render-flags.js` | calendar outputs, roster and cards, flags panel |
| `js/dnd.js` | pointer drag, 8px threshold, edge auto-scroll, a tap picks up (carry) |
| `js/actions.js` | `dropPerson` (shared by drag, carry and fixes), `defaultShare`, flag fixes, `show()` |
| `js/popover.js`, `js/person-editor.js` | estimate picker and share editor; the person modal with country and vacations |
| `js/events.js`, `js/io.js`, `js/modal.js`, `js/seed.js`, `js/utils.js` | wiring, share link / Markdown report / JSON, dialogs, the example plan, helpers |
| `js/report.js` | the Markdown report, pure (as-of date, formula steps, named holidays, per-sprint points, the On column) |
| `js/tables.js`, `js/formats.js`, `js/xlsx.js`, `js/export-dialog.js` | the plan as `{ name, columns, rows }` tables; CSV / TSV / Markdown; a library-free .xlsx (SpreadsheetML in a stored zip); the Export dialog. Pure except the dialog, tested in `test/tables.test.mjs` |

Vendored from `packages/neorgon-ui/`, never edit in place: `js/neorgon-{header,footer,beacon}.js`, `css/neorgon-*.css`.

## Data

- `localStorage['reparto-v1']` holds `{ v, doc, savedAt }`. `doc` is `{ title, settings, daysOff, people, deliverables }`; a share is `deliverables[].members[] = { person, points }`.
- `settings.countries` is the team's list of ISO codes, the default first; `people[].country` overrides it per person. A plan saved with the older single `settings.country` migrates in `normalizeDoc`. `settings.worked` lists `{ country, date }` holidays a team works anyway; `daysOff[].country` scopes a team day off to one country ('' is everyone).
- `localStorage['reparto-v1-previous']` keeps the last five plans a share link, an import or a new plan replaced (`resetTo()` pushes them), offered under Plan > Restore a previous plan.
- A share link is `#p=` + base64url(JSON of `doc`). The fragment never reaches a server; `loadFromHash()` swaps it in through `resetTo()`, so the visitor's own plan is one undo away, then clears the hash.
- `data/holidays/<CC>.json` is `{ country, name, source, years: { 2026: [[iso, englishName, localName?], ...] } }`, public nationwide holidays only, 2025 to 2030. `index.json` lists the countries.

## Gotchas

- **Never call a holiday API.** Nager.Date's robots.txt disallows `/api/v`, which is why the data is baked. `tools/build-holidays.cjs` generates it from the `date-holidays` package; `make holidays` installs that package under `$TMPDIR` because `npm install` inside a workspace member prunes the monorepo root's `node_modules`. Past 2030 the files return nothing: extend `YEARS` and rerun.
- **Pass `cal` to every `analyze()`.** The default is `NO_CAL`, so a call that forgets it quietly plans with no holidays. Grep `analyze(` when adding one.
- **Holidays are per person, never the union of the team's countries.** `daysOffFor()` takes the person's own country, else `settings.countries[0]`. Unioning them would take US Thanksgiving off a Chilean engineer. With two or more countries, anyone without one raises a flag instead of being guessed silently.
- **The Plan menu must close only itself.** The header kit's `⋯` overflow panel is also a `.header-menu`; the floorplan pattern of closing every `.header-menu.open` shut the panel the moment a menu inside it opened, and a dropdown nested in that panel is clipped by its scroll box anyway. So there is one menu, `data-keep-mobile` on its wrapper, and Undo/Redo are what fold away.
- **Touch drags on a long press.** Rows and chips are `touch-action: pan-y` so a swipe scrolls the page; `dnd.js` starts a touch drag after 250ms still, then cancels `touchmove` (a non-passive listener) so the page holds. `touch-action: none` made the roster a dead zone for scrolling.
- **CSV text cells that start with `=`, `+`, `-` or `@` get a leading apostrophe.** Excel and Sheets run them as formulas when a CSV is opened, and names come from whoever typed them. The .xlsx writes inline strings, which are never evaluated, so it needs no guard.
- **The .xlsx is a stored (uncompressed) zip with fixed 1980 timestamps**, so the same plan gives the same bytes. `python3 -c "import zipfile; print(zipfile.ZipFile('plan.xlsx').testzip())"` checks every CRC; openpyxl in a scratch `--target` dir reads it back.
- **Only the full-time engineer is rounded; everyone else is scaled.** `analyze()` rounds the default-country full-timer onto Fibonacci (31 -> 34), takes `k = unit / unitRaw`, and gives each person `round(raw x k x keep)` (`capFromRaw`), with the buffer (`keep`) applied after rounding. Rounding each person separately made cliffs (a 4th vacation day cost 13 points, 60/75/80% load all planned at 21, a 10% buffer held back nothing), found by all five reviewers on 2026-09-21. Side effect: a one-day change in the default country's calendar often leaves every planned number alone, because the full-timer still rounds to 34 and everyone scales from them; raw shows the change. `test/review.test.mjs` pins the no-cliff numbers.
- **Every fix lands exactly.** Largest-remainder rounding can land `points / cap` one point off, so fixes and the share popover go through `pctForPoints()`, which walks the 0.01% grid across the half-point window and checks each candidate with `splitPoints` over that person's shares. Removing or merging a share can move a point between the person's other cards, so `trimShares()` and drag moves call `pinShares()` afterwards. A fix that raises a new flag is a bug; `test/breakers.test.mjs` pins the cases a fuzzer found.
- **A share is stored between 0.01% and 400%** (`PCT_MIN`, `PCT_MAX` in capacity.js; `pct2` and `normalizeDoc` clamp to the same range). A 1% floor used to make big capacities over-book: 1 point of 233 is 0.43%. A trim that would need more than 400% keeps the share as fixed points.
- **Ids keep to letters, digits, `-` and `_`.** `normalizeDoc` cleans them and remaps members, because share keys (`id:id`) and `data-key` selectors are built from them.
- **A share link applies on `hashchange` too**, so pasting one into a tab that already has Reparto open works. A first visit that arrives by link keeps nothing (the untouched example is nobody's plan).
- **One status per deliverable.** `deliverableStatus()` in flags.js feeds the cards, the Markdown report and the tables, and "At risk" (an over-booked or open-role member) beats a green "Staffed". The over-booking flag carries `target.also`, the cards that person is on, so their badges count it.
- **The sprint cap is a ceiling** (`min(cap, focus days x points)`), not an override: a cap above what the focus days give changes nothing, and a flag says so.
- **A fully away week costs no meeting day.** The meeting day comes out of each week that still has a working day; a day off on a weekend costs nothing.
- **The example plan moves with the calendar.** It starts on next quarter's first Monday, so its totals change each quarter. Tests use fixed dates; do not assert against the example's numbers.
- **The sticky roster lives in `.workspace-main`, its own grid with the board.** A sticky grid item is bounded by the grid container, not its area; with the flags stacking below at 1280px and under, a roster in the outer grid slid over them and swallowed clicks.
- **The popover follows its anchor by `data-key`** because every change rebuilds the cards. `repositionPop()` closes it when the anchor leaves the viewport, so anything that opens it for an off-screen card must scroll there instantly first (`show(..., { instant: true })`), or the first scroll event closes it.
- **A tap picks a person up.** `justDragged()` swallows the click that trails every pointerup; without it, tapping a share inside a card picks it up and the trailing click drops it straight back on the same card.
- **The calendar controls and the day-off form are static HTML**; only their outputs repaint. Rebuilding a date input while someone types in it resets its segment caret.
- **Enter in the add-person form calls `requestSubmit()` explicitly.** Synthetic Enters (automation) carry keyCode 0 and never trigger implicit submission.

## Do not touch

- `js/neorgon-*.js` and `css/neorgon-*.css`: vendored kits, regenerated by `packages/neorgon-ui/sync-*.sh`.
- `data/holidays/`: generated. Change `tools/build-holidays.cjs` and rerun `make holidays`.
