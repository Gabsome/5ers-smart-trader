// Server-only trading-engine helpers: live price, performance learning, news.
import { pipValue } from "./indicators";

export function dollarPerPip(pair: string): number {
  return pair.includes("XAU") ? 10 : pair.includes("JPY") ? 9 : 10;
}

/** Latest traded price for a symbol via TwelveData. */
export async function fetchLatestPrice(symbol: string): Promise<number | null> {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error("TWELVEDATA_API_KEY is not configured");
  const url = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
  try {
    const res = await fetch(url);
    const json: any = await res.json();
    const p = parseFloat(json?.price);
    return Number.isFinite(p) ? p : null;
  } catch (e) {
    console.error("fetchLatestPrice failed", symbol, e);
    return null;
  }
}

// ---------- Performance / learning ----------
export type PairStat = {
  pair: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number; // 0-100
  netPnl: number;
  // Bayesian-smoothed win rate (pulls toward 50% with small samples)
  edge: number; // 0-100
};

export type PerformanceStats = {
  byPair: Record<string, PairStat>;
  overall: { trades: number; wins: number; winRate: number; netPnl: number };
};

export function summarizeTrades(rows: any[]): PerformanceStats {
  const byPair: Record<string, PairStat> = {};
  let oWins = 0, oTrades = 0, oNet = 0;
  const closed = rows.filter((t) => t.status === "win" || t.status === "loss");
  for (const t of closed) {
    const pair = t.pair as string;
    const s = (byPair[pair] ??= { pair, trades: 0, wins: 0, losses: 0, winRate: 0, netPnl: 0, edge: 50 });
    s.trades += 1;
    oTrades += 1;
    const pnl = Number(t.pnl_usd ?? 0);
    s.netPnl += pnl;
    oNet += pnl;
    if (t.status === "win") { s.wins += 1; oWins += 1; } else { s.losses += 1; }
  }
  // Bayesian smoothing: prior of 4 trades at 50%.
  const PRIOR = 4, PRIOR_RATE = 0.5;
  for (const s of Object.values(byPair)) {
    s.winRate = s.trades ? Math.round((s.wins / s.trades) * 100) : 0;
    s.edge = Math.round(((s.wins + PRIOR * PRIOR_RATE) / (s.trades + PRIOR)) * 100);
  }
  return {
    byPair,
    overall: {
      trades: oTrades,
      wins: oWins,
      winRate: oTrades ? Math.round((oWins / oTrades) * 100) : 0,
      netPnl: Math.round(oNet * 100) / 100,
    },
  };
}

// ---------- Economic-calendar news ----------
export type NewsEvent = {
  title: string;
  currency: string; // USD, EUR, GBP, JPY, AUD, CAD...
  impact: "High" | "Medium" | "Low";
  time: string; // ISO
  minutesAway: number; // signed: negative = already happened
};

const FF_FEED = "https://nfs.faireconomy.media/ff_calendar_thisweek.json";

/** Currencies whose news affects a given pair. Gold (XAU) is USD-driven. */
export function pairCurrencies(pair: string): string[] {
  if (pair.includes("XAU")) return ["USD"];
  const [a, b] = pair.replace("/", "").match(/.{1,3}/g) ?? [];
  return [a, b].filter(Boolean) as string[];
}

export async function fetchNewsEvents(): Promise<NewsEvent[]> {
  try {
    const res = await fetch(FF_FEED, { headers: { "User-Agent": "Mozilla/5.0" } });
    if (!res.ok) return [];
    const json: any[] = await res.json();
    const now = Date.now();
    return json
      .filter((e) => e?.date && e?.country && e?.impact)
      .map((e) => {
        const time = new Date(e.date).getTime();
        return {
          title: String(e.title ?? "Event"),
          currency: String(e.country).toUpperCase(),
          impact: (e.impact as NewsEvent["impact"]) ?? "Low",
          time: new Date(e.date).toISOString(),
          minutesAway: Math.round((time - now) / 60000),
        };
      });
  } catch (e) {
    console.error("fetchNewsEvents failed", e);
    return [];
  }
}

/**
 * Returns the blocking high-impact event for a pair if one falls within
 * ±windowMin of now, otherwise null.
 */
export function newsGuard(pair: string, events: NewsEvent[], windowMin: number): NewsEvent | null {
  const ccys = pairCurrencies(pair);
  const hit = events.find(
    (e) => e.impact === "High" && ccys.includes(e.currency) && Math.abs(e.minutesAway) <= windowMin,
  );
  return hit ?? null;
}

/** Resolve P&L when an open trade hits its TP or SL at the given price. */
export function resolveAtPrice(trade: {
  direction: string; entry: number; stop_loss: number | null; take_profit: number | null;
  lot_size: number; pair: string;
}, price: number): { status: "win" | "loss"; pnl: number } | null {
  const { direction, entry, stop_loss, take_profit, lot_size, pair } = trade;
  const pip = pipValue(pair);
  const dpp = dollarPerPip(pair);
  const buy = direction === "buy";
  const hitTp = take_profit != null && (buy ? price >= take_profit : price <= take_profit);
  const hitSl = stop_loss != null && (buy ? price <= stop_loss : price >= stop_loss);
  if (hitTp) {
    const pips = Math.abs(take_profit! - entry) / pip;
    return { status: "win", pnl: Math.round(pips * dpp * lot_size * 100) / 100 };
  }
  if (hitSl) {
    const pips = Math.abs(entry - stop_loss!) / pip;
    return { status: "loss", pnl: -Math.round(pips * dpp * lot_size * 100) / 100 };
  }
  return null;
}
