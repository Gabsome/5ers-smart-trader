import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { motion } from "motion/react";
import { TrendingUp, Bot, ShieldCheck, LineChart, Activity, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/")({
  component: Landing,
  head: () => ({
    meta: [
      { title: "5ers Challenge — by Gabsome-X" },
      { name: "description", content: "AI-assisted trading dashboard built for the 5ers $2.5k 2-step challenge. Real-time signals on majors + XAUUSD, live charts, smart risk." },
    ],
  }),
});

function Landing() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  useEffect(() => {
    if (!loading && user) nav({ to: "/dashboard" });
  }, [loading, user, nav]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Nav */}
      <header className="border-b border-border/60 backdrop-blur sticky top-0 z-30 bg-background/80">
        <div className="container mx-auto flex items-center justify-between py-4 px-6">
          <Link to="/" className="flex items-center gap-2 font-bold">
            <span className="grid place-items-center size-9 rounded-md bg-primary text-primary-foreground"><TrendingUp className="size-5" /></span>
            <span className="text-lg">5ers Challenge <span className="text-primary">·</span> <span className="text-muted-foreground font-medium">by Gabsome-X</span></span>
          </Link>
          <Link to="/login">
            <Button>Sign in</Button>
          </Link>
        </div>
      </header>

      {/* Hero */}
      <section className="container mx-auto px-6 py-20 md:py-28 grid lg:grid-cols-2 gap-12 items-center">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div className="inline-flex items-center gap-2 rounded-full border border-border/80 bg-card px-3 py-1 text-xs text-muted-foreground mb-6">
            <Sparkles className="size-3.5 text-primary" /> Built for the 5ers $2,500 2-step
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-[1.05] tracking-tight">
            Pass the challenge.<br />
            <span className="text-primary">$20 a day</span>, on autopilot intel.
          </h1>
          <p className="mt-6 text-lg text-muted-foreground max-w-xl">
            An AI co-pilot for prop traders. Real-time entry IDs on the most profitable pairs and gold, live TradingView charts, and a journal that knows the difference between your Challenge, Verification, Funded, and Test accounts.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link to="/login"><Button size="lg" className="text-base">Start trading smarter</Button></Link>
            <a href="#features"><Button size="lg" variant="outline" className="text-base">See features</Button></a>
          </div>
          <div className="mt-8 grid grid-cols-3 gap-4 max-w-md">
            <Stat label="Pairs scanned" value="6" />
            <Stat label="Min target" value="$20/day" />
            <Stat label="Account size" value="$2.5k" />
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.7, delay: 0.2 }}
          className="relative rounded-2xl border border-border bg-card p-6 shadow-2xl">
          <div className="flex items-center justify-between text-xs text-muted-foreground mb-4">
            <span>EUR/USD · 15min</span>
            <span className="text-bull">▲ +0.12%</span>
          </div>
          <div className="space-y-3">
            <FakeBar pair="XAU/USD" dir="BUY" conf={82} />
            <FakeBar pair="GBP/USD" dir="SELL" conf={71} />
            <FakeBar pair="EUR/USD" dir="BUY" conf={64} />
            <FakeBar pair="USD/JPY" dir="—" conf={0} />
          </div>
          <div className="mt-6 rounded-lg bg-background/60 p-4 border border-border">
            <div className="text-xs text-muted-foreground mb-1">Today's P&amp;L</div>
            <div className="flex items-end justify-between">
              <div className="text-3xl font-bold text-bull">+$27.40</div>
              <div className="text-xs text-muted-foreground">137% of $20 goal</div>
            </div>
            <div className="mt-2 h-1.5 rounded bg-muted overflow-hidden">
              <div className="h-full bg-bull" style={{ width: "100%" }} />
            </div>
          </div>
        </motion.div>
      </section>

      {/* Features */}
      <section id="features" className="container mx-auto px-6 py-20 border-t border-border">
        <h2 className="text-3xl md:text-4xl font-bold mb-12 max-w-2xl">Built for the rules that actually break accounts.</h2>
        <div className="grid md:grid-cols-3 gap-6">
          <Feature icon={<Bot />} title="AI entry signals"
            desc="Indicator engine detects EMA pullbacks, RSI zones, and structure breaks on FX majors + gold. Gemini filters them with your account context." />
          <Feature icon={<LineChart />} title="Live TradingView charts"
            desc="Embedded TradingView Advanced Chart. Switch pairs, draw, confirm — without leaving the dashboard." />
          <Feature icon={<ShieldCheck />} title="Mode-aware risk"
            desc="Tell the AI when you're on Challenge, Verification, Funded, or just Testing. Lot size, confidence, and aggression adapt instantly." />
          <Feature icon={<Activity />} title="Real-time tracking"
            desc="Daily P&L vs $20 goal, equity curve, distance to 5%/10% drawdown — everything updates the second you log a trade." />
          <Feature icon={<TrendingUp />} title="Profitable pair scanner"
            desc="At-a-glance grid: which pairs have setups forming, which are dead. EUR/USD, GBP/USD, USD/JPY, AUD/USD, USD/CAD, XAU/USD." />
          <Feature icon={<Sparkles />} title="Smart journal"
            desc="Log trades manually or from a signal in two clicks. Win rate, R-multiples, best/worst pair — auto-computed." />
        </div>
      </section>

      <section className="container mx-auto px-6 py-20 border-t border-border text-center">
        <h2 className="text-3xl md:text-5xl font-bold max-w-3xl mx-auto">Stop guessing entries. Start passing.</h2>
        <p className="mt-4 text-muted-foreground max-w-xl mx-auto">Sign in with Google — your data is private and locked to your account.</p>
        <Link to="/login" className="inline-block mt-8"><Button size="lg" className="text-base">Sign in with Google</Button></Link>
      </section>

      <footer className="border-t border-border py-8 text-center text-xs text-muted-foreground">
        5ers Challenge · by Gabsome-X · This tool provides signals & tracking only. It does not place trades on your broker.
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-2xl font-bold text-primary">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function Feature({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-6 hover:border-primary/60 transition-colors">
      <div className="size-10 rounded-md bg-primary/10 text-primary grid place-items-center mb-4">{icon}</div>
      <h3 className="font-semibold mb-2">{title}</h3>
      <p className="text-sm text-muted-foreground">{desc}</p>
    </div>
  );
}

function FakeBar({ pair, dir, conf }: { pair: string; dir: string; conf: number }) {
  const color = dir === "BUY" ? "text-bull" : dir === "SELL" ? "text-bear" : "text-muted-foreground";
  return (
    <div className="flex items-center justify-between rounded-md bg-background/60 border border-border px-3 py-2">
      <span className="font-medium">{pair}</span>
      <div className="flex items-center gap-3">
        <span className={`text-xs font-bold ${color}`}>{dir}</span>
        <span className="text-xs text-muted-foreground w-12 text-right">{conf ? `${conf}%` : "—"}</span>
      </div>
    </div>
  );
}
