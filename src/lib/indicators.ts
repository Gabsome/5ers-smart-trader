// Indicator helpers — pure functions
export type Candle = { t: number; o: number; h: number; l: number; c: number };

export function ema(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  const avgG = gains / period, avgL = losses / period;
  if (avgL === 0) return 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

export function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    trs.push(Math.max(c.h - c.l, Math.abs(c.h - p.c), Math.abs(c.l - p.c)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

export function detectSetup(candles: Candle[]) {
  if (candles.length < 60) return null;
  const closes = candles.map((c) => c.c);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  const r = rsi(closes, 14);
  const a = atr(candles, 14);
  const last = candles[candles.length - 1];
  const trend = ema20.at(-1)! > ema50.at(-1)! ? "up" : "down";
  const distToEma = Math.abs(last.c - ema20.at(-1)!);
  const pullback = distToEma < a * 0.6;

  // Recent market structure — used to anchor a safe stop-loss beyond swing points.
  const lookback = candles.slice(-20);
  const swingHigh = Math.max(...lookback.map((c) => c.h));
  const swingLow = Math.min(...lookback.map((c) => c.l));

  let bias: "buy" | "sell" | null = null;
  if (trend === "up" && pullback && r > 40 && r < 65) bias = "buy";
  if (trend === "down" && pullback && r < 60 && r > 35) bias = "sell";

  return {
    trend,
    rsi: r,
    atr: a,
    ema20: ema20.at(-1)!,
    ema50: ema50.at(-1)!,
    lastClose: last.c,
    swingHigh,
    swingLow,
    bias,
  };
}

export function pipValue(pair: string): number {
  return pair.includes("JPY") ? 0.01 : pair.includes("XAU") ? 0.1 : 0.0001;
}

export function suggestLot(pair: string, slPips: number, accountBalance: number, riskPct: number) {
  // Approximation: $ per pip per 1.0 lot
  const dollarPerPipPerLot = pair.includes("XAU") ? 10 : pair.includes("JPY") ? 9 : 10;
  const riskUsd = (accountBalance * riskPct) / 100;
  if (slPips <= 0) return 0.01;
  const lot = riskUsd / (slPips * dollarPerPipPerLot);
  return Math.max(0.01, Math.round(lot * 100) / 100);
}
