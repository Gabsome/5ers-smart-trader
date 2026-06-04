import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  PLAN_PRICES,
  REGISTRATION_FEE,
  planMonths,
  isFreeEmail,
  ppCreateOrder,
  ppCaptureOrder,
} from "./access.server";

const planSchema = z.object({ plan: z.enum(["monthly", "quarterly", "yearly"]) });

export type AccessStatus = {
  tier: "free" | "paid" | "none";
  active: boolean;
  plan: string;
  status: string;
  registrationPaid: boolean;
  currentPeriodEnd: string | null;
  prices: { monthly: number; quarterly: number; yearly: number; registration: number };
};

function emailFromContext(context: any): string | null {
  return context?.claims?.email ?? context?.claims?.user_metadata?.email ?? null;
}

export const getAccessStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AccessStatus> => {
    const { supabase, userId } = context;
    const prices = {
      monthly: PLAN_PRICES.monthly,
      quarterly: PLAN_PRICES.quarterly,
      yearly: PLAN_PRICES.yearly,
      registration: REGISTRATION_FEE,
    };

    const email = emailFromContext(context);
    if (isFreeEmail(email)) {
      return {
        tier: "free", active: true, plan: "lifetime", status: "active",
        registrationPaid: true, currentPeriodEnd: null, prices,
      };
    }

    const { data } = await supabase
      .from("subscriptions")
      .select("plan,status,registration_paid,current_period_end")
      .eq("user_id", userId)
      .maybeSingle();

    const end = data?.current_period_end ? new Date(data.current_period_end) : null;
    const active = data?.status === "active" && !!end && end.getTime() > Date.now();
    return {
      tier: active ? "paid" : "none",
      active,
      plan: data?.plan ?? "none",
      status: data?.status ?? "inactive",
      registrationPaid: !!data?.registration_paid,
      currentPeriodEnd: data?.current_period_end ?? null,
      prices,
    };
  });

// Create a PayPal order; amount = recurring fee (+ one-time registration if unpaid).
export const createBillingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => planSchema.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const email = emailFromContext(context);
    if (isFreeEmail(email)) return { orderId: null, amount: 0, free: true };

    const { data: sub } = await supabase
      .from("subscriptions")
      .select("registration_paid")
      .eq("user_id", userId)
      .maybeSingle();

    const reg = sub?.registration_paid ? 0 : REGISTRATION_FEE;
    const amount = PLAN_PRICES[data.plan] + reg;
    const desc = `7star ${data.plan} membership${reg ? " + registration" : ""}`;
    const orderId = await ppCreateOrder(amount, `${userId}|${data.plan}`, desc);
    return { orderId, amount, free: false };
  });

// Capture the order, verify it, then extend membership using the service role.
export const captureBillingOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ orderId: z.string().min(1), plan: planSchema.shape.plan }).parse(d))
  .handler(async ({ data, context }): Promise<{ ok: boolean; error?: string }> => {
    const { supabase, userId } = context;

    const { data: existing } = await supabase
      .from("subscriptions")
      .select("registration_paid,current_period_end,status")
      .eq("user_id", userId)
      .maybeSingle();

    const result = await ppCaptureOrder(data.orderId);
    if (result?.status !== "COMPLETED") {
      return { ok: false, error: "Payment not completed." };
    }
    const pu = result.purchase_units?.[0];
    const cap = pu?.payments?.captures?.[0];
    const paid = Number(cap?.amount?.value ?? 0);
    const reg = existing?.registration_paid ? 0 : REGISTRATION_FEE;
    const expected = PLAN_PRICES[data.plan] + reg;
    // Verify the captured amount and that this order was for THIS user.
    if (Math.abs(paid - expected) > 0.5 || pu?.custom_id !== `${userId}|${data.plan}`) {
      return { ok: false, error: "Payment verification failed." };
    }

    // Extend from the later of now or the current period end.
    const base = existing?.current_period_end && new Date(existing.current_period_end).getTime() > Date.now()
      ? new Date(existing.current_period_end)
      : new Date();
    const end = new Date(base);
    end.setMonth(end.getMonth() + planMonths(data.plan));

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("subscriptions").upsert(
      {
        user_id: userId,
        registration_paid: true,
        plan: data.plan,
        status: "active",
        current_period_end: end.toISOString(),
        last_payment_usd: paid,
        last_payment_at: new Date().toISOString(),
        paypal_last_order_id: data.orderId,
      },
      { onConflict: "user_id" },
    );
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  });

// Publishable PayPal client id for loading the browser SDK.
export const getPaypalClientId = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => ({ clientId: process.env.PAYPAL_CLIENT_ID ?? "" }));
