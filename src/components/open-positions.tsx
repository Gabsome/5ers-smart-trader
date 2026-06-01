import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { TrendingUp, TrendingDown, Trash2, RefreshCw, Check, X, Minus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { listTrades, updateTrade, deleteTrade } from "@/lib/trades.functions";
import { getQuotes } from "@/lib/signals.functions";
import { reconcileTrades } from "@/lib/engine.functions";
import { pipValue } from "@/lib/indicators";

const dpp = (pair: string) => (pair.includes("XAU") ? 10 : pair.includes("JPY") ? 9 : 10);
const dp = (pair: string) => (pair.includes("JPY") ? 3 : pair.includes("XAU") ? 2 : 5);

export function OpenPositions() {
  const lFn = useServerFn(listTrades);
  const qFn = useServerFn(getQuotes);
  const uFn = useServerFn(updateTrade);
  const dFn = useServerFn(deleteTrade);
  const rFn = useServerFn(reconcileTrades);
  const qc = useQueryClient();

  const trades = useQuery({ queryKey: ["trades"], queryFn: () => lFn(), refetchInterval: 20_000 });
  const open = useMemo(() => (trades.data ?? []).filter((t: any) => t.status === "open"), [trades.data]);
  const pairs = useMemo(() => Array.from(new Set(open.map((t: any) => t.pair))), [open]);

  const quotes = useQuery({
    queryKey: ["quotes", pairs],
    queryFn: () => qFn({ data: { pairs: pairs as string[] } }),
    enabled: pairs.length > 0,
    refetchInterval: 20_000,
  });
  const priceMap = useMemo(() => {
    const m: Record<string, number> = {};
    for (const q of (quotes.data ?? []) as any[]) if (q.price) m[q.pair] = q.price;
    return m;
  }, [quotes.data]);

  const floating = (t: any) => {
    const price = priceMap[t.pair];
    if (!price) return null;
    const pips = (t.direction === "buy" ? price - Number(t.entry) : Number(t.entry) - price) / pipValue(t.pair);
    return Math.round(pips * dpp(t.pair) * Number(t.lot_size) * 100) / 100;
  };

  const invalidate = () => { qc.invalidateQueries({ queryKey: ["trades"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };

  const close = useMutation({
    mutationFn: ({ id, status, pnl }: { id: string; status: "win" | "loss" | "breakeven"; pnl: number }) =>
      uFn({ data: { id, status, pnl_usd: pnl } }),
    onSuccess: () => { toast.success("Position closed"); invalidate(); },
    onError: (e: any) => toast.error("Failed", { description: e?.message }),
  });
  const del = useMutation({
    mutationFn: (id: string) => dFn({ data: { id } }),
    onSuccess: () => { toast.success("Deleted"); invalidate(); },
  });
  const reconcile = useMutation({
    mutationFn: () => rFn(),
    onSuccess: (r: any) => {
      if (r.closed) toast.success(`Auto-closed ${r.closed} trade(s) at TP/SL`);
      else toast.message("No positions hit TP/SL yet");
      invalidate();
    },
    onError: (e: any) => toast.error("Check failed", { description: e?.message }),
  });

  const markFromFloating = (t: any) => {
    const f = floating(t) ?? 0;
    close.mutate({ id: t.id, status: f > 0 ? "win" : f < 0 ? "loss" : "breakeven", pnl: f });
  };

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="font-semibold">Open positions</h2>
          <p className="text-xs text-muted-foreground">Live floating P&L · auto-closes at TP/SL</p>
        </div>
        <div className="flex items-center gap-2">
          {open.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => open.forEach((t: any) => close.mutate({ id: t.id, status: "breakeven", pnl: 0 }))}>
              Close all @ BE
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={() => reconcile.mutate()} disabled={reconcile.isPending}>
            <RefreshCw className={`size-4 mr-1.5 ${reconcile.isPending ? "animate-spin" : ""}`} /> Check TP/SL
          </Button>
        </div>
      </div>

      {open.length === 0 ? (
        <div className="py-8 text-center text-sm text-muted-foreground">No open positions. Log a trade or take the Daily Pick.</div>
      ) : (
        <div className="space-y-2">
          {open.map((t: any) => {
            const f = floating(t);
            const DirIcon = t.direction === "buy" ? TrendingUp : TrendingDown;
            return (
              <div key={t.id} className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2">
                <span className={`text-xs font-bold flex items-center gap-1 ${t.direction === "buy" ? "text-bull" : "text-bear"}`}>
                  <DirIcon className="size-3.5" /> {String(t.direction).toUpperCase()}
                </span>
                <span className="font-semibold">{t.pair}</span>
                <span className="text-xs text-muted-foreground font-mono">
                  @ {Number(t.entry).toFixed(dp(t.pair))} · {Number(t.lot_size).toFixed(2)} lot
                </span>
                <span className="text-xs text-muted-foreground font-mono hidden sm:inline">
                  {priceMap[t.pair] ? `now ${priceMap[t.pair].toFixed(dp(t.pair))}` : "…"}
                </span>
                <span className={`ml-auto text-sm font-bold tabular-nums ${f == null ? "text-muted-foreground" : f > 0 ? "text-bull" : f < 0 ? "text-bear" : ""}`}>
                  {f == null ? "—" : `${f >= 0 ? "+" : ""}$${f.toFixed(2)}`}
                </span>
                <div className="flex items-center gap-0.5">
                  <Button size="icon" variant="ghost" className="size-7 text-bull" title="Mark win" onClick={() => close.mutate({ id: t.id, status: "win", pnl: Math.max(0, f ?? 0) })}><Check className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-7 text-bear" title="Mark loss" onClick={() => close.mutate({ id: t.id, status: "loss", pnl: Math.min(0, f ?? 0) })}><X className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-7" title="Breakeven" onClick={() => close.mutate({ id: t.id, status: "breakeven", pnl: 0 })}><Minus className="size-4" /></Button>
                  <Button size="icon" variant="ghost" className="size-7 text-muted-foreground" title="Delete" onClick={() => del.mutate(t.id)}><Trash2 className="size-4" /></Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
