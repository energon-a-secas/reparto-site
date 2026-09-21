.DEFAULT_GOAL := help

PORT = 8893

# ── Help ──────────────────────────────────────────────────────────────────────
.PHONY: help
help:
	@echo ""
	@echo "  make serve    Start dev server → http://localhost:$(PORT)"
	@echo "  make kill     Kill this project's HTTP server"
	@echo "  make test     Run the Node tests (capacity, calendar, flags)"
	@echo "  make holidays Regenerate data/holidays/ from date-holidays"
	@echo ""

# ── Dev server ────────────────────────────────────────────────────────────────
# scripts/serve.py is http.server plus Cache-Control: no-cache; a plain
# http.server sends only Last-Modified, so browsers keep stale ES modules after
# edits. Falls back to plain http.server outside the monorepo.
.PHONY: serve
serve:
	@echo "Serving → http://localhost:$(PORT)"
	@if [ -f ../../scripts/serve.py ]; then python3 ../../scripts/serve.py $(PORT); else python3 -m http.server $(PORT); fi

# ── Kill ──────────────────────────────────────────────────────────────────────
.PHONY: kill
kill:
	@lsof -ti :$(PORT) | xargs kill 2>/dev/null && echo "Stopped server on port $(PORT)" || echo "No server running on port $(PORT)"

# ── Tests ─────────────────────────────────────────────────────────────────────
.PHONY: test
test:
	node --test "test/*.test.mjs"

# ── Holiday data ──────────────────────────────────────────────────────────────
# The site ships its holidays as data/holidays/<CC>.json and never calls an API.
# This installs date-holidays outside the monorepo (npm inside it prunes the
# root node_modules) and rewrites the files. Rerun to extend the years.
HD_DIR ?= $(or $(TMPDIR),/tmp)/reparto-date-holidays
.PHONY: holidays
holidays:
	npm install --prefix "$(HD_DIR)" --no-audit --no-fund date-holidays@3
	NODE_PATH="$(HD_DIR)/node_modules" node tools/build-holidays.cjs
