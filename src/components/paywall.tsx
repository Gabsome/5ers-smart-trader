import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import {
  createBillingOrder,
  captureBillingOrder,
  getPaypalClientId,
  type AccessStatus,
} from "@/lib/access.functions";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";

type Plan = "monthly" | "quarterly" | "yearly";

declare global {
  interface Window { paypal?: any }
}

const PLAN_LABELS: Record<Plan, { name: string; per: string }> = {
  monthly: { name: "Monthly", per: "/ month" },
  quarterly: { name: "Quarterly", per: "/ 3 months" },
  yearly: { name: "Yearly", per: "/ year" },
};

export function Paywall({ access }: { access: AccessStatus }) {
  const [plan, setPlan] = useState<Plan>("monthly");
  const [status, setStatus] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const createOrder = useServerFn(createBillingOrder);
  const capture = useServerFn(captureBillingOrder);
  const getClientId = useServerFn(getPaypalClientId);
  const qc = useQueryClient();

  const reg = access.registrationPaid ? 0 : access.prices.registration;
  const total = access.prices[plan] + reg;

  // Load the PayPal SDK once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (window.paypal) { setSdkReady(true); return; }
      const { clientId } = await getClientId();
      if (!clientId || cancelled) return;
      const s = document.createElement("script");
      s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD`;
      s.onload = () => !cancelled && setSdkReady(true);
      document.body.appendChild(s);
    })();
    return () => { cancelled = true; };
  }, [getClientId]);

  // (Re)render buttons whenever the SDK is ready or the plan changes.
  useEffect(() => {
    if (!sdkReady || !window.paypal || !containerRef.current) return;
    containerRef.current.innerHTML = "";
    const buttons = window.paypal.Buttons({
      style: { color: "gold", shape: "pill", label: "pay" },
      createOrder: async () => {
        setStatus(null);
        const res = await createOrder({ data: { plan } });
        return res.orderId;
      },
      onApprove: async (d: any) => {
        setStatus("Verifying payment…");
        const res = await capture({ data: { orderId: d.orderID, plan } });
        if (res.ok) {
          setStatus("Payment confirmed! Unlocking…");
          await qc.invalidateQueries({ queryKey: ["access"] });
        } else {
          setStatus(res.error ?? "Payment failed.");
        }
      },
      onError: () => setStatus("Something went wrong with PayPal. Please try again."),
    });
    buttons.render(containerRef.current);
    return () => { try { buttons.close?.(); } catch { /* noop */ } };
  }, [sdkReady, plan, createOrder, capture, qc]);

  return (
    <div className="min-h-screen bg-background text-foreground flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 space-y-5">
        <div className="flex items-center gap-2 justify-center">
          <Logo size={36} />
          <span className="font-bold text-lg">7star Challenge</span>
        </div>
        <div className="text-center space-y-1">
          <h1 className="text-xl font-bold">Activate your membership</h1>
          <p className="text-sm text-muted-foreground">
            {access.registrationPaid
              ? "Choose a plan to continue using your trade desk."
              : "A one-time $100 registration fee applies on your first payment, then your chosen plan."}
          </p>
        </div>

        <div className="grid grid-cols-3 gap-2">
          {(Object.keys(PLAN_LABELS) as Plan[]).map((p) => (
            <button
              key={p}
              onClick={() => setPlan(p)}
              className={`rounded-lg border px-2 py-3 text-center transition-colors ${
                plan === p ? "border-primary bg-primary/10" : "border-border hover:bg-accent"
              }`}
            >
              <div className="text-sm font-semibold">{PLAN_LABELS[p].name}</div>
              <div className="text-lg font-bold text-primary">${access.prices[p]}</div>
              <div className="text-[10px] text-muted-foreground">{PLAN_LABELS[p].per}</div>
            </button>
          ))}
        </div>

        <div className="rounded-lg bg-muted/40 p-3 text-sm space-y-1">
          <div className="flex justify-between"><span>{PLAN_LABELS[plan].name} plan</span><span>${access.prices[plan].toFixed(2)}</span></div>
          {reg > 0 && <div className="flex justify-between"><span>Registration (one-time)</span><span>${reg.toFixed(2)}</span></div>}
          <div className="flex justify-between font-bold border-t border-border pt-1 mt-1"><span>Total now</span><span>${total.toFixed(2)}</span></div>
        </div>

        <div ref={containerRef} className="min-h-[44px]" />
        {!sdkReady && <p className="text-center text-xs text-muted-foreground">Loading secure checkout…</p>}
        {status && <p className="text-center text-sm text-primary">{status}</p>}
        <p className="text-center text-[11px] text-muted-foreground">
          Payments are processed securely by PayPal. Educational use only — not financial advice.
        </p>
      </div>
    </div>
  );
}
