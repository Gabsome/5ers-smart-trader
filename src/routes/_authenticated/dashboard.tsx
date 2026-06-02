import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { LineChart, Line, ResponsiveContainer, XAxis, YAxis, Tooltip } from "recharts";
import { Target, TrendingUp, TrendingDown, AlertTriangle, DollarSign } from "lucide-react";
import { getDashboard } from "@/lib/trades.functions";
import { reconcileTrades } from "@/lib/engine.functions";
import { supabase } from "@/integrations/supabase/client";
import { TradingViewChart } from "@/components/tradingview-chart";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DailyPick } from "@/components/daily-pick";
import { OpenPositions } from "@/components/open-positions";
import { NewsBanner } from "@/components/news-banner";
import { LoadingScreen } from "@/components/loading-screen";


export const Route = createFileRoute("/_authenticated/dashboard")({
  component: Dashboard,
  head: () => ({ meta: [{ title: "Dashboard — 5ers Challenge" }] }),
});

const PAIRS = ["EUR/USD", "GBP/USD", "USD/JPY", "AUD/USD", "USD/CAD", "XAU/USD"];

function Dashboard() {
  const fn = useServerFn(getDashboard);
  const reconcile = useServerFn(reconcileTrades);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard"],
    queryFn: async () => {
      try { await reconcile(); } catch { /* non-blocking */ }
      return fn();
    },
    refetchInterval: 15_000,
  });
  const [pair, setPair] = useState("XAU/USD");

  // Realtime: refresh instantly when trades or balance change anywhere.
  useEffect(() => {
    const ch = supabase
      .channel("dashboard-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "trades" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
        qc.invalidateQueries({ queryKey: ["trades"] });
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles" }, () => {
        qc.invalidateQueries({ queryKey: ["dashboard"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [qc]);

  if (isLoading || !data) return <LoadingScreen label="Loading your dashboard…" />;


  const goalColor = data.todayPnl >= data.dailyGoal ? "text-bull" : data.todayPnl >= 0 ? "text-foreground" : "text-bear";
  const ddPct = (data.drawdown.todayDd / data.drawdown.dailyLimit) * 100;
  const ddDanger = ddPct > 70;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard icon={<DollarSign />} label="Balance" value={`$${data.currentBalance.toFixed(2)}`} sub={`Start $${data.startingBalance}`} />
        <KpiCard icon={<Target />} label="Today P&L" value={<span className={goalColor}>{data.todayPnl >= 0 ? "+" : ""}${data.todayPnl.toFixed(2)}</span>} sub={`Goal $${data.dailyGoal} · ${data.dailyGoalPct.toFixed(0)}%`} progress={data.dailyGoalPct} />
        <KpiCard icon={<TrendingUp />} label={`Profit target (${data.target.pct.toFixed(0)}%)`} value={`$${data.target.achieved.toFixed(0)} / $${data.target.usd.toFixed(0)}`} sub={`${Math.max(0, data.target.progress).toFixed(0)}% there`} progress={Math.max(0, Math.min(100, data.target.progress))} />
        <KpiCard icon={ddDanger ? <AlertTriangle /> : <TrendingDown />} label="Daily DD used" value={`$${data.drawdown.todayDd.toFixed(2)}`} sub={`Limit $${data.drawdown.dailyLimit.toFixed(0)}`} progress={Math.min(100, ddPct)} danger={ddDanger} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <SmallStat label="Win rate" value={`${data.winRate.toFixed(0)}%`} />
        <SmallStat label="Closed trades" value={String(data.tradesCount)} />
        <SmallStat label="Open trades" value={String(data.openTrades)} />
        <SmallStat label="Total P&L" value={`${data.totalPnl >= 0 ? "+" : ""}$${data.totalPnl.toFixed(2)}`} accent={data.totalPnl >= 0 ? "bull" : "bear"} />
      </div>

      <NewsBanner pairs={PAIRS} />

      <DailyPick />

      <OpenPositions />


      <div className="grid lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Live chart</h2>
            <Select value={pair} onValueChange={setPair}>
              <SelectTrigger className="w-[140px] h-8"><SelectValue /></SelectTrigger>
              <SelectContent>{PAIRS.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="h-[480px]"><TradingViewChart pair={pair} /></div>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-semibold mb-4">Equity curve</h2>
          <div className="h-[480px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.equity.map((e) => ({ t: new Date(e.t).toLocaleDateString(), v: Number(e.v) }))}>
                <XAxis dataKey="t" stroke="var(--muted-foreground)" fontSize={10} />
                <YAxis stroke="var(--muted-foreground)" fontSize={10} domain={["auto", "auto"]} />
                <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8 }} />
                <Line type="monotone" dataKey="v" stroke="var(--primary)" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

function KpiCard({ icon, label, value, sub, progress, danger }: { icon: React.ReactNode; label: string; value: React.ReactNode; sub?: string; progress?: number; danger?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground mb-2">
        <span className={`size-7 grid place-items-center rounded-md ${danger ? "bg-bear/15 text-bear" : "bg-primary/10 text-primary"}`}>{icon}</span>
        {label}
      </div>
      <div className="text-2xl font-bold">{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-1">{sub}</div>}
      {progress !== undefined && (
        <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden">
          <div className={`h-full ${danger ? "bg-bear" : "bg-primary"}`} style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>
      )}
    </div>
  );
}

function SmallStat({ label, value, accent }: { label: string; value: string; accent?: "bull" | "bear" }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold mt-1 ${accent === "bull" ? "text-bull" : accent === "bear" ? "text-bear" : ""}`}>{value}</div>
    </div>
  );
}
