// Server-only PayPal helpers. Never import from client code.
// Uses live PayPal by default; set PAYPAL_ENV=sandbox to test.

const PAYPAL_BASE = () =>
  (process.env.PAYPAL_ENV ?? "live").toLowerCase() === "sandbox"
    ? "https://api-m.sandbox.paypal.com"
    : "https://api-m.paypal.com";

export const PLAN_PRICES: Record<string, number> = {
  monthly: 50,
  quarterly: 150,
  yearly: 600,
};

export const REGISTRATION_FEE = 100;

export function planMonths(plan: string): number {
  if (plan === "quarterly") return 3;
  if (plan === "yearly") return 12;
  return 1;
}

export function isFreeEmail(email?: string | null): boolean {
  if (!email) return false;
  const raw = process.env.FREE_ACCESS_EMAILS ?? "";
  const list = raw
    .split(/[,\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.includes(email.trim().toLowerCase());
}

async function paypalToken(): Promise<string> {
  const id = process.env.PAYPAL_CLIENT_ID;
  const secret = process.env.PAYPAL_CLIENT_SECRET;
  if (!id || !secret) throw new Error("PayPal credentials are not configured.");
  const res = await fetch(`${PAYPAL_BASE()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${id}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!res.ok) throw new Error(`PayPal auth failed: ${res.status} ${await res.text()}`);
  const j: any = await res.json();
  return j.access_token;
}

export async function ppCreateOrder(amountUsd: number, customId: string, description: string) {
  const token = await paypalToken();
  const res = await fetch(`${PAYPAL_BASE()}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          custom_id: customId,
          description: description.slice(0, 127),
          amount: { currency_code: "USD", value: amountUsd.toFixed(2) },
        },
      ],
    }),
  });
  if (!res.ok) throw new Error(`PayPal create order failed: ${res.status} ${await res.text()}`);
  const j: any = await res.json();
  return j.id as string;
}

export async function ppCaptureOrder(orderId: string) {
  const token = await paypalToken();
  const res = await fetch(`${PAYPAL_BASE()}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  if (!res.ok) throw new Error(`PayPal capture failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as any;
}
