import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { motion, AnimatePresence } from "motion/react";
import { Crosshair, Zap, BookPlus, TrendingUp, TrendingDown } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getDailyPick } from "@/lib/signals.functions";
import { logTrade } from "@/lib/trades.functions";

export function DailyPick() {
  const fn = useServerFn(getDailyPick);
  const tFn = useServerFn(logTrade);
  const qc = useQueryClient();
  const [data, setData] = useState<any>(null);

  const gen = useMutation({
    mutationFn: () => fn({ data: { interval: "15min", riskUsd: 100, targetUsd: 20 } }),
    onSuccess: (r: any) => {
      setData(r);
      if (!r.pick) toast.message("No pick", { description: r.reason });
      else toast.success(`Daily pick: ${r.pick.pair} ${r.pick.direction.toUpperCase()}`);
    },
    onError: (e: any) => toast.error("Pick failed", { description: e?.message }),
  });

  const log = useMutation({
    mutationFn: () => tFn({
      data: {
        pair: data.pick.pair, direction: data.pick.direction, entry: Number(data.pick.entry),
        stop_loss: Number(data.pick.stop_loss), take_profit: Number(data.pick.take_profit),
        lot_size: Number(data.pick.lot_size), pnl_usd: 0, status: "open",
        notes: data.pick.rationale,
      },
    }),
    onSuccess: () => { toast.success("Logged as open trade"); qc.invalidateQueries({ queryKey: ["trades"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); },
    onError: (e: any) => toast.error("Log failed", { description: e?.message }),
  });

  const p = data?.pick;
  const dirColor = p?.direction === "buy" ? "text-bull" : "text-bear";
  const DirIcon = p?.direction === "buy" ? TrendingUp : TrendingDown;

  return (
    <div className="rounded-xl border border-primary/40 bg-gradient-to-br from-card to-primary/5 p-5 relative overflow-hidden">
      <motion.div
        className="absolute -top-12 -right-12 size-32 rounded-full bg-primary/10 blur-2xl"
        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.8, 0.5] }}
        transition={{ duration: 4, repeat: Infinity }}
      />
      <div className="flex items-center justify-between mb-4 relative">
        <div className="flex items-center gap-2">
          <span className="size-8 grid place-items-center rounded-md bg-primary text-primary-foreground">
            <Crosshair className="size-4" />
          </span>
          <div>
            <h2 className="font-bold">Daily Pick</h2>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">$100 SL · $20 TP · 1–2 trades/day</p>
          </div>
        </div>
        <Button size="sm" onClick={() => gen.mutate()} disabled={gen.isPending}>
          <Zap className={`size-4 mr-1.5 ${gen.isPending ? "animate-pulse" : ""}`} />
          {gen.isPending ? "Scanning…" : p ? "Re-scan" : "Find best trade"}
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {!p && !gen.isPending && (
          <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="py-8 text-center text-sm text-muted-foreground">
            Tap <strong className="text-foreground">Find best trade</strong> and the AI will pick the single highest-probability setup across all your watched pairs, sized to risk exactly $100 for $20 profit.
          </motion.div>
        )}

        {gen.isPending && (
          <motion.div key="loading" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="py-10 flex flex-col items-center gap-3">
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map((i) => (
                <motion.span key={i} className="w-1 h-6 bg-primary rounded-full"
                  animate={{ scaleY: [1, 2, 1] }}
                  transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.1 }} />
              ))}
            </div>
            <p className="text-xs text-muted-foreground">Scanning {data?.candidates ?? 6} pairs…</p>
          </motion.div>
        )}

        {p && !gen.isPending && (
          <motion.div key="pick" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
            className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-3xl font-bold flex items-center gap-2">
                  {p.pair}
                  <span className={`text-base font-bold ${dirColor} flex items-center gap-1`}>
                    <DirIcon className="size-4" /> {p.direction.toUpperCase()}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5">
                  {p.timeframe} · trend {p.trend} · RSI {p.rsi.toFixed(0)}
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground">Confidence</div>
                <div className="text-2xl font-bold text-primary">{p.confidence}%</div>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <Cell label="Entry" value={Number(p.entry).toFixed(p.pair.includes("JPY") ? 3 : p.pair.includes("XAU") ? 2 : 5)} />
              <Cell label={`SL (-$${p.risk_usd})`} value={Number(p.stop_loss).toFixed(p.pair.includes("JPY") ? 3 : p.pair.includes("XAU") ? 2 : 5)} accent="bear" />
              <Cell label={`TP (+$${p.target_usd})`} value={Number(p.take_profit).toFixed(p.pair.includes("JPY") ? 3 : p.pair.includes("XAU") ? 2 : 5)} accent="bull" />
              <Cell label="Lot size" value={p.lot_size.toFixed(2)} accent="gold" />
            </div>

            <div className="text-xs text-muted-foreground grid grid-cols-2 gap-2">
              <div>SL distance: <span className="text-foreground">{p.sl_pips} pips</span></div>
              <div>TP distance: <span className="text-foreground">{p.tp_pips} pips</span></div>
            </div>

            <p className="text-sm text-foreground/85 italic border-l-2 border-primary/60 pl-3">"{p.rationale}"</p>

            {Array.isArray(p.factors) && p.factors.length > 0 && (
              <div className="rounded-md border border-border/60 bg-background/40 p-3 space-y-1.5">
                <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">Why this trade will work</div>
                <ul className="space-y-1">
                  {p.factors.map((f: string, i: number) => (
                    <li key={i} className="text-xs text-foreground/85 flex gap-2">
                      <span className="text-primary mt-0.5">▸</span><span>{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <p className="text-[10px] text-muted-foreground text-center italic">
              Educational use only · Not financial advice · © Gabriel Maina Mwangi, Nakuru
            </p>

            <Button variant="outline" className="w-full" onClick={() => log.mutate()} disabled={log.isPending}>
              <BookPlus className="size-4 mr-2" /> Log as open trade
            </Button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Cell({ label, value, accent }: { label: string; value: string; accent?: "bull" | "bear" | "gold" }) {
  const color = accent === "bull" ? "text-bull" : accent === "bear" ? "text-bear" : accent === "gold" ? "text-primary" : "text-foreground";
  return (
    <div className="rounded-md bg-background/60 border border-border px-2 py-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-sm font-bold ${color} font-mono`}>{value}</div>
    </div>
  );
}
