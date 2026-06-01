## Goal

Turn the dashboard into a live, self-updating trading cockpit: open trades auto-resolve as win/loss against live price (or you mark them manually), balance updates instantly, the pick engine learns from your past results and respects scheduled news, and everything refreshes in real time. Also clean up the 10 stale open trades.

## 1. Win/Loss tracking (manual + auto) with live balance

- **Manual close** (already partly exists in the journal): surface quick **Win / Loss / Breakeven** buttons on every open trade, both in the journal and on a new dashboard "Open positions" panel. Closing recalculates P&L from entry/SL/TP and lot size, then updates `current_balance` immediately.
- **Auto close**: a new server function `reconcileTrades` pulls the latest price for each open trade's pair (TwelveData), and:
  - if price crossed **TP** in the trade direction → mark `win`, P&L = +target,
  - if price crossed **SL** → mark `loss`, P&L = -risk,
  - sets `closed_at`, updates balance.
  P&L is computed with the existing pip-value math so the $100/$20 profile stays exact.
- Auto-reconcile runs two ways: (a) on the client via the dashboard's polling loop, and (b) optionally a `pg_cron` job hitting a public endpoint so trades close even when the app is closed.

## 2. Real-time auto-update

- Dashboard already polls every 15s; extend the same React Query polling to the new open-positions panel and journal, and trigger `reconcileTrades` inside the dashboard refetch so balance, P&L, win rate, and equity curve all move on their own.
- Enable Supabase Realtime on `trades` + `profiles` so a close from any device instantly invalidates the dashboard cache (no wait for the next poll).

## 3. AI that learns (from your results + adaptive scoring)

- New server function `getPerformanceStats`: aggregates your closed trades into per-pair and per-setup win rate, avg R, and sample size.
- The Daily Pick engine (`getDailyPick`) consumes these stats:
  - **Pick selection**: bias the final choice toward pairs/setups where you actually win (weighted by sample size so a 1-trade fluke doesn't dominate).
  - **Adaptive scoring**: nudge the quality-score thresholds up for pairs you lose on and down slightly for proven winners, while keeping the hard A+ floor.
- The pick's "Why this trade will work" list gains a line like *"Your edge: 71% win rate on XAU/USD pullbacks (14 trades)"* so the learning is visible and auditable.

## 4. News awareness / halt

- Pull a **free economic calendar** (Forex Factory weekly JSON feed — no API key required) in a new `getNews` server function, filtered to high-impact events for the currencies you trade (USD, EUR, GBP, JPY, AUD, CAD, XAU/gold).
- A news-guard helper checks: is a high-impact event within a configurable window (default ±30 min) for a candidate's currencies?
  - If yes, the engine **halts** that pair: the Daily Pick refuses it and shows *"⏸ Holding — high-impact USD news (NFP) in 18 min. Re-scan after the dust settles."*
  - A dashboard **News banner** lists today's upcoming high-impact events with a countdown, and flags when the engine is in "news halt" mode.
- If the free feed is unavailable, the engine degrades gracefully (warns rather than crashes) and you can still trade manually.

## 5. Clean up the 10 stale open trades

- Add a **"Review open trades"** view (dashboard panel + journal) listing all 10 with entry, current price, and floating P&L.
- Per-trade actions: mark Win/Loss/Breakeven, or **Delete** (for test rows). Bulk "Close all at breakeven" to reset quickly so balance and counts are accurate again.
- After cleanup the KPI cards (Open trades, Win rate, Total P&L) reflect reality.

## Technical notes

- **No schema change needed** for the core flow — `trades` already has `status`, `pnl_usd`, `closed_at`; `profiles` has `current_balance`. Optional: a small `news_window_minutes` / `news_guard_enabled` column on `profiles` for the configurable halt window (via migration, with GRANTs).
- New server functions in `src/lib/`: `reconcileTrades`, `getPerformanceStats`, `getNews` (all `requireSupabaseAuth`). News/cron-friendly variant under `src/routes/api/public/` for the optional `pg_cron` auto-close.
- Edits: `getDailyPick` in `signals.functions.ts` (consume stats + news guard), `dashboard.tsx` (open-positions panel + news banner + reconcile-on-refetch), `journal.tsx` (win/loss/delete actions), `daily-pick.tsx` (edge line + news-halt state).
- Live price for reconciliation reuses the existing TwelveData `fetchCandles`/quote path; mind the free-tier rate limit by batching pair lookups.
- All new UI uses existing semantic tokens (bull/bear/primary) — no new color literals.

## Out of scope (unless you ask)

- Broker auto-execution (still a manual/journal workflow).
- Paid news feeds with second-level precision.
