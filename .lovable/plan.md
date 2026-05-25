
# 5ers Challenge — by Gabsome-X

A smart dashboard to help you pass the 5ers $2,500 2-Step Challenge, hit a $20/day target, and continue tracking once funded. AI-assisted entry signals on majors + XAUUSD, live TradingView charts, a manual trade journal, and per-mode tracking (Challenge / Verification / Funded / Demo-Test).

## What you'll get

### 1. Landing + Google login
- Public landing page explaining the tool, branded "5ers Challenge — by Gabsome-X".
- Google sign-in (via Lovable Cloud auth).
- After login, redirect to `/dashboard`.

### 2. Account mode switcher
A persistent selector at the top of the app where you tell the AI what account you're trading:
- **Challenge (Step 1)** — $2,500, 8% target, 5% daily DD, 10% max DD.
- **Verification (Step 2)** — 5% target, same DD rules.
- **Funded (Live)** — conservative mode, tighter risk.
- **Demo / Testing** — AI is more experimental, no risk caps.

The selected mode is saved per user and feeds into the AI prompt + the risk-guard math.

### 3. Live TradingView charts
- Embedded TradingView Advanced Chart widget.
- Symbol switcher for EURUSD, GBPUSD, USDJPY, AUDUSD, USDCAD, XAUUSD.
- Free, no API key needed.

### 4. Real-time signal engine
Hybrid approach (your pick):
- **Indicator layer** — pulls 1m/5m/15m/1h candles from TwelveData for the 6 pairs, computes RSI, EMA(20/50), ATR, recent swing high/low, and detects setups (pullback to EMA, RSI divergence, breakout of structure).
- **AI layer** — Lovable AI (Gemini) receives the detected setup + recent price action + your current mode + remaining daily P&L room, and returns: direction, entry, SL, TP1/TP2, lot size suggestion for $2.5k, confidence %, and a one-line rationale.
- Auto-refresh every 60s; signals appear in a live feed with timestamps.

### 5. Trade journal (manual logging)
- Log each trade you took on 5ers: pair, direction, entry, SL, TP, lot, result (pips + $), screenshot URL, notes.
- Quick "log from signal" button pre-fills the form from any AI signal.
- Stored in Lovable Cloud.

### 6. Real-time tracking
Live KPIs computed from your journal:
- Today's P&L vs $20 daily goal (progress bar).
- Account balance & equity curve.
- Distance to 8% target (Step 1) or 5% (Step 2).
- Distance to daily DD limit and max DD — turns red when approaching.
- Win rate, avg R, profit factor, best/worst pair.
- Streaks (consecutive wins/losses) — AI gets more conservative after 2 losses.

### 7. Pair scanner
Always-on grid showing each watched pair with: current price, ATR, RSI, trend bias, "setup forming / active signal / no setup" badge.

## Technical details

**Stack**: TanStack Start (existing), Lovable Cloud (Postgres + Auth), Lovable AI Gateway (Gemini), TwelveData REST API, TradingView embedded widget, Recharts for equity curve, shadcn/ui + Tailwind.

**Cloud tables**:
- `profiles` (id, email, display_name, current_mode, starting_balance)
- `accounts` (id, user_id, mode, starting_balance, current_balance, started_at, is_active)
- `trades` (id, account_id, pair, direction, entry, sl, tp, lot, pips, pnl_usd, opened_at, closed_at, notes, signal_id nullable)
- `signals` (id, pair, timeframe, direction, entry, sl, tp1, tp2, confidence, rationale, mode_context, created_at)
- `settings` (user_id, risk_per_trade_pct, daily_goal_usd, watched_pairs[])

RLS: all tables scoped to `auth.uid()`.

**Server functions** (`createServerFn`):
- `getSignals` — runs indicator scan + AI synthesis, writes to `signals`.
- `logTrade`, `updateTrade`, `deleteTrade`.
- `getDashboardStats` — aggregates today's P&L, equity curve, DD distances.
- `getQuote(symbol, interval)` — proxies TwelveData (keeps key server-side).

**Secrets needed**: `TWELVEDATA_API_KEY` (you'll provide after enabling Cloud).

**Routes**:
- `/` — landing
- `/login` — Google sign-in
- `/dashboard` — overview (KPIs, equity curve, today's signals)
- `/signals` — live signal feed + chart
- `/journal` — trade log + add/edit
- `/settings` — mode, starting balance, risk %, watched pairs

## Important honesty note

This site **does not place trades on your 5ers MT5 account** — brokers don't allow that from a website. It gives you AI signals + risk math, you click the trade in 5ers, then log the result here so tracking stays real-time. The $20/day target is a planning aid, not a guarantee — markets don't promise profits.

## Build order

1. Enable Lovable Cloud + create DB schema + Google auth.
2. Landing page + login flow + branded shell.
3. Settings + account mode switcher.
4. TwelveData proxy + indicator engine + AI signal synthesis.
5. Dashboard KPIs + equity curve + TradingView chart.
6. Trade journal CRUD.
7. Signal feed + pair scanner.
8. Polish, dark theme, mobile layout.
