import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { getProfile, updateProfile, getDashboard } from "@/lib/trades.functions";
import { getAmySettings, updateAmySettings } from "@/lib/amy.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Settings — 7star Challenge" }] }),
});

function Settings() {
  const gFn = useServerFn(getProfile);
  const uFn = useServerFn(updateProfile);
  const dFn = useServerFn(getDashboard);
  const qc = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => gFn() });
  const { data: dash } = useQuery({ queryKey: ["dashboard"], queryFn: () => dFn(), refetchInterval: 15_000 });


  const [form, setForm] = useState({ starting_balance: "2500", current_balance: "2500", daily_goal_usd: "20", profit_target_usd: "200", risk_per_trade_pct: "0.5", display_name: "" });
  useEffect(() => {
    if (profile) setForm((f) => ({
      ...f,
      starting_balance: String(profile.starting_balance),
      current_balance: f.current_balance === "2500" ? String((dash?.currentBalance ?? profile.current_balance ?? 0)) : f.current_balance,
      daily_goal_usd: String(profile.daily_goal_usd),
      profit_target_usd: String((profile as any).profit_target_usd ?? 200),
      risk_per_trade_pct: String(profile.risk_per_trade_pct),
      display_name: profile.display_name ?? "",
    }));
  }, [profile, dash]);

  const save = useMutation({
    mutationFn: () => {
      // Realized P&L from closed trades (dashboard is the source of truth).
      const realized = Number(dash?.totalPnl ?? 0);
      const desiredBalance = Number(form.current_balance);
      // Keep the dashboard, equity curve and balance in agreement: the dashboard
      // computes currentBalance = starting_balance + realized P&L, so we derive
      // the starting balance needed to land on the balance the user typed.
      const startingBalance = Number.isFinite(desiredBalance)
        ? desiredBalance - realized
        : Number(form.starting_balance);
      return uFn({
        data: {
          starting_balance: startingBalance,
          current_balance: desiredBalance,
          daily_goal_usd: Number(form.daily_goal_usd),
          profit_target_usd: Number(form.profit_target_usd),
          risk_per_trade_pct: Number(form.risk_per_trade_pct),
          display_name: form.display_name,
        },
      });
    },
    onSuccess: () => {
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["profile"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      qc.invalidateQueries({ queryKey: ["trades"] });
    },
    onError: (e: any) => toast.error("Save failed", { description: e?.message }),
  });

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-bold">Settings</h1>

      <div className="rounded-xl border border-border bg-card p-6 space-y-4">
        <h2 className="font-semibold">Account</h2>
        <div className="grid grid-cols-2 gap-4">
          <Field label="Display name"><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></Field>
          <Field label="Current mode"><Input value={profile?.current_mode ?? ""} disabled /></Field>
          <Field label="Starting balance ($)"><Input type="number" value={form.starting_balance} onChange={(e) => setForm({ ...form, starting_balance: e.target.value })} /></Field>
          <Field label="Current balance ($)"><Input type="number" value={form.current_balance} onChange={(e) => setForm({ ...form, current_balance: e.target.value })} /></Field>
          <Field label="Daily goal ($)"><Input type="number" value={form.daily_goal_usd} onChange={(e) => setForm({ ...form, daily_goal_usd: e.target.value })} /></Field>
          <Field label="Profit target ($)"><Input type="number" value={form.profit_target_usd} onChange={(e) => setForm({ ...form, profit_target_usd: e.target.value })} /></Field>
          <Field label="Risk per trade (%)"><Input type="number" step="0.1" value={form.risk_per_trade_pct} onChange={(e) => setForm({ ...form, risk_per_trade_pct: e.target.value })} /></Field>
        </div>
        <Button onClick={() => save.mutate()} disabled={save.isPending}>Save changes</Button>
      </div>

      <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
        <h2 className="font-semibold text-foreground mb-2">How it works</h2>
        <p>
          The mode switcher (top-right) tells the AI whether you're on a Challenge, Verification, Funded, or Demo account.
          On Challenge/Verification, signals are filtered conservatively to respect 5%/10% drawdown rules.
          On Funded mode, lot suggestions get even tighter. Demo mode lets the AI be more experimental.
        </p>
        <p className="mt-3">
          Set your <strong className="text-foreground">Profit target ($)</strong> to the amount you want to reach — the
          dashboard target card auto-tracks your balance growth toward it. See the <strong className="text-foreground">Guide</strong> tab for the full how-to and required documents.
        </p>
        <p className="mt-3">
          You can set your <strong className="text-foreground">Current balance</strong> directly here — when you save, the whole dashboard, the profit target and the equity curve adjust to agree with it instantly. Your closed-trade profit/loss is preserved, so future trades keep updating the balance correctly. You can also fine-tune an individual trade in the <strong className="text-foreground">Journal</strong> if a specific entry was off.
        </p>
        <p className="mt-3">
          This dashboard does <strong className="text-foreground">not</strong> place trades on your broker — log entries here after you execute them on the broker so tracking stays accurate.
        </p>
      </div>

      <AmySettings />
    </div>
  );
}

const PERSONALITIES = [
  { value: "fun", label: "Fun & playful" },
  { value: "chill", label: "Chill & easy-going" },
  { value: "professional", label: "Professional" },
  { value: "hype", label: "Hype cheerleader" },
] as const;

function AmySettings() {
  const gFn = useServerFn(getAmySettings);
  const uFn = useServerFn(updateAmySettings);
  const qc = useQueryClient();
  const { data: amy } = useQuery({ queryKey: ["amy-settings"], queryFn: () => gFn() });

  const [form, setForm] = useState({ amy_personality: "fun", amy_humor_level: 7, amy_context_trades: true });
  useEffect(() => {
    if (amy) setForm({
      amy_personality: amy.amy_personality ?? "fun",
      amy_humor_level: amy.amy_humor_level ?? 7,
      amy_context_trades: amy.amy_context_trades ?? true,
    });
  }, [amy]);

  const save = useMutation({
    mutationFn: () => uFn({ data: {
      amy_personality: form.amy_personality as "fun" | "chill" | "professional" | "hype",
      amy_humor_level: Number(form.amy_humor_level),
      amy_context_trades: form.amy_context_trades,
    } }),
    onSuccess: () => {
      toast.success("Amy settings saved");
      qc.invalidateQueries({ queryKey: ["amy-settings"] });
    },
    onError: (e: any) => toast.error("Save failed", { description: e?.message }),
  });

  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-4">
      <div>
        <h2 className="font-semibold flex items-center gap-2">👩🏽 Amy — your assistant</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Amy always knows the date, day and time, remembers your chats to match your style, and can talk through your trades and scanned signals.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Personality">
          <select
            value={form.amy_personality}
            onChange={(e) => setForm({ ...form, amy_personality: e.target.value })}
            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          >
            {PERSONALITIES.map((p) => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>
        </Field>
        <Field label={`Humor level: ${form.amy_humor_level}/10`}>
          <input
            type="range" min={0} max={10} step={1}
            value={form.amy_humor_level}
            onChange={(e) => setForm({ ...form, amy_humor_level: Number(e.target.value) })}
            className="w-full accent-primary mt-3"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <div className="text-sm font-medium">Let Amy see my trades & signals</div>
          <div className="text-xs text-muted-foreground">She can answer questions about your open positions and scanned setups.</div>
        </div>
        <Switch
          checked={form.amy_context_trades}
          onCheckedChange={(v) => setForm({ ...form, amy_context_trades: v })}
        />
      </div>

      <Button onClick={() => save.mutate()} disabled={save.isPending}>Save Amy settings</Button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs mb-1 block">{label}</Label>{children}</div>;
}
