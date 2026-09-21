<div align="center">

# Reparto

Drag people onto deliverables and see the capacity gaps

[![Live][badge-site]][url-site]
[![HTML5][badge-html]][url-html]
[![CSS3][badge-css]][url-css]
[![JavaScript][badge-js]][url-js]
[![Claude Code][badge-claude]][url-claude]
[![License][badge-license]](LICENSE)

[badge-site]:    https://img.shields.io/badge/live_site-0063e5?style=for-the-badge&logo=googlechrome&logoColor=white
[badge-html]:    https://img.shields.io/badge/HTML5-E34F26?style=for-the-badge&logo=html5&logoColor=white
[badge-css]:     https://img.shields.io/badge/CSS3-1572B6?style=for-the-badge&logo=css3&logoColor=white
[badge-js]:      https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[badge-claude]:  https://img.shields.io/badge/Claude_Code-CC785C?style=for-the-badge&logo=anthropic&logoColor=white
[badge-license]: https://img.shields.io/badge/license-MIT-404040?style=for-the-badge

[url-site]:   https://reparto.neorgon.com/
[url-html]:   #
[url-css]:    #
[url-js]:     #
[url-claude]: https://claude.ai/code

</div>

---

## Overview

Reparto turns a quarter into story points and splits them across the work. Set the
week (four focus days, one for meetings), the sprint and the plan length, and it
works out what one engineer can carry, rounded onto the same Fibonacci scale the
work is sized on: 8 points a sprint over 4 sprints is 32, planned as 34. Then drag
people onto deliverables and read the flags: what has no estimate, who is missing,
who is booked past their capacity, and how many engineers the gap is worth.

Public holidays, team days off and each person's vacations come out of the calendar
before any of that. A team can span several countries, and each person follows their
own: in the same week, 12 October costs the engineer in Chile a focus day and leaves
the one in Mexico alone.

**Live:** reparto.neorgon.com

---

## Features

- **The formula is the settings** -- weeks a sprint, working days, the meeting day toggle, points a focus day, a sprint cap, sprints in the plan (Quarter · 6 or Two months · 4), a buffer, and how capacity rounds (nearest Fibonacci, up, down or not at all), each an editable term in one visible chain
- **Real dates** -- sprints start on the date you pick (next quarter's first Monday by default), and the calendar folds to one summary line once it is set
- **Several countries, one team** -- the United States, Colombia, Chile, Peru, Argentina and Mexico are one tap each, any of 207 countries (2025 to 2030) is a pick away; each person follows their own country's holidays, anyone without one follows the team default, and a flag names who that is
- **Vacations** -- per-person periods; a day off only costs a focus day on a working day, and a week spent entirely away costs no meeting day either
- **Drag and drop** -- people from the roster onto deliverables, shares from one card to another, a share back to the roster to remove it; tap or Enter picks someone up for touch and keyboard, and the page scrolls when a drag nears the edge
- **Split anyone's time by percentage** -- a person can be 50% on one initiative, 20% on another and 30% on a third, and each deliverable can take as many people as it needs; shares are percentages of the person's capacity, so their points follow vacations, holidays and the sprint count, and one person's shares are rounded together so they always add up
- **Sensible shares** -- a drop gives what the person has free, up to what the deliverable still needs; click a share to set a percentage or exact points, cover the gap, or give all their free time; the pencil on a row shows and edits their whole split, with Split evenly
- **Fibonacci estimates** -- size a deliverable from the scale, or from engineers × sprints or focus days, rounded up to the next number on the scale
- **Flags that point somewhere** -- missing estimates, people with no country, deliverables nobody took, short or over-staffed work, over-booked people, open roles carrying work, a plan bigger than the team; each one jumps to its card, and several carry a one-step fix (add the person with the most room, size it, trim it, add open roles)
- **Totals in points and engineers** -- team capacity, demand, booked and missing, with every gap also expressed as engineers at one full plan each
- **Works on a phone** -- the page scrolls through the roster, a long press starts a drag, a tap carries someone to a card, and a sticky line above the board keeps the top flag and its fix in view
- **Undo, share, export** -- 40 levels of undo, a share link that carries the plan in its own URL fragment, Markdown for a doc or a Slack thread, JSON in and out
- **Nothing leaves the page** -- the plan lives in localStorage; holidays are static files on the same origin

---

## Running locally

ES modules require an HTTP server (not `file://`):

```bash
make serve    # http://localhost:8893
make test     # the arithmetic, the calendar and the flags, under Node
```

Regenerating the holiday files (once a year, or to extend the years) needs npm, and
installs `date-holidays` outside the repo:

```bash
make holidays
```

---

## Architecture

![Architecture](docs/architecture.svg)

```
reparto-site/
├── index.html            # HTML shell: formula, calendar, totals, roster, board, flags
├── css/
│   ├── style.css         # Fleet template kit plus the accent and status tokens
│   └── app.css           # The planner's layout
├── js/
│   ├── app.js            # Entry point: load, render, bind
│   ├── state.js          # The plan, validation (normalizeDoc), localStorage, undo
│   ├── capacity.js       # Fibonacci scale and rounding, per-person capacity, analyze()
│   ├── calendar.js       # Sprint dates, holidays, team days off, vacations, focus days
│   ├── holidays.js       # Loads data/holidays/<CC>.json on demand
│   ├── flags.js          # What is missing or wrong, with targets and fixes
│   ├── seed.js           # The example plan (6 people, 7 deliverables)
│   ├── render.js         # The formula and the totals; afterChange()
│   ├── render-calendar.js  # Start date, country, sprint dates, days off
│   ├── render-board.js   # Roster rows and deliverable cards
│   ├── render-flags.js   # The flags panel
│   ├── dnd.js            # Pointer drag, edge scroll, tap to carry
│   ├── actions.js        # Drops, carry, flag fixes, jump to a target
│   ├── popover.js        # Estimate picker and share editor
│   ├── person-editor.js  # Load, sprints away, country, vacations
│   ├── events.js         # Delegated clicks, changes, keys
│   ├── io.js             # Share link, Markdown, JSON
│   ├── modal.js          # Blocking dialogs
│   └── utils.js          # Small helpers
├── data/holidays/        # One JSON per country, plus index.json
├── tools/build-holidays.cjs  # Regenerates data/holidays/ (make holidays)
├── test/                 # node --test
├── docs/architecture.mmd # Diagram source
├── CNAME
├── Makefile
└── README.md
```

Public holiday data comes from [date-holidays](https://github.com/commenthol/date-holidays)
(code ISC, data CC BY 3.0), baked into static files so the site never calls a holiday API.

---

<div align="center">
<sub>Part of <a href="https://neorgon.com/">Neorgon</a></sub>
</div>
