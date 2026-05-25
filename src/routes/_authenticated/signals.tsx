import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Zap, RefreshCw, BookPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getQuotes, generateSignal, listSignals } from "@/lib/signals.functions";
import { logTrade } from "@/lib/trades.functions";
import { TradingViewChart } from "@/components/tradingview-chart";

export const Route = createFileRoute("/_authenticated/signals")({
  component: Signals,
  head: () => ({ meta: [{ title: "Signals — 5ers Challenge" }] }),
});

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "XAU/USD"];
const TFS = ["5min", "15min", "30min", "1h", "4h"];

function Signals() {
  const qFn = useServerFn(getQuotes);
  const gFn = useServerFn(generateSignal);
  const lFn = useServerFn(listSignals);
  const tFn = useServerFn(logTrade);
  const qc = useQueryClient();
  const [tf, setTf] = useState("15min");
  const [chartPair, setChartPair] = useState("XAU/USD");

  const quotes = useQuery({
    queryKey: ["quotes", tf],
    queryFn: () => qFn({ data: { interval: tf } }),
    refetchInterval: 60_000,
  });

  const signals = useQuery({
    queryKey: ["signals"],
    queryFn: () => lFn(),
    refetchInterval: 30_000,
  });

  const gen = useMutation({
    mutationFn: (pair: string) => gFn({ data: { pair, interval: tf } }),
    onSuccess: (r: any) => {
      if (r.skipped) toast.message("No clean setup", { description: r.reason });
      else toast.success(`${r.signal.direction.toUpperCase()} signal: ${r.signal.pair}`, { description: r.signal.rationale });
      qc.invalidateQueries({ queryKey: ["signals"] });
    },
    onError: (e: any) => toast.error("Signal failed", { description: e?.message }),
  });

  const logFromSignal = useMutation({
    mutationFn: (s: any) =>
      tFn({
        data: {
          pair: s.pair, direction: s.direction, entry: Number(s.entry),
          stop_loss: Number(s.stop_loss), take_profit: Number(s.take_profit_1),
          lot_size: Number(s.suggested_lot ?? 0.01), pnl_usd: 0, status: "open",
          notes: s.rationale, signal_id: s.id,
        },
      }),
    onSuccess: () => { toast.success("Trade logged as open"); qc.invalidateQueries({ queryKey: ["trades"] }); },
    onError: (e: any) => toast.error("Log failed", { description: e?.message }),
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Live signals</h1>
        <div className="flex items-center gap-2">
          <Select value={tf} onValueChange={setTf}>
            <SelectTrigger className="w-[120px] h-9"><SelectValue /></SelectTrigger>
            <SelectContent>{TFS.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => quotes.refetch()} disabled={quotes.isFetching}>
            <RefreshCw className={`size-4 mr-2 ${quotes.isFetching ? "animate-spin" : ""}`} /> Refresh
          </Button>
        </div>
      </div>

      {/* Pair scanner */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        {PAIRS.map((p) => {
          const q: any = quotes.data?.find((x: any) => x.pair === p);
          const bias = q?.setup?.bias;
          const biasColor = bias === "buy" ? "bg-bull/15 text-bull" : bias === "sell" ? "bg-bear/15 text-bear" : "bg-muted text-muted-foreground";
          return (
            <div key={p} className="rounded-xl border border-border bg-card p-3">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-sm">{p}</span>
                <button onClick={() => setChartPair(p)} className="text-[10px] text-muted-foreground hover:text-primary">chart</button>
              </div>
              <div className="text-lg font-bold">{q?.price ? Number(q.price).toFixed(p.includes("JPY") ? 3 : p.includes("XAU") ? 2 : 5) : "—"}</div>
              <div className="flex items-center justify-between mt-2">
                <span className={`text-[10px] px-2 py-0.5 rounded uppercase font-bold ${biasColor}`}>{bias ?? "no setup"}</span>
                <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => gen.mutate(p)} disabled={gen.isPending}>
                  <Zap className="size-3 mr-1" /> Gen
                </Button>
              </div>
              {q?.setup && (
                <div className="text-[10px] text-muted-foreground mt-1">RSI {q.setup.rsi.toFixed(0)} · {q.setup.trend}</div>
              )}
            </div>
          );
        })}
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">{chartPair}</h2>
            <Select value={chartPair} onValueChange={setChartPair}>
              <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{PAIRS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="h-[520px]"><TradingViewChart pair={chartPair} interval={tf.replace("min", "").replace("h", "60")} /></div>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Recent AI signals</h2>
          <div className="space-y-3 max-h-[520px] overflow-y-auto pr-1">
            {(signals.data ?? []).length === 0 && <p className="text-sm text-muted-foreground">No signals yet. Hit "Gen" on a pair.</p>}
            {(signals.data ?? []).map((s: any) => (
              <div key={s.id} className="rounded-lg border border-border bg-background/40 p-3">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-semibold text-sm">{s.pair} <span className="text-muted-foreground text-xs">· {s.timeframe}</span></span>
                  <span className={`text-xs font-bold ${s.direction === "buy" ? "text-bull" : "text-bear"}`}>{String(s.direction).toUpperCase()}</span>
                </div>
                <div className="text-xs grid grid-cols-3 gap-1 text-muted-foreground">
                  <div>Entry: <span className="text-foreground">{Number(s.entry).toFixed(5)}</span></div>
                  <div>SL: <span className="text-bear">{Number(s.stop_loss).toFixed(5)}</span></div>
                  <div>TP: <span className="text-bull">{Number(s.take_profit_1).toFixed(5)}</span></div>
                </div>
                <div className="text-xs text-muted-foreground mt-1">Lot {Number(s.suggested_lot ?? 0).toFixed(2)} · Conf {s.confidence}%</div>
                {s.rationale && <p className="text-xs mt-2 text-foreground/80">{s.rationale}</p>}
                <Button size="sm" variant="outline" className="w-full mt-2 h-7" onClick={() => logFromSignal.mutate(s)} disabled={logFromSignal.isPending}>
                  <BookPlus className="size-3 mr-1" /> Log as open trade
                </Button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
