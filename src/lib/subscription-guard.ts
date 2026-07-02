import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { hasActiveSubscription } from "./access.server";

// Server-side subscription gate. Chains after requireSupabaseAuth so
// premium server functions cannot be called by unpaid/expired accounts,
// even directly with a valid JWT. Free-tier emails are allowed through.
export const requireActiveSubscription = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const email =
      (context as any)?.claims?.email ??
      (context as any)?.claims?.user_metadata?.email ??
      null;
    const active = await hasActiveSubscription(context.supabase, context.userId, email);
    if (!active) {
      throw new Error("Subscription required");
    }
    return next();
  });
