import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getProfile, updateProfile, getDashboard } from "@/lib/trades.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: Settings,
  head: () => ({ meta: [{ title: "Settings — 7star Challenge" }] }),
});

function Settings() {
  const gFn = useServerFn(getProfile);
  const uFn = useServerFn(updateProfile);
  const qc = useQueryClient();
  const { data: profile } = useQuery({ queryKey: ["profile"], queryFn: () => gFn() });

  const [form, setForm] = useState({ starting_balance: "2500", daily_goal_usd: "20", profit_target_usd: "200", risk_per_trade_pct: "0.5", display_name: "" });
  useEffect(() => {
    if (profile) setForm({
      starting_balance: String(profile.starting_balance),
      daily_goal_usd: String(profile.daily_goal_usd),
      profit_target_usd: String((profile as any).profit_target_usd ?? 200),
      risk_per_trade_pct: String(profile.risk_per_trade_pct),
      display_name: profile.display_name ?? "",
    });
  }, [profile]);

  const save = useMutation({
    mutationFn: () => uFn({
      data: {
        starting_balance: Number(form.starting_balance),
        daily_goal_usd: Number(form.daily_goal_usd),
        profit_target_usd: Number(form.profit_target_usd),
        risk_per_trade_pct: Number(form.risk_per_trade_pct),
        display_name: form.display_name,
      },
    }),
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
          <Field label="Current balance ($)"><Input type="number" value={Number(profile?.current_balance ?? 0).toFixed(2)} disabled /></Field>
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
          Your <strong className="text-foreground">Current balance</strong> is calculated automatically as your starting balance plus the realized profit/loss of your closed trades, so it always matches the dashboard balance and equity curve. To correct a value (e.g. you used a different lot size), edit that trade in the <strong className="text-foreground">Journal</strong> — the dashboard updates in real time.
        </p>
        <p className="mt-3">
          This dashboard does <strong className="text-foreground">not</strong> place trades on your broker — log entries here after you execute them on the broker so tracking stays accurate.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="text-xs mb-1 block">{label}</Label>{children}</div>;
}
