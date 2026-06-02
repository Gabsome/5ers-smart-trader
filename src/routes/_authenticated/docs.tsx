import { createFileRoute } from "@tanstack/react-router";
import {
  BookOpen,
  Target,
  ShieldCheck,
  Newspaper,
  Brain,
  ClipboardList,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/docs")({
  component: Docs,
  head: () => ({
    meta: [
      { title: "User Guide & Documentation — 5ers Challenge" },
      {
        name: "description",
        content:
          "How to use the Gabsome-X trade desk: daily picks, entries, lot sizing, target tracking, news guard, and the documents you need to get funded.",
      },
    ],
  }),
});

function Docs() {
  return (
    <div className="max-w-3xl space-y-6">
      <div className="flex items-center gap-3">
        <span className="size-10 grid place-items-center rounded-lg bg-primary/10 text-primary">
          <BookOpen className="size-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">User Guide & Documentation</h1>
          <p className="text-sm text-muted-foreground">
            Everything you need to run the daily routine and pass your 5ers
            challenge.
          </p>
        </div>
      </div>

      <Section icon={<Target />} title="The daily routine — how to use">
        <ol className="list-decimal pl-5 space-y-2">
          <li>
            Open the <strong>Dashboard</strong>. The engine scans every watched
            pair and surfaces <strong>one A+ Daily Pick</strong> (a second is
            optional but identical in quality).
          </li>
          <li>
            The pick tells you the exact <strong>pair, direction, entry, stop
            loss, take profit and lot size</strong>, plus whether to{" "}
            <strong>enter now</strong> (market order) or{" "}
            <strong>wait</strong> for price to reach a pending limit.
          </li>
          <li>
            Place that order on your 5ers/broker platform exactly as shown — the
            site does <strong>not</strong> auto-execute trades.
          </li>
          <li>
            Log the trade. When it closes (or you mark it Win/Loss in the{" "}
            <strong>Journal</strong>), your balance, target progress and stats
            update in real time.
          </li>
          <li>
            Stop once your daily $20 goal is hit. Discipline over activity.
          </li>
        </ol>
      </Section>

      <Section icon={<ClipboardList />} title="Setting & tracking your target">
        <p>
          Go to <strong>Settings → Profit target ($)</strong> and enter the
          dollar amount you want to reach (e.g. the 5ers profit objective for
          your account size). The <strong>Profit target</strong> card on the
          dashboard then auto-tracks your real balance growth toward that number
          — every closed trade moves the bar. All dashboard cards read from the
          same balance, so Balance, Total P&amp;L and Target always agree.
        </p>
      </Section>

      <Section icon={<ShieldCheck />} title="How entries & stops are chosen">
        <p>
          Picks are <strong>analysed, never guessed</strong>. Each setup must
          pass a strict quality gate: higher-timeframe (H1) trend confluence,
          clean EMA20/50 structure, a healthy RSI pullback zone, and volatility
          checks. Only A+ setups are shown.
        </p>
        <p className="mt-2">
          The <strong>stop loss is placed beyond the most recent market
          structure</strong> (swing high/low) plus an ATR buffer, so price has
          to genuinely break structure to hit it — it is far less likely to be
          stopped out before the take profit. Your risk parameters still rule:
          the lot size is sized so a wider, safer stop simply risks less, capped
          by the 5ers max-lot rule for your balance.
        </p>
      </Section>

      <Section icon={<Newspaper />} title="News awareness">
        <p>
          The engine pulls the high-impact economic calendar and{" "}
          <strong>halts any pair within ±30 minutes of a high-impact
          event</strong> for its currencies. You'll see a banner with a
          countdown; re-scan once the news settles.
        </p>
      </Section>

      <Section icon={<Brain />} title="The AI keeps learning">
        <p>
          Every closed trade feeds back into the engine. It tracks your win rate
          per pair and setup, then biases future picks toward your proven edges
          and nudges quality thresholds — so the longer you use it honestly, the
          sharper it gets.
        </p>
      </Section>

      <Section icon={<ClipboardList />} title="Documents you need for 5ers">
        <ul className="list-disc pl-5 space-y-1">
          <li>Government-issued photo ID (passport / national ID) for KYC.</li>
          <li>Proof of address (utility bill or bank statement, recent).</li>
          <li>Your 5ers account credentials & account size / phase.</li>
          <li>
            A trading journal record (the in-app Journal export covers this).
          </li>
          <li>
            The 5ers rules sheet for your plan: profit target, max daily
            drawdown (5%), max overall drawdown (10%).
          </li>
        </ul>
      </Section>

      <div className="rounded-xl border border-bear/40 bg-bear/5 p-5 text-sm">
        <div className="flex items-center gap-2 font-semibold text-bear mb-2">
          <AlertTriangle className="size-4" /> Disclaimer
        </div>
        <p className="text-muted-foreground">
          This tool is for <strong>educational purposes only</strong> and is not
          financial advice. Trading carries risk of loss. You are responsible
          for your own decisions and for following your prop firm's rules.
        </p>
        <p className="text-muted-foreground mt-2">
          © {new Date().getFullYear()} Gabriel Maina Mwangi, Nakuru. All rights
          reserved. This software, its logic and documentation are the
          intellectual property of Gabriel Maina Mwangi and may not be copied or
          redistributed without permission.
        </p>
      </div>
    </div>
  );
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-6">
      <h2 className="font-semibold flex items-center gap-2 mb-3">
        <span className="size-7 grid place-items-center rounded-md bg-primary/10 text-primary [&_svg]:size-4">
          {icon}
        </span>
        {title}
      </h2>
      <div className="text-sm text-muted-foreground leading-relaxed">
        {children}
      </div>
    </div>
  );
}
