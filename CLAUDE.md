# CLAUDE.md: Reparto

Sprint capacity planner: turn a quarter into story points per engineer (focus days,
meeting day, sprint cap, holidays, vacations, Fibonacci rounding), drag people onto
deliverables, and read flags for missing estimates, missing people and over-booking.
For an engineering manager the week before quarter planning.

**Live:** reparto.neorgon.com · **Port:** 8893

## Run

```bash
make serve     # http://localhost:8893 (ES modules: file:// will not load them)
make test      # node --test: arithmetic, calendar, flags
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
| `js/events.js`, `js/io.js`, `js/modal.js`, `js/seed.js`, `js/utils.js` | wiring, share link / Markdown / JSON, dialogs, the example plan, helpers |

Vendored from `packages/neorgon-ui/`, never edit in place: `js/neorgon-{header,footer,beacon}.js`, `css/neorgon-*.css`.

## Data

- `localStorage['reparto-v1']` holds `{ v, doc, savedAt }`. `doc` is `{ title, settings, daysOff, people, deliverables }`; a share is `deliverables[].members[] = { person, points }`.
- `settings.countries` is the team's list of ISO codes, the default first; `people[].country` overrides it per person. A plan saved with the older single `settings.country` migrates in `normalizeDoc`.
- A share link is `#p=` + base64url(JSON of `doc`). The fragment never reaches a server; `loadFromHash()` swaps it in through `resetTo()`, so the visitor's own plan is one undo away, then clears the hash.
- `data/holidays/<CC>.json` is `{ country, name, source, years: { 2026: [[iso, englishName, localName?], ...] } }`, public nationwide holidays only, 2025 to 2030. `index.json` lists the countries.

## Gotchas

- **Never call a holiday API.** Nager.Date's robots.txt disallows `/api/v`, which is why the data is baked. `tools/build-holidays.cjs` generates it from the `date-holidays` package; `make holidays` installs that package under `$TMPDIR` because `npm install` inside a workspace member prunes the monorepo root's `node_modules`. Past 2030 the files return nothing: extend `YEARS` and rerun.
- **Pass `cal` to every `analyze()`.** The default is `NO_CAL`, so a call that forgets it quietly plans with no holidays. Grep `analyze(` when adding one.
- **Holidays are per person, never the union of the team's countries.** `daysOffFor()` takes the person's own country, else `settings.countries[0]`. Unioning them would take US Thanksgiving off a Chilean engineer. With two or more countries, anyone without one raises a flag instead of being guessed silently.
- **The Plan menu must close only itself.** The header kit's `⋯` overflow panel is also a `.header-menu`; the floorplan pattern of closing every `.header-menu.open` shut the panel the moment a menu inside it opened, and a dropdown nested in that panel is clipped by its scroll box anyway. So there is one menu, `data-keep-mobile` on its wrapper, and Undo/Redo are what fold away.
- **Touch drags on a long press.** Rows and chips are `touch-action: pan-y` so a swipe scrolls the page; `dnd.js` starts a touch drag after 250ms still, then cancels `touchmove` (a non-passive listener) so the page holds. `touch-action: none` made the roster a dead zone for scrolling.
- **Rounding is per person and the jumps are big.** Nearest Fibonacci turns 27 into 21 and 28 into 34, so one vacation week can drop someone 13 points. That is the model the brief asked for (32 -> 34); raw and planned are always shown side by side. Tests pin the boundary.
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
