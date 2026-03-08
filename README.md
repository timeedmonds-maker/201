# NBA live on/off impact - parser-first zero-install Vercel build

This version keeps the zero-install Vercel deployment model, but upgrades the reconciliation engine to be more explicitly state-based and auditable.

## What changed in this patch

The parser now treats the problem as **state reconstruction**, not row counting.

It now includes:
- normalized event objects
- same-clock event clustering
- atomic same-team substitution batches
- continuous lineup state tracking
- raw lineup windows
- resolved lineup windows
- canonical possession ledger
- possession score attribution from **score deltas at open/close**
- impossible-possession detection
- narrow box-score-based reconciliation for the **live open stint only**
- expanded debug surfaces

## Core model

The engine is built in this order:
1. normalize live play-by-play rows into structured events
2. group same-clock rows into one cluster
3. process substitutions atomically by team and clock
4. maintain lineup state continuously
5. build lineup windows from structural boundaries
6. build canonical possessions from control state
7. attribute points from possession score deltas
8. aggregate player ON/OFF from counted possessions and resolved windows
9. validate against box-score minutes, live on-court state, and player plus/minus

## Trust model

The response includes a validation summary and marks the game as:
- `trusted`
- `warning`
- `untrusted`

A game is pushed toward `untrusted` if it has things like:
- invalid lineup states
- impossible possession score deltas
- unreasonable possession-balance drift
- broad player plus/minus mismatches
- large minute deltas

## Box score layering

The box score is used narrowly and audibly:
- starters bootstrap the opening lineup when present
- live `oncourt` flags can patch the **current open stint** only
- official player minutes and plus/minus are used for validation

This patch does **not** use the box score as a totals-adjustment hack.
It keeps the live box score overlay narrow, rule-based, and logged under `reconciliationActions`.

## Debug surfaces exposed

The game response now includes:
- `normalizedEvents`
- `clusters`
- `subBatches`
- `rawLineupWindows`
- `resolvedLineupWindows`
- `possessions`
- `reconciliationActions`
- `validation`
- `minuteAudit`
- `plusMinusAudit`
- `warnings`

## Deploy to Vercel

1. Create a fresh GitHub repo.
2. Extract the contents of this zip directly into the repo root.
3. Push to GitHub.
4. Import that repo into Vercel.

There is no `package.json`, so Vercel should deploy it as a static site with API functions and skip `npm install` entirely.

## How to use

- Open the app.
- The dropdown loads the **current NBA slate** from `todaysScoreboard_00.json`.
- If `ORL @ MIN` is on the current slate, it will be preselected automatically.
- Otherwise enter the 10-digit NBA game ID manually.
- Click **Load game**.

## Important note on dates / timezone

The NBA "current slate" can differ from New Zealand local calendar dates.
A game that was on **Sunday, March 8, 2026 in New Zealand** can still belong to the NBA's **Saturday, March 7, 2026 U.S. slate**.

So if you are testing a game that happened "today" in NZ and it is not in the current dropdown anymore, that does not necessarily mean the parser failed — it may have rolled off the live slate feed.

## Files

- `index.html` – app shell
- `styles.css` – styling
- `app.js` – client-side UI
- `api/scoreboard.js` – current slate fetch
- `api/game.js` – game fetch + reconciliation
- `api/_lib/reconcile.js` – parser-first state engine
- `api/_lib/store.js` – in-memory snapshot journal for live open-stint patching
